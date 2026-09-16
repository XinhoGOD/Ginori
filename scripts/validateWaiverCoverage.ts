import { queryRows } from '../lib/data/duckdb';

async function main() {
  const [coverage, duplicates, teams] = await Promise.all([
    queryRows<{
      lookback_hours: number;
      players: number;
      rows: number;
      not_listed: number;
      partial: number;
    }>(`WITH latest AS (
      SELECT * FROM waiver_snapshots
      WHERE captured_at = (SELECT max(captured_at) FROM waiver_snapshots)
    )
    SELECT lookback_hours,
      count(DISTINCT player_id) AS players,
      count(*) AS rows,
      count(*) FILTER (WHERE activity_status = 'not_listed') AS not_listed,
      count(*) FILTER (WHERE activity_status = 'partial') AS partial
    FROM latest
    GROUP BY lookback_hours
    ORDER BY lookback_hours`),
    queryRows<{ duplicate_keys: number }>(`SELECT count(*) AS duplicate_keys
      FROM (
        SELECT captured_at, player_id, lookback_hours
        FROM waiver_snapshots
        GROUP BY ALL
        HAVING count(*) > 1
      )`),
    queryRows<{ total: number; unresolved_team: number }>(`SELECT
      count(*) AS total,
      count(*) FILTER (WHERE coalesce(nullif(p.team, ''), nullif(s.team, ''), nullif(x.team, '')) IS NULL) AS unresolved_team
      FROM players p
      LEFT JOIN nflverse_player_xref x ON x.canonical_player_id = p.player_id
      LEFT JOIN sleeper_players s ON s.player_id = coalesce(x.sleeper_player_id, p.player_id)`),
  ]);
  const result = { coverage, duplicateKeys: Number(duplicates[0]?.duplicate_keys ?? 0), teams: teams[0] ?? null };
  console.log(JSON.stringify(result, null, 2));
  if (result.duplicateKeys > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error('[validate:waivers] failed', error);
  process.exitCode = 1;
});
