import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { DuckDBInstance } from '@duckdb/node-api';
import { fetchAllTrending } from '../lib/sleeper/trending';
import { fetchSleeperPlayers } from '../lib/sleeper/players';
import { DATA_DIR, SILVER_DIR, parquetPath } from '../lib/data/duckdb';

type SnapshotRow = {
  captured_at: string;
  player_id: string;
  lookback_hours: number;
  adds: number;
  drops: number;
  net_adds: number;
  add_drop_ratio: number | null;
  activity_status: 'reported' | 'partial' | 'not_listed';
};

type SleeperPlayerRow = {
  player_id: string;
  full_name: string | null;
  team: string | null;
  position: string | null;
  espn_id: string | null;
  active: boolean | null;
};

const sql = (value: unknown) => {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'NULL';
  return `'${String(value).replace(/'/g, "''")}'`;
};

function asTimestampLiteral(iso: string) {
  return `TIMESTAMP '${iso.replace('T', ' ').replace('Z', '')}'`;
}

async function main() {
  await fs.mkdir(path.join(DATA_DIR, 'bronze', 'sleeper'), { recursive: true });
  await fs.mkdir(SILVER_DIR, { recursive: true });
  const capturedAt = new Date().toISOString();
  const trends = await fetchAllTrending();
  const sleeperPlayers = await fetchSleeperPlayers();
  const rawPath = path.join(DATA_DIR, 'bronze', 'sleeper', `${capturedAt.replace(/[:.]/g, '-')}.json`);
  await fs.writeFile(rawPath, JSON.stringify({ captured_at: capturedAt, trends, sleeper_players: sleeperPlayers }, null, 2), 'utf8');

  const canonical = new Set<string>();
  const existingPlayers = parquetPath('players.parquet');
  const instance = await DuckDBInstance.create(':memory:');
  const conn = await instance.connect();
  try {
    if (fsSync.existsSync(existingPlayers)) {
      const rows = (await conn.runAndReadAll(`SELECT player_id FROM read_parquet(${sql(existingPlayers)})`)).getRowObjectsJson() as Array<{ player_id: string }>;
      rows.forEach((row) => canonical.add(String(row.player_id)));
    }
    const sleeperPlayerRows: SleeperPlayerRow[] = Object.entries(sleeperPlayers).map(([playerId, player]) => ({
      player_id: playerId,
      full_name: player.full_name ?? null,
      team: player.team ?? null,
      position: player.position ?? null,
      espn_id: player.espn_id ?? null,
      active: player.active ?? null,
    }));
    await conn.run('CREATE TABLE sleeper_players (player_id VARCHAR, full_name VARCHAR, team VARCHAR, position VARCHAR, espn_id VARCHAR, active BOOLEAN)');
    for (let i = 0; i < sleeperPlayerRows.length; i += 500) {
      const chunk = sleeperPlayerRows.slice(i, i + 500).map((row) => `(${sql(row.player_id)}, ${sql(row.full_name)}, ${sql(row.team)}, ${sql(row.position)}, ${sql(row.espn_id)}, ${row.active === null ? 'NULL' : row.active ? 'TRUE' : 'FALSE'})`).join(',');
      if (chunk) await conn.run(`INSERT INTO sleeper_players VALUES ${chunk}`);
    }
    const sleeperTarget = parquetPath('sleeper_players.parquet');
    const sleeperTemp = `${sleeperTarget}.new`;
    await conn.run(`COPY sleeper_players TO ${sql(sleeperTemp)} (FORMAT PARQUET, COMPRESSION ZSTD)`);
    await fs.rename(sleeperTemp, sleeperTarget);

    const universe = new Set<string>(canonical);
    for (const [playerId, player] of Object.entries(sleeperPlayers)) {
      if (player.position && ['QB', 'RB', 'WR', 'TE'].includes(player.position)) universe.add(playerId);
    }
    const byWindow = new Map<number, { adds: Map<string, number>; drops: Map<string, number> }>();
    for (const trend of trends) {
      const bucket = byWindow.get(trend.lookbackHours) ?? { adds: new Map(), drops: new Map() };
      for (const row of trend.rows) (trend.kind === 'add' ? bucket.adds : bucket.drops).set(String(row.player_id), Number(row.count));
      byWindow.set(trend.lookbackHours, bucket);
    }
    const rows: SnapshotRow[] = [];
    const unmatched = new Set<string>();
    for (const [lookbackHours, bucket] of byWindow) {
      for (const playerId of universe) {
        const hasAdds = bucket.adds.has(playerId);
        const hasDrops = bucket.drops.has(playerId);
        const adds = hasAdds ? bucket.adds.get(playerId)! : 0;
        const drops = hasDrops ? bucket.drops.get(playerId)! : 0;
        if (!canonical.has(playerId)) unmatched.add(playerId);
        const netAdds = adds - drops;
        const activityStatus = hasAdds && hasDrops ? 'reported' : hasAdds || hasDrops ? 'partial' : 'not_listed';
        rows.push({ captured_at: capturedAt, player_id: playerId, lookback_hours: lookbackHours, adds, drops, net_adds: netAdds, add_drop_ratio: drops > 0 ? adds / drops : null, activity_status: activityStatus });
      }
    }
    const target = parquetPath('waiver_snapshots.parquet');
    if (fsSync.existsSync(target)) {
      await conn.run(`CREATE TABLE waiver_snapshots AS SELECT * FROM read_parquet(${sql(target)}, union_by_name = true)`);
      await conn.run("ALTER TABLE waiver_snapshots ADD COLUMN IF NOT EXISTS activity_status VARCHAR");
    } else {
      await conn.run('CREATE TABLE waiver_snapshots (captured_at TIMESTAMP, player_id VARCHAR, lookback_hours INTEGER, adds BIGINT, drops BIGINT, net_adds BIGINT, add_drop_ratio DOUBLE, activity_status VARCHAR)');
    }
    await conn.run(`DELETE FROM waiver_snapshots WHERE captured_at = ${asTimestampLiteral(capturedAt)}`);
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500).map((row) => `(${asTimestampLiteral(row.captured_at)}, ${sql(row.player_id)}, ${row.lookback_hours}, ${row.adds}, ${row.drops}, ${row.net_adds}, ${row.add_drop_ratio ?? 'NULL'}, ${sql(row.activity_status)})`).join(',');
      if (chunk) await conn.run(`INSERT INTO waiver_snapshots VALUES ${chunk}`);
    }
    const temp = `${target}.new`;
    await conn.run(`COPY waiver_snapshots TO ${sql(temp)} (FORMAT PARQUET, COMPRESSION ZSTD)`);
    await fs.rename(temp, target);
    const unresolvedPath = path.join(DATA_DIR, 'silver', 'unmatched_sleeper_players.json');
    await fs.writeFile(unresolvedPath, JSON.stringify([...unmatched].map((playerId) => ({ playerId, name: sleeperPlayers[playerId]?.full_name ?? null, team: sleeperPlayers[playerId]?.team ?? null, position: sleeperPlayers[playerId]?.position ?? null })), null, 2), 'utf8');
    console.log(JSON.stringify({ capturedAt, rows: rows.length, sleeperPlayers: sleeperPlayerRows.length, lookbacks: [...byWindow.keys()], unmatched: unmatched.size, rawPath, target }, null, 2));
  } finally {
    conn.disconnectSync();
  }
}

main().catch((error) => {
  console.error('[capture:waivers] failed', error);
  process.exitCode = 1;
});
