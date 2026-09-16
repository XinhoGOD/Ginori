import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { DuckDBInstance } from "@duckdb/node-api";
import { DATA_DIR, SILVER_DIR, parquetPath } from "../lib/data/duckdb";

const currentSeason = Number(
  process.env.NFL_STATS_SEASON ?? new Date().getUTCFullYear(),
);
const SEASONS = (
  process.env.NFL_STATS_SEASONS?.split(",")
    .map(Number)
    .filter(Number.isFinite) ?? [
    currentSeason - 3,
    currentSeason - 2,
    currentSeason - 1,
    currentSeason,
  ]
).sort((a, b) => a - b);
const BRONZE_DIR = path.join(DATA_DIR, "bronze", "nflverse");
const GAMES_URL =
  "https://github.com/nflverse/nflverse-data/releases/download/schedules/games.csv";
const STATS_URL = (season: number) =>
  `https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_${season}.parquet`;
const SNAP_URL = (season: number) =>
  `https://github.com/nflverse/nflverse-data/releases/download/snap_counts/snap_counts_${season}.parquet`;
const PLAYERS_URL =
  "https://github.com/nflverse/nflverse-data/releases/download/players/players.parquet";
const ROSTER_URL = (season: number) =>
  `https://github.com/nflverse/nflverse-data/releases/download/rosters/roster_${season}.parquet`;
const FF_PLAYERIDS_URL =
  "https://raw.githubusercontent.com/dynastyprocess/data/master/files/db_playerids.csv";

const sql = (value: string) => `'${value.replace(/'/g, "''")}'`;

async function download(url: string, target: string) {
  if (fsSync.existsSync(target) && fsSync.statSync(target).size > 0) return;
  const response = await fetch(url, {
    headers: { "user-agent": "FantasyMarketTracker/2.0" },
  });
  if (!response.ok)
    throw new Error(`nflverse download failed ${response.status}: ${url}`);
  await fs.writeFile(target, Buffer.from(await response.arrayBuffer()));
}

async function main() {
  await fs.mkdir(BRONZE_DIR, { recursive: true });
  await fs.mkdir(SILVER_DIR, { recursive: true });

  const gamesCsv = path.join(BRONZE_DIR, "games.csv");
  await download(GAMES_URL, gamesCsv);
  for (const season of SEASONS) {
    await download(
      STATS_URL(season),
      path.join(BRONZE_DIR, `stats_player_week_${season}.parquet`),
    );
    await download(
      SNAP_URL(season),
      path.join(BRONZE_DIR, `snap_counts_${season}.parquet`),
    );
    await download(
      ROSTER_URL(season),
      path.join(BRONZE_DIR, `roster_${season}.parquet`),
    );
  }
  await download(PLAYERS_URL, path.join(BRONZE_DIR, "players.parquet"));
  await download(FF_PLAYERIDS_URL, path.join(BRONZE_DIR, "ff_playerids.csv"));

  const instance = await DuckDBInstance.create(":memory:");
  const conn = await instance.connect();
  try {
    const gamesTarget = parquetPath("nflverse_games.parquet");
    await conn.run(
      `COPY (
        SELECT game_id, CAST(season AS INTEGER) AS season, game_type,
               CAST(week AS INTEGER) AS week, gameday, gametime, weekday,
               away_team, home_team, away_score, home_score, stadium
        FROM read_csv_auto(${sql(gamesCsv)}, header = true)
      ) TO ${sql(gamesTarget)} (FORMAT PARQUET, COMPRESSION ZSTD)`,
    );

    const statsFiles = SEASONS.map((season) =>
      sql(path.join(BRONZE_DIR, `stats_player_week_${season}.parquet`)),
    ).join(", ");
    const statsTarget = parquetPath("nflverse_player_stats.parquet");
    await conn.run(
      `COPY (
        SELECT * FROM read_parquet([${statsFiles}], union_by_name = true)
      ) TO ${sql(statsTarget)} (FORMAT PARQUET, COMPRESSION ZSTD)`,
    );
    const snapFiles = SEASONS.map((season) =>
      sql(path.join(BRONZE_DIR, `snap_counts_${season}.parquet`)),
    ).join(", ");
    const snapTarget = parquetPath("nflverse_snap_counts.parquet");
    await conn.run(
      `COPY (
        SELECT * FROM read_parquet([${snapFiles}], union_by_name = true)
      ) TO ${sql(snapTarget)} (FORMAT PARQUET, COMPRESSION ZSTD)`,
    );
    const playersTarget = parquetPath("nflverse_players.parquet");
    await conn.run(
      `COPY (SELECT * FROM read_parquet(${sql(path.join(BRONZE_DIR, "players.parquet"))})) TO ${sql(playersTarget)} (FORMAT PARQUET, COMPRESSION ZSTD)`,
    );
    const ffPlayerIdsTarget = parquetPath("nflverse_ff_playerids.parquet");
    await conn.run(
      `COPY (SELECT * FROM read_csv_auto(${sql(path.join(BRONZE_DIR, "ff_playerids.csv"))}, header = true, nullstr = 'NA')) TO ${sql(ffPlayerIdsTarget)} (FORMAT PARQUET, COMPRESSION ZSTD)`,
    );
    const rosterFiles = SEASONS.map((season) =>
      sql(path.join(BRONZE_DIR, `roster_${season}.parquet`)),
    ).join(", ");
    const rosterTarget = parquetPath("nflverse_rosters.parquet");
    await conn.run(
      `COPY (
        SELECT * FROM read_parquet([${rosterFiles}], union_by_name = true)
      ) TO ${sql(rosterTarget)} (FORMAT PARQUET, COMPRESSION ZSTD)`,
    );
    const appPlayersSource = parquetPath("players.parquet");
    const xrefTarget = parquetPath("nflverse_player_xref.parquet");
    await conn.run(
      `COPY (
        WITH latest_roster AS (
          SELECT CAST(sleeper_id AS VARCHAR) AS sleeper_id,
                 CAST(gsis_id AS VARCHAR) AS gsis_id,
                 CAST(pfr_id AS VARCHAR) AS pfr_id
          FROM read_parquet(${sql(rosterTarget)})
          WHERE sleeper_id IS NOT NULL
          QUALIFY row_number() OVER (PARTITION BY CAST(sleeper_id AS VARCHAR) ORDER BY season DESC, week DESC) = 1
        ), latest_ff AS (
          SELECT CAST(sleeper_id AS VARCHAR) AS sleeper_id,
                 NULLIF(CAST(gsis_id AS VARCHAR), 'NA') AS gsis_id,
                 NULLIF(CAST(pfr_id AS VARCHAR), 'NA') AS pfr_id,
                 NULLIF(CAST(espn_id AS VARCHAR), 'NA') AS espn_id
          FROM read_parquet(${sql(ffPlayerIdsTarget)})
          WHERE sleeper_id IS NOT NULL
          QUALIFY row_number() OVER (PARTITION BY CAST(sleeper_id AS VARCHAR) ORDER BY db_season DESC NULLS LAST) = 1
        )
        SELECT p.player_id AS canonical_player_id,
               p.player_id AS sleeper_player_id,
               COALESCE(r.gsis_id, f.gsis_id, CAST(n.gsis_id AS VARCHAR)) AS gsis_id,
               p.espn_id AS canonical_espn_id,
               COALESCE(r.pfr_id, f.pfr_id, CAST(n.pfr_id AS VARCHAR)) AS pfr_id,
               p.display_name AS name,
               p.team,
               p.position
        FROM read_parquet(${sql(appPlayersSource)}) p
        LEFT JOIN latest_roster r ON r.sleeper_id = CAST(p.player_id AS VARCHAR)
        LEFT JOIN latest_ff f ON f.sleeper_id = CAST(p.player_id AS VARCHAR)
        LEFT JOIN read_parquet(${sql(playersTarget)}) n ON CAST(n.espn_id AS VARCHAR) = CAST(p.espn_id AS VARCHAR)
      ) TO ${sql(xrefTarget)} (FORMAT PARQUET, COMPRESSION ZSTD)`,
    );
    console.log(
      JSON.stringify(
        {
          gamesTarget,
          statsTarget,
          snapTarget,
          playersTarget,
          rosterTarget,
          ffPlayerIdsTarget,
          xrefTarget,
          seasons: SEASONS,
        },
        null,
        2,
      ),
    );
  } finally {
    conn.disconnectSync();
  }
}

main().catch((error) => {
  console.error("[prepare:nflverse] failed", error);
  process.exitCode = 1;
});
