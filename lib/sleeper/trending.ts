import { sleeperFetch } from './client';

export const LOOKBACKS = [24, 72, 168] as const;
export type SleeperTrendRow = { player_id: string; count: number };

export async function fetchTrending(kind: 'add' | 'drop', lookbackHours: number): Promise<SleeperTrendRow[]> {
  const url = `https://api.sleeper.app/v1/players/nfl/trending/${kind}?lookback_hours=${lookbackHours}&limit=1000`;
  const rows = await sleeperFetch<unknown>(url);
  if (!Array.isArray(rows)) throw new Error(`Invalid Sleeper ${kind} response`);
  return rows.flatMap((row) => {
    if (!row || typeof row !== 'object') return [];
    const candidate = row as Record<string, unknown>;
    const playerId = String(candidate.player_id ?? '');
    const count = Number(candidate.count);
    return playerId && Number.isFinite(count) ? [{ player_id: playerId, count }] : [];
  });
}

export async function fetchAllTrending() {
  const output: Array<{ kind: 'add' | 'drop'; lookbackHours: number; rows: SleeperTrendRow[] }> = [];
  for (const lookbackHours of LOOKBACKS) {
    output.push({ kind: 'add', lookbackHours, rows: await fetchTrending('add', lookbackHours) });
    output.push({ kind: 'drop', lookbackHours, rows: await fetchTrending('drop', lookbackHours) });
  }
  return output;
}
