import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import { DuckDBInstance } from '@duckdb/node-api';
import { SILVER_DIR, parquetPath } from '../lib/data/duckdb';

const sql = (value: string) => `'${value.replace(/'/g, "''")}'`;

async function main() {
  const players = parquetPath('players.parquet');
  if (!fs.existsSync(players)) throw new Error('data/silver/players.parquet is required');
  await fsPromises.mkdir(SILVER_DIR, { recursive: true });
  const target = parquetPath('canonical_players.parquet');
  const instance = await DuckDBInstance.create(':memory:');
  const conn = await instance.connect();
  try {
    await conn.run(`COPY (SELECT player_id AS canonical_player_id, display_name AS name, team, position, player_id AS sleeper_player_id, espn_id AS espn_player_id, CAST(NULL AS VARCHAR) AS yahoo_player_id FROM read_parquet(${sql(players)})) TO ${sql(target)} (FORMAT PARQUET, COMPRESSION ZSTD)`);
    console.log(`Built ${target} from the real players parquet.`);
  } finally { conn.disconnectSync(); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
