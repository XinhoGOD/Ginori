import fs from "node:fs/promises";
import path from "node:path";
import { DuckDBInstance } from "@duckdb/node-api";
import { queryRows, DATA_DIR, sqlString } from "../lib/data/duckdb";
import { LIVE_SOURCES } from "../lib/live/sourceConfig";

type CanonicalRow = {
  player_id: string;
  display_name: string | null;
  position: string | null;
  team: string | null;
  espn_id: string | null;
  sleeper_id: string | null;
  yahoo_id: string | null;
};

type AdpRow = {
  player_id: string;
  source: string;
  adp_format: string;
  adp: number;
  auction_value: number | null;
  captured_at: string;
};

const USER_AGENT = "Fantasy Market Tracker/1.0";
const today = new Date().toISOString().slice(0, 10);

async function getText(url: string, headers: Record<string, string> = {}) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(url, {
        headers: { "user-agent": USER_AGENT, accept: "application/json", ...headers },
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) throw new Error(`${response.status} ${url}`);
      return await response.text();
    } catch (error) {
      lastError = error;
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Source request failed");
}

const normalize = (value: string | null | undefined) =>
  (value ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
const teamKey = (value: string | null | undefined) => value === "LA" ? "LAR" : (value ?? "").toUpperCase();

async function main() {
  const state = JSON.parse(await getText(LIVE_SOURCES.sleeperState)) as { season: string; week: number };
  const season = Number(state.season);
  const players = await queryRows<CanonicalRow>(`WITH latest_xref AS (
      SELECT player_id, source, source_id,
        row_number() OVER (PARTITION BY player_id, source ORDER BY captured_at DESC) AS rn
      FROM player_xref
    )
    SELECT p.player_id, p.display_name, p.position, p.team, p.espn_id,
      max(CASE WHEN x.source = 'SLEEPER' AND x.rn = 1 THEN x.source_id END) AS sleeper_id,
      max(CASE WHEN x.source = 'YAHOO' AND x.rn = 1 THEN x.source_id END) AS yahoo_id
    FROM players p LEFT JOIN latest_xref x ON x.player_id = p.player_id
    GROUP BY p.player_id, p.display_name, p.position, p.team, p.espn_id`);
  const byEspn = new Map(players.flatMap((p) => p.espn_id ? [[String(p.espn_id), p] as const] : []));
  const bySleeper = new Map(players.flatMap((p) => [[String(p.sleeper_id ?? p.player_id), p] as const]));
  const fallback = new Map(players.map((p) => [`${normalize(p.display_name)}:${teamKey(p.team)}:${p.position ?? ""}`, p]));
  const rows: AdpRow[] = [];
  const rawDir = path.join(DATA_DIR, "bronze", "live-market", today);
  await fs.mkdir(rawDir, { recursive: true });

  const espnBody = await getText(LIVE_SOURCES.espn(season), {
    "x-fantasy-filter": JSON.stringify({ players: { limit: 2000, sortDraftRanks: { sortPriority: 100, sortAsc: true, value: "PPR" } } }),
  });
  await fs.writeFile(path.join(rawDir, "espn.json"), espnBody);
  const espn = JSON.parse(espnBody) as { players?: Array<{ player?: { id?: number; fullName?: string; defaultPositionId?: number; ownership?: { averageDraftPosition?: number }; draftRanksByRankType?: Record<string, { auctionValue?: number }> } }> };
  for (const entry of espn.players ?? []) {
    const p = entry.player;
    const adp = p?.ownership?.averageDraftPosition;
    if (!p?.id || typeof adp !== "number" || adp <= 0) continue;
    const canonical = byEspn.get(String(p.id)) ?? fallback.get(`${normalize(p.fullName)}::`);
    if (!canonical) continue;
    rows.push({ player_id: canonical.player_id, source: "ESPN", adp_format: "PPR_1QB", adp, auction_value: p.draftRanksByRankType?.PPR?.auctionValue ?? null, captured_at: today });
  }

  const sleeperBody = await getText(LIVE_SOURCES.sleeperProjections(season));
  await fs.writeFile(path.join(rawDir, "sleeper-projections.json"), sleeperBody);
  const sleeper = JSON.parse(sleeperBody) as Record<string, { adp_ppr?: number } | null>;
  for (const [playerId, stats] of Object.entries(sleeper)) {
    const adp = stats?.adp_ppr;
    const canonical = bySleeper.get(playerId);
    if (!canonical || typeof adp !== "number" || adp <= 0 || adp >= 900) continue;
    rows.push({ player_id: canonical.player_id, source: "SLEEPER", adp_format: "PPR_1QB", adp, auction_value: null, captured_at: today });
  }

  const yahooPages: string[] = [];
  for (let start = 0; start < 400; start += 100) {
    const body = await getText(LIVE_SOURCES.yahooPlayers(start, 100));
    yahooPages.push(body);
    await fs.writeFile(path.join(rawDir, `yahoo-${start}.json`), body);
    const parsed = JSON.parse(body) as { fantasy_content?: { game?: { players?: Array<{ player?: { player_id?: string | number; name?: { full?: string }; display_position?: string; editorial_team_abbr?: string; draft_analysis?: { average_pick?: string | number; average_cost?: string | number } } }> } } };
    const page = parsed.fantasy_content?.game?.players ?? [];
    for (const entry of page) {
      const p = entry.player;
      const adpValue = Number(p?.draft_analysis?.average_pick);
      if (!p?.player_id || !Number.isFinite(adpValue) || adpValue <= 0) continue;
      const direct = players.find((item) => item.yahoo_id === String(p.player_id));
      const fallbackPlayer = fallback.get(`${normalize(p.name?.full)}:${teamKey(p.editorial_team_abbr)}:${p.display_position ?? ""}`);
      const canonical = direct ?? fallbackPlayer;
      if (!canonical) continue;
      const auction = Number(p.draft_analysis?.average_cost);
      rows.push({ player_id: canonical.player_id, source: "YAHOO", adp_format: "YAHOO_DEFAULT", adp: adpValue, auction_value: Number.isFinite(auction) ? auction : null, captured_at: today });
    }
    if (page.length < 100) break;
  }
  if (rows.filter((row) => row.source === "ESPN").length < 200 || rows.filter((row) => row.source === "SLEEPER").length < 200 || rows.filter((row) => row.source === "YAHOO").length < 100) {
    throw new Error(`Live ADP coverage guard failed: ${JSON.stringify(rows.reduce<Record<string, number>>((out, row) => { out[row.source] = (out[row.source] ?? 0) + 1; return out; }, {}))}`);
  }

  const silverDir = path.join(DATA_DIR, "silver");
  const target = path.join(silverDir, "adp_snapshots.parquet");
  const incoming = path.join(silverDir, "adp_snapshots.incoming.parquet");
  const next = path.join(silverDir, "adp_snapshots.next.parquet");
  const db = await DuckDBInstance.create(":memory:");
  const conn = await db.connect();
  try {
    await conn.run(`CREATE TEMP TABLE incoming AS SELECT * FROM (VALUES ${rows.map((row) => `(${sqlString(row.player_id)}, ${sqlString(row.source)}, ${sqlString(row.adp_format)}, ${row.adp}, ${row.auction_value ?? "NULL"}, DATE ${sqlString(row.captured_at)})`).join(",")}) AS t(player_id, source, adp_format, adp, auction_value, captured_at)`);
    await conn.run(`COPY incoming TO ${sqlString(incoming)} (FORMAT PARQUET, COMPRESSION ZSTD)`);
    const source = await fs.stat(target).then(() => `[${sqlString(target)}, ${sqlString(incoming)}]`).catch(() => sqlString(incoming));
    await conn.run(`COPY (SELECT * FROM read_parquet(${source}, union_by_name = true) WHERE captured_at <> DATE ${sqlString(today)} UNION ALL SELECT * FROM read_parquet(${sqlString(incoming)}) ORDER BY captured_at, source, player_id) TO ${sqlString(next)} (FORMAT PARQUET, COMPRESSION ZSTD)`);
  } finally {
    conn.disconnectSync();
  }
  await fs.rm(target, { force: true });
  await fs.rename(next, target);
  await fs.rm(incoming, { force: true });
  console.log(`Captured live ADP: ${rows.length} rows for ${season} (${[...new Set(rows.map((row) => row.source))].join(", ")})`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
