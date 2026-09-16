import { queryRows, sqlString } from "./duckdb";
import { calculateMetrics, buildSignals } from "./metrics";
import { getPhase2Profile } from "./phase2";
import { buildMarketStatInsights } from "./marketInsights";
import type { AdpPoint, Player, PlayerProfile, WaiverPoint } from "../types";

type PlayerRow = {
  player_id: string;
  display_name: string | null;
  position: string | null;
  team: string | null;
  espn_id: string | null;
  gsis_id: string | null;
  pfr_id: string | null;
  active: boolean | null;
};

const PROFILE_CACHE_TTL = 30_000;
const MARKET_CACHE_TTL = 30_000;
const profileCache = new Map<string, { expiresAt: number; value: PlayerProfile | null }>();
const marketCache = new Map<string, { expiresAt: number; value: Awaited<ReturnType<typeof buildMarketRows>> }>();
const marketInFlight = new Map<string, Promise<Awaited<ReturnType<typeof buildMarketRows>>>>();

function toPlayer(row: PlayerRow): Player {
  return {
    id: row.player_id,
    name: row.display_name ?? "Unknown player",
    position: row.position,
    team: row.team,
    espnId: row.espn_id,
    gsisId: row.gsis_id,
    pfrId: row.pfr_id,
    active: row.active,
  };
}

const playerIdentitySelect = `
  p.player_id,
  coalesce(nullif(p.display_name, ''), nullif(s.full_name, ''), nullif(x.name, '')) AS display_name,
  coalesce(nullif(p.position, ''), nullif(s.position, ''), nullif(x.position, '')) AS position,
  coalesce(nullif(p.team, ''), nullif(s.team, ''), nullif(x.team, '')) AS team,
  coalesce(nullif(p.espn_id, ''), nullif(s.espn_id, ''), nullif(x.canonical_espn_id, '')) AS espn_id,
  p.active,
  x.gsis_id, x.pfr_id`;

const playerJoins = `
  FROM players p
  LEFT JOIN nflverse_player_xref x ON x.canonical_player_id = p.player_id
  LEFT JOIN sleeper_players s ON s.player_id = coalesce(x.sleeper_player_id, p.player_id)`;

export async function searchPlayers(search = "", limit = 20) {
  const term = search.trim().toLowerCase();
  const where = term
    ? `WHERE lower(coalesce(p.display_name, s.full_name, x.name, '')) LIKE ${sqlString(`%${term}%`)} OR lower(coalesce(p.team, s.team, x.team, '')) LIKE ${sqlString(`%${term}%`)} OR lower(coalesce(p.position, s.position, x.position, '')) = ${sqlString(term)}`
    : "";
  const rows = await queryRows<PlayerRow>(
    `SELECT ${playerIdentitySelect}, p.search_rank ${playerJoins} ${where} ORDER BY coalesce(p.search_rank, 99999), display_name LIMIT ${Math.max(1, Math.min(limit, 5000))}`,
  );
  return rows.map(toPlayer);
}

async function playerById(id: string) {
  const rows = await queryRows<PlayerRow>(
    `SELECT ${playerIdentitySelect} ${playerJoins} WHERE p.player_id = ${sqlString(id)} LIMIT 1`,
  );
  return rows[0] ? toPlayer(rows[0]) : null;
}

async function historyFor(id: string) {
  const [adp, waivers, ranks, xref] = await Promise.all([
    queryRows<{
      captured_at: string;
      source: string;
      adp_format: string | null;
      adp: number | null;
      auction_value: number | null;
    }>(
      `SELECT captured_at, source, adp_format, adp, auction_value FROM adp_snapshots WHERE player_id = ${sqlString(id)} ORDER BY captured_at, source`,
    ),
    queryRows<{
      captured_at: string;
      lookback_hours: number;
      adds: number;
      drops: number;
      net_adds: number;
      add_drop_ratio: number | null;
      activity_status: "reported" | "partial" | "not_listed" | null;
    }>(
      `SELECT captured_at, lookback_hours, adds, drops, net_adds, add_drop_ratio, activity_status FROM waiver_snapshots WHERE player_id = ${sqlString(id)} ORDER BY captured_at, lookback_hours`,
    ),
    queryRows<{ rank: number | null }>(
      `SELECT rank FROM rank_snapshots WHERE player_id = ${sqlString(id)} ORDER BY captured_at DESC LIMIT 1`,
    ),
    queryRows<{
      source: string;
      source_id: string;
      source_name: string | null;
      resolve_tier: string | null;
    }>(
      `SELECT source, source_id, source_name, resolve_tier FROM player_xref WHERE player_id = ${sqlString(id)} QUALIFY row_number() OVER (PARTITION BY source ORDER BY captured_at DESC) = 1 ORDER BY source`,
    ),
  ]);
  const adpHistory: AdpPoint[] = adp.map((row) => ({
    capturedAt: String(row.captured_at),
    source: row.source,
    format: row.adp_format,
    adp: row.adp === null ? null : Number(row.adp),
    auctionValue: row.auction_value === null ? null : Number(row.auction_value),
  }));
  const waiverHistory: WaiverPoint[] = waivers.map((row) => ({
    capturedAt: String(row.captured_at),
    lookbackHours: Number(row.lookback_hours),
    adds: row.adds === null ? null : Number(row.adds),
    drops: row.drops === null ? null : Number(row.drops),
    netAdds: row.net_adds === null ? null : Number(row.net_adds),
    ratio: row.add_drop_ratio === null ? null : Number(row.add_drop_ratio),
    activityStatus: row.activity_status ?? undefined,
  }));
  return {
    adpHistory,
    waiverHistory,
    rank:
      ranks[0]?.rank === null || ranks.length === 0
        ? null
        : Number(ranks[0].rank),
    sourceIds: xref.map((row) => ({
      source: row.source,
      sourceId: String(row.source_id),
      sourceName: row.source_name,
      resolveTier: row.resolve_tier,
    })),
  };
}

async function buildMarketRows(position?: string) {
  const players = await searchPlayers(position ? position : "", 2000);
  const filtered = position
    ? players.filter((player) => player.position?.toLowerCase() === position.toLowerCase())
    : players;
  const [adpRows, waiverRows] = await Promise.all([
    queryRows<{
      player_id: string;
      captured_at: string;
      source: string;
      adp_format: string | null;
      adp: number | null;
      auction_value: number | null;
    }>("SELECT player_id, captured_at, source, adp_format, adp, auction_value FROM adp_snapshots"),
    queryRows<{
      player_id: string;
      captured_at: string;
      lookback_hours: number;
      adds: number;
      drops: number;
      net_adds: number;
      add_drop_ratio: number | null;
      activity_status: "reported" | "partial" | "not_listed" | null;
    }>("SELECT player_id, captured_at, lookback_hours, adds, drops, net_adds, add_drop_ratio, activity_status FROM waiver_snapshots"),
  ]);
  const adpByPlayer = new Map<string, AdpPoint[]>();
  for (const row of adpRows) {
    const list = adpByPlayer.get(row.player_id) ?? [];
    list.push({ capturedAt: String(row.captured_at), source: row.source, format: row.adp_format, adp: row.adp === null ? null : Number(row.adp), auctionValue: row.auction_value === null ? null : Number(row.auction_value) });
    adpByPlayer.set(row.player_id, list);
  }
  const waiverByPlayer = new Map<string, WaiverPoint[]>();
  for (const row of waiverRows) {
    const list = waiverByPlayer.get(row.player_id) ?? [];
    list.push({ capturedAt: String(row.captured_at), lookbackHours: Number(row.lookback_hours), adds: row.adds === null ? null : Number(row.adds), drops: row.drops === null ? null : Number(row.drops), netAdds: row.net_adds === null ? null : Number(row.net_adds), ratio: row.add_drop_ratio === null ? null : Number(row.add_drop_ratio), activityStatus: row.activity_status ?? undefined });
    waiverByPlayer.set(row.player_id, list);
  }
  return filtered.map((player) => {
    const metrics = calculateMetrics(adpByPlayer.get(player.id) ?? [], waiverByPlayer.get(player.id) ?? []);
    const signalResult = buildSignals(metrics);
    return { player, metrics, signals: signalResult.signals, score: signalResult.score };
  });
}

export async function getPlayerProfile(
  id: string,
  selectedWeek?: number,
): Promise<PlayerProfile | null> {
  const cacheKey = `${id}:${selectedWeek ?? "current"}`;
  const cached = profileCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const player = await playerById(id);
  if (!player) {
    profileCache.set(cacheKey, { expiresAt: Date.now() + PROFILE_CACHE_TTL, value: null });
    return null;
  }
  const { adpHistory, waiverHistory, rank, sourceIds } = await historyFor(id);
  const metrics = calculateMetrics(adpHistory, waiverHistory, rank);
  const { signals, score, breakdown } = buildSignals(metrics);
  const phase2 = await getPhase2Profile(
    player,
    adpHistory,
    waiverHistory,
    selectedWeek,
  );
  const marketInsights = buildMarketStatInsights(
    phase2,
    metrics,
    player.position,
  );
  const profile = {
    player,
    sourceIds,
    metrics,
    adpHistory,
    waiverHistory,
    signals,
    score,
    scoreBreakdown: breakdown,
    marketInsights,
    phase2,
  };
  profileCache.set(cacheKey, { expiresAt: Date.now() + PROFILE_CACHE_TTL, value: profile });
  return profile;
}

export async function getAllMarketRows(position?: string) {
  const cacheKey = position?.toUpperCase() ?? "ALL";
  const cached = marketCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const existing = marketInFlight.get(cacheKey);
  if (existing) return existing;
  const pending = buildMarketRows(position);
  marketInFlight.set(cacheKey, pending);
  let value: Awaited<ReturnType<typeof buildMarketRows>>;
  try {
    value = await pending;
  } catch (error) {
    marketInFlight.delete(cacheKey);
    throw error;
  }
  marketInFlight.delete(cacheKey);
  marketCache.set(cacheKey, { expiresAt: Date.now() + MARKET_CACHE_TTL, value });
  return value;
}
