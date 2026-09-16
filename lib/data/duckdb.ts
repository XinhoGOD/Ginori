import fs from "node:fs";
import path from "node:path";
import { DuckDBInstance, type DuckDBConnection } from "@duckdb/node-api";

const DATA_DIR = path.join(process.cwd(), "data");
const SILVER_DIR = path.join(DATA_DIR, "silver");

function sqlString(value: string) {
  return `'${value.replace(/'/g, "''")}'`;
}

function parquetPath(name: string) {
  return path.join(SILVER_DIR, name);
}

async function createSourceView(
  conn: DuckDBConnection,
  view: string,
  filename: string,
  emptySchema: string,
) {
  const file = parquetPath(filename);
  if (fs.existsSync(file)) {
    await conn.run(
      `CREATE OR REPLACE VIEW ${view} AS SELECT * FROM read_parquet(${sqlString(file)}, union_by_name = true)`,
    );
  } else {
    await conn.run(`CREATE OR REPLACE VIEW ${view} AS ${emptySchema}`);
  }
}

export async function openAnalyticsConnection() {
  const instance = await DuckDBInstance.create(":memory:");
  const conn = await instance.connect();
  await createSourceView(
    conn,
    "players",
    "players.parquet",
    "SELECT CAST(NULL AS VARCHAR) AS player_id, CAST(NULL AS VARCHAR) AS display_name, CAST(NULL AS VARCHAR) AS position, CAST(NULL AS VARCHAR) AS team, CAST(NULL AS VARCHAR) AS espn_id, CAST(NULL AS INTEGER) AS search_rank, CAST(NULL AS BOOLEAN) AS active, CAST(NULL AS DATE) AS captured_at WHERE false",
  );
  await createSourceView(
    conn,
    "adp_snapshots",
    "adp_snapshots.parquet",
    "SELECT CAST(NULL AS VARCHAR) AS player_id, CAST(NULL AS VARCHAR) AS source, CAST(NULL AS VARCHAR) AS adp_format, CAST(NULL AS DOUBLE) AS adp, CAST(NULL AS DOUBLE) AS auction_value, CAST(NULL AS DATE) AS captured_at WHERE false",
  );
  await createSourceView(
    conn,
    "rank_snapshots",
    "rank_snapshots.parquet",
    "SELECT CAST(NULL AS VARCHAR) AS player_id, CAST(NULL AS VARCHAR) AS source, CAST(NULL AS VARCHAR) AS rank_type, CAST(NULL AS INTEGER) AS rank, CAST(NULL AS DOUBLE) AS auction_value, CAST(NULL AS DATE) AS captured_at WHERE false",
  );
  await createSourceView(
    conn,
    "player_xref",
    "player_xref.parquet",
    "SELECT CAST(NULL AS VARCHAR) AS player_id, CAST(NULL AS VARCHAR) AS source, CAST(NULL AS VARCHAR) AS source_id, CAST(NULL AS VARCHAR) AS source_name, CAST(NULL AS VARCHAR) AS resolve_tier, CAST(NULL AS DATE) AS captured_at WHERE false",
  );
  await createSourceView(
    conn,
    "waiver_snapshots",
    "waiver_snapshots.parquet",
    "SELECT CAST(NULL AS TIMESTAMP) AS captured_at, CAST(NULL AS VARCHAR) AS player_id, CAST(NULL AS INTEGER) AS lookback_hours, CAST(NULL AS BIGINT) AS adds, CAST(NULL AS BIGINT) AS drops, CAST(NULL AS BIGINT) AS net_adds, CAST(NULL AS DOUBLE) AS add_drop_ratio, CAST(NULL AS VARCHAR) AS activity_status WHERE false",
  );
  await createSourceView(
    conn,
    "sleeper_players",
    "sleeper_players.parquet",
    "SELECT CAST(NULL AS VARCHAR) AS player_id, CAST(NULL AS VARCHAR) AS full_name, CAST(NULL AS VARCHAR) AS team, CAST(NULL AS VARCHAR) AS position, CAST(NULL AS VARCHAR) AS espn_id, CAST(NULL AS BOOLEAN) AS active WHERE false",
  );
  await createSourceView(
    conn,
    "nflverse_games",
    "nflverse_games.parquet",
    "SELECT CAST(NULL AS VARCHAR) AS game_id, CAST(NULL AS INTEGER) AS season, CAST(NULL AS VARCHAR) AS game_type, CAST(NULL AS INTEGER) AS week, CAST(NULL AS DATE) AS gameday, CAST(NULL AS VARCHAR) AS gametime, CAST(NULL AS VARCHAR) AS weekday, CAST(NULL AS VARCHAR) AS away_team, CAST(NULL AS VARCHAR) AS home_team, CAST(NULL AS VARCHAR) AS away_score, CAST(NULL AS VARCHAR) AS home_score, CAST(NULL AS VARCHAR) AS stadium WHERE false",
  );
  await createSourceView(
    conn,
    "nflverse_player_stats",
    "nflverse_player_stats.parquet",
    "SELECT CAST(NULL AS VARCHAR) AS player_id, CAST(NULL AS VARCHAR) AS player_name, CAST(NULL AS VARCHAR) AS player_display_name, CAST(NULL AS VARCHAR) AS position, CAST(NULL AS INTEGER) AS season, CAST(NULL AS INTEGER) AS week, CAST(NULL AS VARCHAR) AS season_type, CAST(NULL AS VARCHAR) AS game_id, CAST(NULL AS VARCHAR) AS team, CAST(NULL AS VARCHAR) AS opponent_team WHERE false",
  );
  await createSourceView(
    conn,
    "nflverse_snap_counts",
    "nflverse_snap_counts.parquet",
    "SELECT CAST(NULL AS VARCHAR) AS game_id, CAST(NULL AS INTEGER) AS season, CAST(NULL AS VARCHAR) AS game_type, CAST(NULL AS INTEGER) AS week, CAST(NULL AS VARCHAR) AS player, CAST(NULL AS VARCHAR) AS pfr_player_id, CAST(NULL AS VARCHAR) AS position, CAST(NULL AS VARCHAR) AS team, CAST(NULL AS VARCHAR) AS opponent, CAST(NULL AS DOUBLE) AS offense_snaps, CAST(NULL AS DOUBLE) AS offense_pct WHERE false",
  );
  await createSourceView(
    conn,
    "nflverse_players",
    "nflverse_players.parquet",
    "SELECT CAST(NULL AS VARCHAR) AS gsis_id, CAST(NULL AS VARCHAR) AS display_name, CAST(NULL AS VARCHAR) AS sleeper_id, CAST(NULL AS VARCHAR) AS espn_id, CAST(NULL AS VARCHAR) AS pfr_id, CAST(NULL AS VARCHAR) AS position, CAST(NULL AS VARCHAR) AS team WHERE false",
  );
  await createSourceView(
    conn,
    "nflverse_rosters",
    "nflverse_rosters.parquet",
    "SELECT CAST(NULL AS INTEGER) AS season, CAST(NULL AS VARCHAR) AS team, CAST(NULL AS VARCHAR) AS position, CAST(NULL AS VARCHAR) AS gsis_id, CAST(NULL AS VARCHAR) AS sleeper_id, CAST(NULL AS VARCHAR) AS espn_id, CAST(NULL AS VARCHAR) AS pfr_id, CAST(NULL AS VARCHAR) AS full_name, CAST(NULL AS INTEGER) AS week WHERE false",
  );
  await createSourceView(
    conn,
    "nflverse_player_xref",
    "nflverse_player_xref.parquet",
    "SELECT CAST(NULL AS VARCHAR) AS canonical_player_id, CAST(NULL AS VARCHAR) AS sleeper_player_id, CAST(NULL AS VARCHAR) AS gsis_id, CAST(NULL AS VARCHAR) AS canonical_espn_id, CAST(NULL AS VARCHAR) AS pfr_id, CAST(NULL AS VARCHAR) AS name, CAST(NULL AS VARCHAR) AS team, CAST(NULL AS VARCHAR) AS position WHERE false",
  );
  await createSourceView(
    conn,
    "nflverse_ff_playerids",
    "nflverse_ff_playerids.parquet",
    "SELECT CAST(NULL AS VARCHAR) AS gsis_id, CAST(NULL AS VARCHAR) AS sleeper_id, CAST(NULL AS VARCHAR) AS espn_id, CAST(NULL AS VARCHAR) AS pfr_id WHERE false",
  );
  await createSourceView(
    conn,
    "unresolved",
    "unresolved.parquet",
    "SELECT CAST(NULL AS VARCHAR) AS source, CAST(NULL AS VARCHAR) AS source_id, CAST(NULL AS VARCHAR) AS source_name, CAST(NULL AS VARCHAR) AS position, CAST(NULL AS VARCHAR) AS team, CAST(NULL AS VARCHAR) AS reason, CAST(NULL AS DATE) AS captured_at WHERE false",
  );
  return conn;
}

export async function queryRows<T>(sql: string): Promise<T[]> {
  const conn = await openAnalyticsConnection();
  try {
    return (await conn.runAndReadAll(sql)).getRowObjectsJson() as T[];
  } finally {
    conn.disconnectSync();
  }
}

export { DATA_DIR, SILVER_DIR, parquetPath, sqlString };
