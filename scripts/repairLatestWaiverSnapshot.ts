/** One-time integrity repair for captures written before full player coverage was added. */
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { DuckDBInstance } from '@duckdb/node-api';
import { DATA_DIR, parquetPath } from '../lib/data/duckdb';

const sql = (value: unknown) => value === null || value === undefined ? 'NULL' : `'${String(value).replace(/'/g, "''")}'`;
const timestampLiteral = (iso: string) => `TIMESTAMP '${iso.replace('T', ' ').replace('Z', '')}'`;

async function main() {
  const target = parquetPath('waiver_snapshots.parquet');
  const rawDir = path.join(DATA_DIR, 'bronze', 'sleeper');
  const rawFile = fs.readdirSync(rawDir).filter((file) => file.endsWith('.json')).sort().at(-1);
  if (!fs.existsSync(target) || !rawFile) throw new Error('No waiver Parquet/raw capture found');
  const raw = JSON.parse(await fsPromises.readFile(path.join(rawDir, rawFile), 'utf8')) as { captured_at: string; trends: Array<{ kind: 'add' | 'drop'; lookbackHours: number; rows: Array<{ player_id: string; count: number }> }>; sleeper_players?: Record<string, { position?: string | null }> };
  const instance = await DuckDBInstance.create(':memory:');
  const conn = await instance.connect();
  try {
    await conn.run(`CREATE TABLE waiver_snapshots AS SELECT * FROM read_parquet(${sql(target)}, union_by_name = true)`);
    await conn.run("ALTER TABLE waiver_snapshots ADD COLUMN IF NOT EXISTS activity_status VARCHAR");
    const canonicalRows = (await conn.runAndReadAll(`SELECT player_id FROM read_parquet(${sql(parquetPath('players.parquet'))})`)).getRowObjectsJson() as Array<{ player_id: string }>;
    const universe = new Set(canonicalRows.map((row) => String(row.player_id)));
    for (const [playerId, player] of Object.entries(raw.sleeper_players ?? {})) {
      if (player.position && ['QB', 'RB', 'WR', 'TE'].includes(player.position)) universe.add(playerId);
    }
    await conn.run(`DELETE FROM waiver_snapshots WHERE captured_at = ${timestampLiteral(raw.captured_at)}`);
    for (const lookbackHours of [24, 72, 168]) {
      const adds = new Map((raw.trends.find((trend) => trend.kind === 'add' && trend.lookbackHours === lookbackHours)?.rows ?? []).map((row) => [row.player_id, row.count]));
      const drops = new Map((raw.trends.find((trend) => trend.kind === 'drop' && trend.lookbackHours === lookbackHours)?.rows ?? []).map((row) => [row.player_id, row.count]));
      const values = [...universe].map((id) => { const hasAdd = adds.has(id); const hasDrop = drops.has(id); const add = hasAdd ? adds.get(id)! : 0; const drop = hasDrop ? drops.get(id)! : 0; const status = hasAdd && hasDrop ? 'reported' : hasAdd || hasDrop ? 'partial' : 'not_listed'; const net = add - drop; const ratio = drop > 0 ? add / drop : null; return `(${timestampLiteral(raw.captured_at)}, ${sql(id)}, ${lookbackHours}, ${add}, ${drop}, ${net}, ${ratio ?? 'NULL'}, ${sql(status)})`; }).join(',');
      if (values) await conn.run(`INSERT INTO waiver_snapshots VALUES ${values}`);
    }
    const temp = `${target}.new`;
    await conn.run(`COPY waiver_snapshots TO ${sql(temp)} (FORMAT PARQUET, COMPRESSION ZSTD)`);
    await fsPromises.rename(temp, target);
    console.log(`Repaired ${raw.captured_at} with complete player coverage and explicit activity_status.`);
  } finally { conn.disconnectSync(); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
