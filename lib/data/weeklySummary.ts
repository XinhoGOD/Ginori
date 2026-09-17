import { getPhase2Weeks } from "./phase2";
import { queryRows, sqlString } from "./duckdb";
import type { Player, WeeklySummaryRow } from "../types";

type PlayerRow = {
  player_id: string;
  display_name: string | null;
  position: string | null;
  team: string | null;
  espn_id: string | null;
  active: boolean | null;
};

type OwnershipRow = {
  espn_id: string;
  season: number;
  week: number;
  captured_at: string;
  rostered_pct: number | null;
  started_pct: number | null;
};

type GameRow = {
  season: number;
  week: number;
  gameday: string;
  gametime: string | null;
  away_team: string;
  home_team: string;
};

type WaiverRow = {
  player_id: string;
  captured_at: string;
  adds: number | null;
  drops: number | null;
};

const summaryCache = new Map<number, { expiresAt: number; value: WeeklySummaryRow[] }>();
const SUMMARY_CACHE_TTL = 60_000;

const TEAM_ALIAS: Record<string, string> = { LA: "LAR" };
const normalizeTeam = (team: string | null | undefined) => TEAM_ALIAS[team ?? ""] ?? team ?? "";

function toPlayer(row: PlayerRow): Player {
  return {
    id: row.player_id,
    name: row.display_name ?? "Unknown player",
    position: row.position,
    team: row.team,
    espnId: row.espn_id,
    gsisId: null,
    pfrId: null,
    active: row.active,
  };
}

function weekStart(gameday: string) {
  const date = new Date(`${gameday}T12:00:00Z`);
  while (date.getUTCDay() !== 2) date.setUTCDate(date.getUTCDate() - 1);
  date.setUTCHours(0, 0, 0, 0);
  return date;
}

function playerMatchup(games: GameRow[], player: Player, season: number, week: number) {
  const team = normalizeTeam(player.team);
  const game = games.find(
    (row) => row.season === season && row.week === week &&
      (normalizeTeam(row.home_team) === team || normalizeTeam(row.away_team) === team),
  );
  if (!game) return null;
  return normalizeTeam(game.home_team) === team
    ? normalizeTeam(game.away_team)
    : normalizeTeam(game.home_team);
}

function latestOwnership(rows: OwnershipRow[]) {
  const map = new Map<string, OwnershipRow>();
  for (const row of rows) {
    const current = map.get(row.espn_id);
    if (!current || new Date(row.captured_at).getTime() > new Date(current.captured_at).getTime()) {
      map.set(row.espn_id, row);
    }
  }
  return map;
}

export async function getWeeklySummary(requestedWeek?: number) {
  const state = await getPhase2Weeks();
  const option = state.weeks.find((item) => item.week === requestedWeek);
  const week = option && !option.locked ? option.week : state.currentWeek;
  const cached = summaryCache.get(week);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const [players, ownership, games] = await Promise.all([
    queryRows<PlayerRow>(`
      SELECT p.player_id,
        coalesce(nullif(p.display_name, ''), nullif(s.full_name, ''), nullif(x.name, '')) AS display_name,
        coalesce(nullif(p.position, ''), nullif(s.position, ''), nullif(x.position, '')) AS position,
        coalesce(nullif(p.team, ''), nullif(s.team, ''), nullif(x.team, '')) AS team,
        coalesce(nullif(p.espn_id, ''), nullif(s.espn_id, ''), nullif(x.canonical_espn_id, '')) AS espn_id,
        p.active
      FROM players p
      LEFT JOIN nflverse_player_xref x ON x.canonical_player_id = p.player_id
      LEFT JOIN sleeper_players s ON s.player_id = coalesce(x.sleeper_player_id, p.player_id)
      WHERE upper(coalesce(nullif(p.position, ''), nullif(s.position, ''), nullif(x.position, ''))) = 'TE'
    `),
    queryRows<OwnershipRow>(`SELECT espn_id, season, week, captured_at, rostered_pct, started_pct FROM fantasy_ownership_snapshots WHERE season = ${state.season} AND week IN (${Math.max(1, week - 1)}, ${week})`),
    queryRows<GameRow>(`SELECT season, week, gameday, gametime, away_team, home_team FROM nflverse_games WHERE season = ${state.season} AND game_type = 'REG'`),
  ]);

  const selectedOwnership = latestOwnership(ownership.filter((row) => row.week === week));
  const previousOwnership = latestOwnership(ownership.filter((row) => row.week === week - 1));
  const weekGames = games.filter((game) => game.week === week);
  const start = weekGames.length ? weekStart(weekGames.map((game) => game.gameday).sort()[0]) : null;
  const end = start ? new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000) : null;
  const now = new Date();
  const waiverRows = start && end
    ? await queryRows<WaiverRow>(`SELECT player_id, captured_at, adds, drops FROM waiver_snapshots WHERE lookback_hours = 24 AND captured_at >= ${sqlString(start.toISOString())} AND captured_at < ${sqlString((week === state.currentWeek ? now : end).toISOString())}`)
    : [];
  const latestWaivers = new Map<string, WaiverRow>();
  for (const row of waiverRows) {
    const current = latestWaivers.get(row.player_id);
    if (!current || new Date(row.captured_at).getTime() > new Date(current.captured_at).getTime()) latestWaivers.set(row.player_id, row);
  }

  const rows = players.map(toPlayer).map((player) => {
    const current = player.espnId ? selectedOwnership.get(player.espnId) : undefined;
    const previous = player.espnId ? previousOwnership.get(player.espnId) : undefined;
    const waiver = latestWaivers.get(player.id);
    return {
      player,
      season: state.season,
      week,
      opponent: playerMatchup(games, player, state.season, week),
      rosteredPct: current?.rostered_pct ?? null,
      rosteredChangePct: current && previous && current.rostered_pct !== null && previous.rostered_pct !== null ? current.rostered_pct - previous.rostered_pct : null,
      startedPct: current?.started_pct ?? null,
      startedChangePct: current && previous && current.started_pct !== null && previous.started_pct !== null ? current.started_pct - previous.started_pct : null,
      adds: waiver?.adds ?? null,
      drops: waiver?.drops ?? null,
    } satisfies WeeklySummaryRow;
  }).filter((row) =>
    row.rosteredPct !== null && row.rosteredPct >= 80 && row.rosteredPct < 90 &&
    row.startedChangePct !== null && Math.abs(row.startedChangePct) > 0.0001 &&
    ((row.adds ?? 0) > 0 || (row.drops ?? 0) > 0),
  ).sort((a, b) => (b.adds ?? 0) - (a.adds ?? 0) || (b.startedChangePct ?? 0) - (a.startedChangePct ?? 0));

  summaryCache.set(week, { expiresAt: Date.now() + SUMMARY_CACHE_TTL, value: rows });
  return rows;
}
