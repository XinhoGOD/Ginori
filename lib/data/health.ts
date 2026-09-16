import fs from 'node:fs';
import { queryRows, parquetPath } from './duckdb';

let healthCache: { expiresAt: number; value: Awaited<ReturnType<typeof readDataHealth>> } | null = null;
let healthInFlight: Promise<Awaited<ReturnType<typeof readDataHealth>>> | null = null;

async function readDataHealth() {
  const [adp, players, waiver, unresolved, adpDates, waiverDates, duplicates] = await Promise.all([
    queryRows<{ n: number }>('SELECT count(*) AS n FROM adp_snapshots'),
    queryRows<{ n: number }>('SELECT count(*) AS n FROM players'),
    queryRows<{ n: number }>('SELECT count(*) AS n FROM waiver_snapshots'),
    queryRows<{ n: number }>('SELECT count(*) AS n FROM unresolved'),
    queryRows<{ first: string | null; latest: string | null; days: number }>('SELECT min(captured_at) AS first, max(captured_at) AS latest, count(DISTINCT captured_at) AS days FROM adp_snapshots'),
    queryRows<{ first: string | null; latest: string | null; snapshots: number }>('SELECT min(captured_at) AS first, max(captured_at) AS latest, count(DISTINCT captured_at) AS snapshots FROM waiver_snapshots'),
    queryRows<{ n: number }>('SELECT count(*) AS n FROM (SELECT captured_at, player_id, lookback_hours, count(*) AS c FROM waiver_snapshots GROUP BY ALL HAVING c > 1)')
  ]);
  const unmatchedPath = parquetPath('unmatched_sleeper_players.json');
  let unmatchedSleeperPlayers = 0;
  if (fs.existsSync(unmatchedPath)) {
    try { unmatchedSleeperPlayers = JSON.parse(fs.readFileSync(unmatchedPath, 'utf8')).length; } catch { unmatchedSleeperPlayers = -1; }
  }
  return {
    files: {
      players: fs.existsSync(parquetPath('players.parquet')),
      adpSnapshots: fs.existsSync(parquetPath('adp_snapshots.parquet')),
      waiverSnapshots: fs.existsSync(parquetPath('waiver_snapshots.parquet'))
    },
    counts: { players: Number(players[0]?.n ?? 0), adpSnapshots: Number(adp[0]?.n ?? 0), waiverSnapshots: Number(waiver[0]?.n ?? 0), unresolved: Number(unresolved[0]?.n ?? 0), unmatchedSleeperPlayers },
    adp: { first: adpDates[0]?.first ?? null, latest: adpDates[0]?.latest ?? null, days: Number(adpDates[0]?.days ?? 0) },
    waiver: { first: waiverDates[0]?.first ?? null, latest: waiverDates[0]?.latest ?? null, snapshots: Number(waiverDates[0]?.snapshots ?? 0) },
    duplicateWaiverKeys: Number(duplicates[0]?.n ?? 0),
    now: new Date().toISOString()
  };
}

export async function getDataHealth() {
  if (healthCache && healthCache.expiresAt > Date.now()) return healthCache.value;
  if (healthInFlight) return healthInFlight;
  healthInFlight = readDataHealth();
  try {
    const value = await healthInFlight;
    healthCache = { value, expiresAt: Date.now() + 30_000 };
    return value;
  } finally {
    healthInFlight = null;
  }
}
