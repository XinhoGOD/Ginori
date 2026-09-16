import { queryRows, sqlString } from "./duckdb";
import type {
  AdpPoint,
  DefenseVsPosition,
  OpponentHistory,
  OpponentSummary,
  Phase2Profile,
  Player,
  StatGame,
  StatLine,
  WaiverPoint,
  WeekOption,
  WeeklyMarket,
} from "../types";

type GameRow = {
  game_id: string;
  season: number;
  week: number;
  gameday: string;
  gametime: string | null;
  away_team: string;
  home_team: string;
  away_score: string | number | null;
  home_score: string | number | null;
};

type StatRow = Record<string, unknown> & {
  player_display_name?: string | null;
  position?: string | null;
  season?: number | string | null;
  week?: number | string | null;
  game_id?: string | null;
  team?: string | null;
  opponent_team?: string | null;
};

type SnapRow = Record<string, unknown> & {
  game_id?: string | null;
  season?: number | string | null;
  week?: number | string | null;
  player?: string | null;
  pfr_player_id?: string | null;
  team?: string | null;
  opponent?: string | null;
};

const TEAM_ALIAS: Record<string, string> = { LA: "LAR" };
const normalizeTeam = (team: string | null | undefined) =>
  TEAM_ALIAS[team ?? ""] ?? team ?? "";
const compareTeam = (team: string | null | undefined) =>
  normalizeTeam(team) === "LAR" ? "LA" : normalizeTeam(team);
const normalizeName = (name: string) =>
  name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

const numberValue = (row: Record<string, unknown>, key: string) => {
  const value = row[key];
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const sum = (rows: Array<Record<string, unknown>>, key: string) => {
  const values = rows
    .map((row) => numberValue(row, key))
    .filter((v): v is number => v !== null);
  return values.length
    ? values.reduce((total, value) => total + value, 0)
    : null;
};

const average = (rows: Array<Record<string, unknown>>, key: string) => {
  const values = rows
    .map((row) => numberValue(row, key))
    .filter((v): v is number => v !== null);
  return values.length
    ? values.reduce((total, value) => total + value, 0) / values.length
    : null;
};

const dateValue = (row: StatRow) => {
  const value = row.gameday ?? row.date;
  return value ? String(value) : null;
};

function easternToUtc(date: string, time: string | null) {
  const localTime =
    time && /^\d{2}:\d{2}/.test(time) ? time.slice(0, 5) : "23:59";
  const naive = new Date(`${date}T${localTime}:00Z`);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    timeZoneName: "longOffset",
  }).formatToParts(naive);
  const zone =
    parts.find((part) => part.type === "timeZoneName")?.value ?? "GMT-4";
  const match = zone.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
  const sign = match?.[1] === "-" ? -1 : 1;
  const offsetMinutes = match
    ? sign * (Number(match[2]) * 60 + Number(match[3] ?? 0))
    : -240;
  return new Date(naive.getTime() - offsetMinutes * 60_000);
}

function tuesdayBefore(date: string) {
  const day = new Date(`${date}T12:00:00Z`);
  while (day.getUTCDay() !== 2) day.setUTCDate(day.getUTCDate() - 1);
  return easternToUtc(day.toISOString().slice(0, 10), "00:00");
}

function kickoff(game: GameRow) {
  return easternToUtc(String(game.gameday), game.gametime);
}

function isFinal(game: GameRow) {
  return (
    game.away_score !== null &&
    game.away_score !== "" &&
    game.home_score !== null &&
    game.home_score !== ""
  );
}

let gamesCache: Promise<GameRow[]> | null = null;
const statsCache = new Map<string, Promise<StatRow[]>>();
const snapCache = new Map<string, Promise<SnapRow[]>>();
const defenseCache = new Map<string, Promise<Array<DefenseRow>>>();

async function loadGames() {
  if (!gamesCache) {
    gamesCache = queryRows<GameRow>(
      `SELECT game_id, season, week, gameday, gametime, away_team, home_team, away_score, home_score
       FROM nflverse_games WHERE game_type = 'REG' ORDER BY season, week, gameday, gametime`,
    );
  }
  return gamesCache;
}

async function loadPlayerStats(player: Player) {
  const key =
    player.gsisId ??
    `${normalizeName(player.name)}:${normalizeTeam(player.team)}:${player.position ?? ""}`;
  let promise = statsCache.get(key);
  if (!promise) {
    const identityFilter = player.gsisId
      ? `player_id = ${sqlString(player.gsisId)}`
      : `regexp_replace(lower(coalesce(player_display_name, player_name)), '[^a-z0-9]', '', 'g') = ${sqlString(normalizeName(player.name))}
         AND position = ${sqlString(player.position ?? "")}
         AND team IN (${sqlString(compareTeam(player.team))}, ${sqlString(normalizeTeam(player.team))})`;
    promise = queryRows<StatRow>(
      `SELECT * FROM nflverse_player_stats
       WHERE season_type = 'REG'
         AND ${identityFilter}`,
    );
    statsCache.set(key, promise);
  }
  return promise;
}

async function loadSnapCounts(player: Player) {
  const key =
    player.pfrId ??
    `${normalizeName(player.name)}:${normalizeTeam(player.team)}:${player.position ?? ""}`;
  let promise = snapCache.get(key);
  if (!promise) {
    const identityFilter = player.pfrId
      ? `pfr_player_id = ${sqlString(player.pfrId)}`
      : `regexp_replace(lower(player), '[^a-z0-9]', '', 'g') = ${sqlString(normalizeName(player.name))}
         AND position = ${sqlString(player.position ?? "")}
         AND team IN (${sqlString(compareTeam(player.team))}, ${sqlString(normalizeTeam(player.team))})`;
    promise = queryRows<SnapRow>(
      `SELECT * FROM nflverse_snap_counts
       WHERE game_type = 'REG'
         AND ${identityFilter}`,
    );
    snapCache.set(key, promise);
  }
  return promise;
}

function weekState(games: GameRow[], now = new Date()) {
  const season = Math.max(...games.map((game) => Number(game.season)), 0);
  const seasonGames = games.filter((game) => Number(game.season) === season);
  const weeks = [...new Set(seasonGames.map((game) => Number(game.week)))].sort(
    (a, b) => a - b,
  );
  const startedButOpen = weeks.find((week) =>
    seasonGames.some(
      (game) =>
        Number(game.week) === week && kickoff(game) <= now && !isFinal(game),
    ),
  );
  const currentWeek =
    startedButOpen ??
    weeks.find((week) =>
      seasonGames.some(
        (game) => Number(game.week) === week && kickoff(game) > now,
      ),
    ) ??
    weeks.at(-1) ??
    1;
  const options: WeekOption[] = Array.from({ length: 18 }, (_, index) => {
    const week = index + 1;
    const firstKickoff = seasonGames
      .filter((game) => Number(game.week) === week)
      .map(kickoff)
      .sort((a, b) => a.getTime() - b.getTime())[0] ?? null;
    const unlockDate = firstKickoff
      ? new Date(firstKickoff.getTime() - 3 * 24 * 60 * 60 * 1000)
      : null;
    return {
      season,
      week,
      label: `WEEK ${week}`,
      locked: unlockDate ? unlockDate > now : week > currentWeek,
      current: week === currentWeek,
      unlocksAt: unlockDate?.toISOString() ?? null,
    };
  });
  return { season, currentWeek, options };
}

function windowAdp(history: AdpPoint[], start: Date, end: Date) {
  const inWindow = history.filter((point) => {
    if (point.adp === null) return false;
    const time = new Date(point.capturedAt).getTime();
    return time >= start.getTime() && time <= end.getTime();
  });
  const firstBySource = new Map<string, AdpPoint>();
  const latestBySource = new Map<string, AdpPoint>();
  for (const point of inWindow) {
    const first = firstBySource.get(point.source);
    const latest = latestBySource.get(point.source);
    if (!first || new Date(point.capturedAt) < new Date(first.capturedAt))
      firstBySource.set(point.source, point);
    if (!latest || new Date(point.capturedAt) > new Date(latest.capturedAt))
      latestBySource.set(point.source, point);
  }
  const avg = (points: Iterable<AdpPoint>) => {
    const values = [...points]
      .map((point) => point.adp)
      .filter((value): value is number => value !== null);
    return values.length
      ? values.reduce((total, value) => total + value, 0) / values.length
      : null;
  };
  const adpStart = avg(firstBySource.values());
  const adpPregame = avg(latestBySource.values());
  return {
    adpStart,
    adpPregame,
    adpMovement:
      adpStart !== null && adpPregame !== null ? adpStart - adpPregame : null,
  };
}

function latestWaiver(waivers: WaiverPoint[], start: Date, end: Date) {
  const rows = waivers
    .filter((row) => row.lookbackHours === 24)
    .filter((row) => {
      const time = new Date(row.capturedAt).getTime();
      return time >= start.getTime() && time <= end.getTime();
    })
    .sort(
      (a, b) =>
        new Date(b.capturedAt).getTime() - new Date(a.capturedAt).getTime(),
    );
  return rows[0] ?? null;
}

function matchupFor(
  games: GameRow[],
  player: Player,
  season: number,
  week: number,
) {
  const team = compareTeam(player.team);
  const game = games.find(
    (row) =>
      Number(row.season) === season &&
      Number(row.week) === week &&
      (row.home_team === team || row.away_team === team),
  );
  if (!game) return null;
  return {
    game,
    opponent: normalizeTeam(
      game.home_team === team ? game.away_team : game.home_team,
    ),
    kickoffAt: kickoff(game),
  };
}

function buildWeeklyMarket(
  games: GameRow[],
  player: Player,
  adpHistory: AdpPoint[],
  waiverHistory: WaiverPoint[],
  season: number,
  week: number,
  now: Date,
): WeeklyMarket | null {
  const matchup = matchupFor(games, player, season, week);
  if (!matchup) return null;
  const weekGames = games.filter(
    (game) => Number(game.season) === season && Number(game.week) === week,
  );
  const firstGame = weekGames.sort(
    (a, b) => kickoff(a).getTime() - kickoff(b).getTime(),
  )[0];
  const start = tuesdayBefore(String(firstGame.gameday));
  const end = matchup.kickoffAt < now ? matchup.kickoffAt : now;
  const adp = windowAdp(adpHistory, start, end);
  const waiver = latestWaiver(waiverHistory, start, end);
  return {
    season,
    week,
    opponent: matchup.opponent,
    kickoffAt: matchup.kickoffAt.toISOString(),
    windowStart: start.toISOString(),
    windowEnd: end.toISOString(),
    ...adp,
    adds: waiver?.adds ?? null,
    drops: waiver?.drops ?? null,
    netAdds: waiver?.netAdds ?? null,
    ratio: waiver?.ratio ?? null,
  };
}

function statLine(rows: StatRow[], snaps: SnapRow[] = []): StatLine {
  const receivingYards = sum(rows, "receiving_yards");
  const receptions = sum(rows, "receptions");
  const carries = sum(rows, "carries");
  const targetShareAvg = average(rows, "target_share");
  const snapPctAvg = average(rows, "snap_pct");
  const routeParticipationAvg = average(rows, "route_participation");
  return {
    games: rows.length,
    offensiveSnaps: sum(snaps, "offense_snaps"),
    attempts: sum(rows, "attempts"),
    completions: sum(rows, "completions"),
    passingYards: sum(rows, "passing_yards"),
    passingTds: sum(rows, "passing_tds"),
    interceptions: sum(rows, "passing_interceptions"),
    rushAttempts: carries,
    rushingYards: sum(rows, "rushing_yards"),
    rushingTds: sum(rows, "rushing_tds"),
    targets: sum(rows, "targets"),
    receptions,
    receivingYards,
    receivingTds: sum(rows, "receiving_tds"),
    targetShareAvg,
    snapPctAvg: snaps.length ? average(snaps, "offense_pct") : snapPctAvg,
    routeParticipationAvg,
    yardsPerReception:
      receptions && receptions > 0 && receivingYards !== null
        ? receivingYards / receptions
        : null,
    touches:
      carries !== null && receptions !== null ? carries + receptions : null,
    opportunityShareAvg: average(rows, "opportunity_share"),
  };
}

function statGame(
  row: StatRow,
  snaps: SnapRow[],
  game: GameRow | undefined,
): StatGame {
  const line = statLine([row], snaps);
  return {
    ...line,
    season: Number(row.season),
    week: Number(row.week),
    gameId: String(row.game_id),
    date: game?.gameday ? String(game.gameday) : dateValue(row),
    team: row.team ? normalizeTeam(String(row.team)) : null,
    opponent: normalizeTeam(
      row.opponent_team ? String(row.opponent_team) : null,
    ),
  };
}

type DefenseRow = {
  opponent: string;
  games: number;
  targets: number | null;
  receptions: number | null;
  receivingYards: number | null;
  receivingTds: number | null;
  carries: number | null;
  rushingYards: number | null;
  rushingTds: number | null;
  passingYards: number | null;
  passingTds: number | null;
  interceptions: number | null;
};

async function defenseRows(season: number, position: string) {
  const key = `${season}:${position}`;
  let promise = defenseCache.get(key);
  if (!promise) {
    promise = queryRows<DefenseRow>(
      `SELECT opponent_team AS opponent, COUNT(DISTINCT game_id) AS games,
        SUM(targets) AS targets, SUM(receptions) AS receptions,
        SUM(receiving_yards) AS "receivingYards", SUM(receiving_tds) AS "receivingTds",
        SUM(carries) AS carries, SUM(rushing_yards) AS "rushingYards",
        SUM(rushing_tds) AS "rushingTds", SUM(passing_yards) AS "passingYards",
        SUM(passing_tds) AS "passingTds", SUM(passing_interceptions) AS interceptions
       FROM nflverse_player_stats
       WHERE season = ${season} AND season_type = 'REG' AND position = ${sqlString(position)}
       GROUP BY opponent_team`,
    ).then((rows) =>
      rows.map((row) => ({
        ...row,
        games: Number(row.games),
        targets: row.targets === null ? null : Number(row.targets),
        receptions: row.receptions === null ? null : Number(row.receptions),
        receivingYards:
          row.receivingYards === null ? null : Number(row.receivingYards),
        receivingTds:
          row.receivingTds === null ? null : Number(row.receivingTds),
        carries: row.carries === null ? null : Number(row.carries),
        rushingYards:
          row.rushingYards === null ? null : Number(row.rushingYards),
        rushingTds: row.rushingTds === null ? null : Number(row.rushingTds),
        passingYards:
          row.passingYards === null ? null : Number(row.passingYards),
        passingTds: row.passingTds === null ? null : Number(row.passingTds),
        interceptions:
          row.interceptions === null ? null : Number(row.interceptions),
      })),
    );
    defenseCache.set(key, promise);
  }
  return promise;
}

function rankFor(
  rows: DefenseRow[],
  key: keyof DefenseRow,
  value: number | null,
) {
  if (value === null) return null;
  const values = rows
    .map((row) => row[key])
    .filter((item): item is number => typeof item === "number");
  return values.length
    ? 1 + values.filter((item) => item < value).length
    : null;
}

async function defenseContext(
  season: number,
  position: string,
  opponent: string | null,
): Promise<DefenseVsPosition | null> {
  if (!opponent || !position) return null;
  const rows = await defenseRows(season, position);
  const row = rows.find(
    (item) => normalizeTeam(item.opponent) === normalizeTeam(opponent),
  );
  if (!row) return null;
  const perGame = (value: number | null) =>
    value === null || !row.games ? null : value / row.games;
  return {
    opponent: normalizeTeam(opponent),
    position,
    games: row.games,
    rankTotal: rows.length,
    targetsAllowed: perGame(row.targets),
    receptionsAllowed: perGame(row.receptions),
    receivingYardsAllowed: perGame(row.receivingYards),
    receivingTdsAllowed: perGame(row.receivingTds),
    carriesAllowed: perGame(row.carries),
    rushingYardsAllowed: perGame(row.rushingYards),
    rushingTdsAllowed: perGame(row.rushingTds),
    passingYardsAllowed: perGame(row.passingYards),
    passingTdsAllowed: perGame(row.passingTds),
    interceptionsAllowed: perGame(row.interceptions),
    qbRushingYardsAllowed: perGame(row.rushingYards),
    ranks: {
      targetsAllowed: rankFor(
        rows,
        "targets",
        row.targets === null ? null : row.targets / row.games,
      ),
      receptionsAllowed: rankFor(
        rows,
        "receptions",
        row.receptions === null ? null : row.receptions / row.games,
      ),
      receivingYardsAllowed: rankFor(
        rows,
        "receivingYards",
        row.receivingYards === null ? null : row.receivingYards / row.games,
      ),
      receivingTdsAllowed: rankFor(
        rows,
        "receivingTds",
        row.receivingTds === null ? null : row.receivingTds / row.games,
      ),
      carriesAllowed: rankFor(
        rows,
        "carries",
        row.carries === null ? null : row.carries / row.games,
      ),
      rushingYardsAllowed: rankFor(
        rows,
        "rushingYards",
        row.rushingYards === null ? null : row.rushingYards / row.games,
      ),
      rushingTdsAllowed: rankFor(
        rows,
        "rushingTds",
        row.rushingTds === null ? null : row.rushingTds / row.games,
      ),
      passingYardsAllowed: rankFor(
        rows,
        "passingYards",
        row.passingYards === null ? null : row.passingYards / row.games,
      ),
      passingTdsAllowed: rankFor(
        rows,
        "passingTds",
        row.passingTds === null ? null : row.passingTds / row.games,
      ),
      interceptionsAllowed: rankFor(
        rows,
        "interceptions",
        row.interceptions === null ? null : row.interceptions / row.games,
      ),
      qbRushingYardsAllowed: rankFor(
        rows,
        "rushingYards",
        row.rushingYards === null ? null : row.rushingYards / row.games,
      ),
    },
  };
}

export async function getPhase2Profile(
  player: Player,
  adpHistory: AdpPoint[],
  waiverHistory: WaiverPoint[],
  requestedWeek?: number,
): Promise<Phase2Profile> {
  const games = await loadGames();
  const state = weekState(games);
  const requestedOption = requestedWeek
    ? state.options.find((option) => option.week === requestedWeek)
    : null;
  const selectedWeek = requestedOption && !requestedOption.locked
    ? requestedOption.week
    : state.currentWeek;
  const weeklyMarket = buildWeeklyMarket(
    games,
    player,
    adpHistory,
    waiverHistory,
    state.season,
    selectedWeek,
    new Date(),
  );
  const [stats, snaps] = await Promise.all([
    loadPlayerStats(player),
    loadSnapCounts(player),
  ]);
  const snapsByGame = new Map<string, SnapRow[]>();
  for (const snap of snaps) {
    const gameId = snap.game_id ? String(snap.game_id) : "";
    if (!gameId) continue;
    const list = snapsByGame.get(gameId) ?? [];
    list.push(snap);
    snapsByGame.set(gameId, list);
  }
  const gamesById = new Map(games.map((game) => [String(game.game_id), game]));
  const completedStats = stats
    .filter((row) => {
      const game = gamesById.get(String(row.game_id));
      return !game || isFinal(game);
    })
    .sort(
      (a, b) =>
        Number(a.season) - Number(b.season) || Number(a.week) - Number(b.week),
    );
  const currentRows = completedStats.filter(
    (row) => Number(row.season) === state.season,
  );
  const previousSeason = state.season - 1;
  const previousRows = completedStats.filter(
    (row) => Number(row.season) === previousSeason,
  );
  const currentSnaps = snaps.filter(
    (row) => Number(row.season) === state.season,
  );
  const previousSnaps = snaps.filter(
    (row) => Number(row.season) === previousSeason,
  );
  const recentStats = completedStats
    .slice(-30)
    .map((row) =>
      statGame(
        row,
        snapsByGame.get(String(row.game_id)) ?? [],
        gamesById.get(String(row.game_id)),
      ),
    );
  const opponent = weeklyMarket?.opponent ?? null;
  const opponentHistory = completedStats
    .filter(
      (row) =>
        normalizeTeam(row.opponent_team ? String(row.opponent_team) : null) ===
        normalizeTeam(opponent),
    )
    .sort(
      (a, b) =>
        Number(b.season) - Number(a.season) || Number(b.week) - Number(a.week),
    )
    .slice(0, 4)
    .map((row) =>
      statGame(
        row,
        snapsByGame.get(String(row.game_id)) ?? [],
        gamesById.get(String(row.game_id)),
      ),
    ) as OpponentHistory[];
  const opponentSummary: OpponentSummary | null =
    opponentHistory.length && opponent
      ? {
          opponent,
          games: opponentHistory.length,
          attemptsAvg: average(
            opponentHistory as unknown as StatRow[],
            "attempts",
          ),
          completionsAvg: average(
            opponentHistory as unknown as StatRow[],
            "completions",
          ),
          passingYardsAvg: average(
            opponentHistory as unknown as StatRow[],
            "passingYards",
          ),
          passingTdsAvg: average(
            opponentHistory as unknown as StatRow[],
            "passingTds",
          ),
          interceptionsAvg: average(
            opponentHistory as unknown as StatRow[],
            "interceptions",
          ),
          rushAttemptsAvg: average(
            opponentHistory as unknown as StatRow[],
            "rushAttempts",
          ),
          targetsAvg: average(
            opponentHistory as unknown as StatRow[],
            "targets",
          ),
          receptionsAvg: average(
            opponentHistory as unknown as StatRow[],
            "receptions",
          ),
          receivingYardsAvg: average(
            opponentHistory as unknown as StatRow[],
            "receivingYards",
          ),
          receivingTdsAvg: average(
            opponentHistory as unknown as StatRow[],
            "receivingTds",
          ),
          rushingYardsAvg: average(
            opponentHistory as unknown as StatRow[],
            "rushingYards",
          ),
          rushingTdsAvg: average(
            opponentHistory as unknown as StatRow[],
            "rushingTds",
          ),
          touchesAvg: average(
            opponentHistory as unknown as StatRow[],
            "touches",
          ),
        }
      : null;
  return {
    weeks: state.options,
    selectedWeek,
    currentWeek: state.currentWeek,
    weeklyMarket,
    statsSeason: currentRows.length ? state.season : null,
    seasonStats: currentRows.length
      ? statLine(currentRows, currentSnaps)
      : null,
    previousStatsSeason: previousRows.length ? previousSeason : null,
    previousSeasonStats: previousRows.length
      ? statLine(previousRows, previousSnaps)
      : null,
    recentStats,
    opponentHistory,
    opponentSummary,
    defenseVsPosition: await defenseContext(
      state.season,
      player.position ?? "",
      opponent,
    ),
  };
}

export async function getPhase2Weeks() {
  const games = await loadGames();
  const state = weekState(games);
  return {
    season: state.season,
    currentWeek: state.currentWeek,
    weeks: state.options,
  };
}
