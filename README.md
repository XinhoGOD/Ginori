# Fantasy Market Tracker

Aplicación web analítica para observar el movimiento del mercado Fantasy NFL. Combina el histórico ADP Parquet de `najibismail95/Fantasy-Football-ADP-Comparison-Tool`, adds/drops reportados por Sleeper y estadísticas descriptivas reales de nflverse. No proyecta rendimiento, no usa LLMs para decidir señales y no inventa datos faltantes.

## Run locally

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

El workspace incluye `players.parquet`, `adp_snapshots.parquet` y `player_xref.parquet` reales bajo `data/silver/`. Si partes de un checkout limpio, coloca esos archivos antes de abrir la app. La columna canónica sigue siendo Sleeper `player_id`; `canonical_players.parquet` se genera con `npm run build:canonical`.

## Datos nflverse y mercado semanal

```bash
npm run prepare:nflverse
# alias de actualización
npm run update:nfl-stats
```

Este comando descarga de las releases públicas actuales de nflverse el calendario NFL, `stats_player_week_*.parquet`, `snap_counts_*.parquet`, players y rosters. También descarga el crosswalk público `db_playerids.csv` de DynastyProcess para reforzar las relaciones Sleeper, GSIS, ESPN y PFR. Preserva los archivos crudos en `data/bronze/nflverse/` y crea `data/silver/nflverse_player_stats.parquet`, `nflverse_snap_counts.parquet`, `nflverse_players.parquet`, `nflverse_rosters.parquet`, `nflverse_ff_playerids.parquet` y `nflverse_player_xref.parquet`. El rango por defecto se detecta dinámicamente como las cuatro temporadas más recientes; se puede sobrescribir con `NFL_STATS_SEASONS=2022,2023,2024,2025`.

La ficha consulta stats por GSIS y snap counts por PFR cuando el crosswalk los resuelve. Nombre + equipo + posición queda como fallback. Snap % sólo se muestra cuando existe en `snap_counts`; nunca se reconstruye a partir de otra estadística. La referencia oficial de nflreadr documenta `load_player_stats()`, `load_snap_counts()`, `load_players()`, `load_rosters()` y `load_schedules()`.

La ventana de mercado semanal empieza el martes y termina en el kickoff real del partido del jugador. El movimiento ADP es `ADP inicial - ADP pregame`, por lo que un valor positivo significa mejora. Adds y drops no se suman: se toma el último snapshot 24H observado dentro de esa ventana y se conserva como observación de una ventana móvil. Las semanas futuras se habilitan automáticamente tres días antes de su primer kickoff.

El dashboard `Summary` es deliberadamente de una sola semana: muestra únicamente TEs con `Rostered %` entre 80 y 89, movimiento de Adds/Drops y cambio de `Started %`. La tabla no mezcla filas históricas. `Rostered %` y `Started %` se capturan desde el endpoint público de ESPN Fantasy; `Rostered Change %` y `Started Change %` son la diferencia entre el último snapshot de la semana elegida y el último snapshot de la semana anterior. Ejecuta `npm run capture:fantasy-ownership` semanalmente para que esas variaciones existan de forma auditable. Si no hay snapshot de la semana anterior, el cambio es nulo y el jugador no se fuerza a aparecer.

```bash
npm run capture:fantasy-ownership
npm run capture:adp
```

La captura conserva la respuesta cruda en `data/bronze/fantasy-ownership/` y agrega `data/silver/fantasy_ownership_snapshots.parquet`. ESPN sí entrega ambos porcentajes en su contexto global de Fantasy; el repositorio ADP original y nflverse no los incluyen.

`npm run capture:adp` reutiliza las configuraciones de los tres clientes del repositorio de referencia: ESPN `kona_player_info`, Sleeper `projections/nfl/regular` y Yahoo `pub-api-ro .../draft_analysis`. Actualiza el ADP del día y reemplaza únicamente la partición de la fecha actual, conservando el histórico anterior. `npm run capture:market` ejecuta en secuencia waivers, ownership y ADP para una actualización manual completa.

## Sleeper capture

```bash
npm run capture:waivers
npm run validate:waivers
```

The command requests the public adds and drops endpoints for 24H, 72H and 168H, saves the raw response under `data/bronze/sleeper/`, and appends an idempotent snapshot to `data/silver/waiver_snapshots.parquet`. Timestamps are UTC. A new run never replaces prior captures; the uniqueness key is `captured_at + player_id + lookback_hours`. Los raw se preservan localmente; el repositorio de despliegue sólo versiona los Parquet procesados para evitar objetos demasiado grandes.

`npm run validate:waivers` comprueba cobertura de jugadores en la última captura, jugadores no listados/parciales, equipos todavía no resueltos y claves duplicadas.

Sleeper devuelve los jugadores con mayor actividad de cada tendencia, hasta 1,000 filas por consulta; no es un feed transaccional de todos los jugadores. En cada captura también se consulta una vez el universo público de jugadores de Sleeper (recomendación de la propia API) y se guarda como `data/silver/sleeper_players.parquet`. Así todos los jugadores de la aplicación reciben una fila de adds/drops por ventana: si no aparecen en la respuesta trending, se muestran como `0` y la fila conserva `activity_status = not_listed`; si sólo aparece una de las dos listas, queda como `partial`. Esto evita dejar jugadores sin cobertura sin presentar un cero como una transacción exacta. Las respuestas completas se preservan en `data/bronze/sleeper/`.

El equipo y la posición de la interfaz se resuelven con prioridad desde ADP, luego Sleeper y finalmente el crosswalk nflverse. Por eso un jugador actual ya no aparece como agente libre sólo porque el Parquet de ADP no trajera su equipo; un jugador histórico que realmente no tiene equipo vigente puede seguir mostrando `FA`.

The command is scheduler-neutral. For a machine cron, run `npm run capture:waivers` every 30 minutes. For GitHub Actions, use a scheduled workflow that checks out the repository, runs `npm ci` and the command, then commits the Parquet/raw files. For Vercel Cron, use the same capture logic behind a protected route and persist the output to object storage; Vercel’s local filesystem is ephemeral, so it must not be the historical store.

## Architecture

```text
Browser → Next.js route handlers → DuckDB in-memory connection → Parquet in data/silver
                                      ↓
                               deterministic metrics
```

The browser never receives a complete Parquet dataset. Player profiles query only the requested player history. Market screens aggregate server-side and return a bounded table.

Important files:

- `lib/data/duckdb.ts` — DuckDB views over the Parquet files.
- `lib/data/players.ts` — player search, profiles and market rows.
- `lib/data/metrics.ts` — ADP movement, ratios, velocity, acceleration and signals.
- `lib/sleeper/` — timeout/retry-aware Sleeper client and trending fetches.
- `scripts/captureWaiverSnapshot.ts` — raw preservation and append-only capture.
- `scripts/captureFantasyOwnership.ts` — snapshots semanales de Rostered/Started.
- `config/signals.ts` — todos los umbrales configurables.
- `lib/data/phase2.ts` — calendario semanal, ADP pregame, historial de hasta 30 partidos, temporada anterior, historial contra rival y defensa vs posición.
- `lib/data/marketInsights.ts` — relaciones determinísticas entre uso/producción y movimiento Fantasy.
- `scripts/prepareNflverseData.ts` — preparación de los datasets reales nflverse.

## Metric definitions

- ADP movement = baseline ADP − current ADP. Therefore ADP 95 → 80 is `+15`.
- Net adds = adds − drops.
- Add/drop ratio = adds ÷ drops. Division by zero or missing observations is shown as `N/A`.
- Waiver velocity = change in reported 24H net adds divided by elapsed hours between snapshots. It is points/hour, not new transactions/hour.
- Acceleration compares recent reported-net velocity with a prior baseline using `WAIVER_ACCELERATION_MULTIPLIER`.
- Early signal requires a real 7D ADP observation, `abs(ADP movement) < EARLY_ADP_STABILITY`, net adds above threshold and accelerating waiver activity.
- Market score is a transparent 0–100 sum of ADP, waiver, acceleration and confirmation components.

## Routes

UI routes: `/`, `/player/[id]`, `/rising`, `/waivers`, `/hot`, `/early`, `/divergences`, `/compare`, `/position/[pos]`, `/data`.

API routes: `/api/players`, `/api/player/[id]`, `/api/player/[id]/adp`, `/api/player/[id]/waivers`, `/api/player/[id]/signals`, `/api/rising`, `/api/weekly`, `/api/weeks`, `/api/waivers`, `/api/hot`, `/api/early`, `/api/divergences`, `/api/position/[pos]`, `/api/data`.

## Validation

```bash
npm run typecheck
npm run validate:metrics
npm run build
```

The independent validation script checks the requested examples: ADP 95 → 80 gives `+15`, adds 14,500 and drops 2,000 give net adds `+12,500`, and the ratio is `7.25x`.
