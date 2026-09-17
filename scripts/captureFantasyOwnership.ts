import fs from "node:fs/promises";
import path from "node:path";
import { DuckDBInstance } from "@duckdb/node-api";
import { getPhase2Weeks } from "../lib/data/phase2";
import { DATA_DIR, sqlString } from "../lib/data/duckdb";

type EspnPlayer = {
  id?: number | string;
  player?: {
    id?: number | string;
    fullName?: string;
    defaultPositionId?: number;
    ownership?: { percentOwned?: number; percentStarted?: number };
  };
};

const seasonOverride = Number(process.env.FANTASY_SEASON);
const weekOverride = Number(process.env.FANTASY_WEEK);
const timeoutMs = 20_000;

async function main() {
  const state = await getPhase2Weeks();
  const season = Number.isFinite(seasonOverride) && seasonOverride > 0 ? seasonOverride : state.season;
  const week = Number.isFinite(weekOverride) && weekOverride > 0 ? weekOverride : state.currentWeek;
  const endpoint = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${season}/segments/0/leaguedefaults/3?view=kona_player_info&scoringPeriodId=${week}`;
  const response = await fetch(endpoint, {
    headers: {
      Accept: "application/json",
      "User-Agent": "Fantasy Market Tracker/1.0",
      "X-Fantasy-Filter": JSON.stringify({ players: { limit: 2000, sortPercOwned: { sortPriority: 4, sortAsc: false } } }),
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`ESPN ownership request failed: ${response.status}`);
  const body = await response.json() as { players?: EspnPlayer[] };
  const capturedAt = new Date().toISOString();
  const rows = (body.players ?? []).flatMap((entry) => {
    const player = entry.player;
    const espnId = player?.id ?? entry.id;
    const rostered = player?.ownership?.percentOwned;
    const started = player?.ownership?.percentStarted;
    if (espnId === undefined || typeof rostered !== "number") return [];
    return [{
      captured_at: capturedAt,
      season,
      week,
      espn_id: String(espnId),
      rostered_pct: rostered,
      started_pct: typeof started === "number" ? started : null,
    }];
  });
  if (!rows.length) throw new Error("ESPN returned no ownership rows");

  const bronzeDir = path.join(DATA_DIR, "bronze", "fantasy-ownership");
  await fs.mkdir(bronzeDir, { recursive: true });
  await fs.writeFile(path.join(bronzeDir, `${season}-week-${week}-${capturedAt.replaceAll(":", "-")}.json`), JSON.stringify({ endpoint, capturedAt, season, week, players: body.players ?? [] }, null, 2));

  const silverDir = path.join(DATA_DIR, "silver");
  const target = path.join(silverDir, "fantasy_ownership_snapshots.parquet");
  const next = path.join(silverDir, "fantasy_ownership_snapshots.next.parquet");
  const db = await DuckDBInstance.create(":memory:");
  const conn = await db.connect();
  try {
    await conn.run(`CREATE TEMP TABLE incoming AS SELECT * FROM (VALUES ${rows.map((row) => `(${sqlString(row.captured_at)}, ${row.season}, ${row.week}, ${sqlString(row.espn_id)}, ${row.rostered_pct}, ${row.started_pct ?? "NULL"})`).join(",")}) AS t(captured_at, season, week, espn_id, rostered_pct, started_pct)`);
    const incomingPath = path.join(silverDir, "fantasy_ownership_snapshots.incoming.parquet");
    await conn.run(`COPY incoming TO ${sqlString(incomingPath)} (FORMAT PARQUET, COMPRESSION ZSTD)`);
    const source = (await fs.stat(target).catch(() => null))
      ? `[${sqlString(target)}, ${sqlString(incomingPath)}]`
      : sqlString(incomingPath);
    await conn.run(`COPY (SELECT * FROM read_parquet(${source}, union_by_name = true) QUALIFY row_number() OVER (PARTITION BY season, week, espn_id, captured_at ORDER BY captured_at DESC) = 1 ORDER BY season, week, espn_id, captured_at) TO ${sqlString(next)} (FORMAT PARQUET, COMPRESSION ZSTD)`);
  } finally {
    conn.disconnectSync();
  }
  await fs.rm(target, { force: true });
  await fs.rename(next, target);
  await fs.rm(path.join(silverDir, "fantasy_ownership_snapshots.incoming.parquet"), { force: true });
  console.log(`Captured ${rows.length} ESPN ownership rows for ${season} week ${week} at ${capturedAt}`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
