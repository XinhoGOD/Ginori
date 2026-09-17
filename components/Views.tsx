"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AdpChart, StatTrendChart, WaiverChart } from "./Charts";
import { MarketTable, type MarketRow } from "./MarketTable";
import { PlayerVisual } from "./PlayerVisual";
import { SIGNAL_CONFIG } from "../config/signals";
import type {
  DefenseVsPosition,
  MarketStatInsight,
  PlayerProfile,
  StatGame,
  StatLine,
  WeekOption,
  WeeklySummaryRow,
} from "../lib/types";

type ClientCacheEntry = { value: unknown; expiresAt: number };
const clientCache = new Map<string, ClientCacheEntry>();
const clientCacheTtl = (url: string) => url.startsWith("/api/player/") ? 60_000 : url === "/api/weeks" ? 300_000 : 30_000;

const getJson = async <T,>(url: string, signal?: AbortSignal): Promise<T> => {
  const cached = clientCache.get(url);
  if (cached && cached.expiresAt > Date.now()) return cached.value as T;
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error("Request failed");
  const value = await response.json() as T;
  clientCache.set(url, { value, expiresAt: Date.now() + clientCacheTtl(url) });
  return value;
};
const fmt = (value: number | null | undefined, digits = 0) =>
  value === null || value === undefined
    ? "—"
    : value.toLocaleString(undefined, {
        maximumFractionDigits: digits,
        minimumFractionDigits: digits,
      });
const signed = (value: number | null | undefined, digits = 1) =>
  value === null || value === undefined
    ? "—"
    : `${value >= 0 ? "+" : ""}${value.toFixed(digits)}`;
const tone = (value: number | null | undefined) =>
  value === null || value === undefined
    ? "muted"
    : value >= 0
      ? "positive"
      : "negative";

const accelerationLabel = (value: string) =>
  value === "ACCELERATING"
    ? "ACELERANDO"
    : value === "DECELERATING"
      ? "DESACELERANDO"
      : value === "STEADY"
        ? "ESTABLE"
        : "N/A";

const dateLabel = (value: string) => {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
};

const statNumber = (value: number | null | undefined, digits = 0) =>
  value === null || value === undefined
    ? "—"
    : value.toLocaleString(undefined, {
        maximumFractionDigits: digits,
        minimumFractionDigits: digits,
      });
const statPercent = (value: number | null | undefined) =>
  value === null || value === undefined ? "—" : `${(value * 100).toFixed(1)}%`;
const statFields = (position: string | null) => {
  if (position === "QB") {
    return [
      ["Intentos", "attempts"],
      ["Completos", "completions"],
      ["Yardas aéreas", "passingYards"],
      ["TD de pase", "passingTds"],
      ["Intercepciones", "interceptions"],
      ["Carreras", "rushAttempts"],
      ["Yardas terrestres", "rushingYards"],
      ["TD terrestres", "rushingTds"],
    ] as const;
  }
  if (position === "RB") {
    return [
      ["Acarreos", "rushAttempts"],
      ["Yardas terrestres", "rushingYards"],
      ["TD terrestres", "rushingTds"],
      ["Targets", "targets"],
      ["Recepciones", "receptions"],
      ["Yardas recibidas", "receivingYards"],
      ["Toques", "touches"],
      ["Snap %", "snapPctAvg"],
    ] as const;
  }
  return [
    ["Targets", "targets"],
    ["Recepciones", "receptions"],
    ["Yardas recibidas", "receivingYards"],
    ["TD recibidos", "receivingTds"],
    ["Target share", "targetShareAvg"],
    ["Snap %", "snapPctAvg"],
    ["Yardas por recepción", "yardsPerReception"],
  ] as const;
};

function statDisplay(key: string, value: number | null | undefined) {
  if (
    key === "targetShareAvg" ||
    key === "snapPctAvg" ||
    key === "routeParticipationAvg" ||
    key === "opportunityShareAvg"
  )
    return statPercent(value);
  return statNumber(value, key === "yardsPerReception" ? 1 : 0);
}

function trendIndicator(values: number[]) {
  if (values.length < 2) return "";
  const delta = values[values.length - 1] - values[0];
  return delta > 0.05 ? " ↑" : delta < -0.05 ? " ↓" : " →";
}

function StatCards({
  title,
  line,
  position,
}: {
  title: string;
  line: StatLine | null;
  position: string | null;
}) {
  if (!line) return null;
  return (
    <section className="section">
      <div className="section-title">
        <div>
          <h2>{title}</h2>
          <p className="subtle">Totales de partidos registrados.</p>
        </div>
      </div>
      <div className="grid grid-4 stat-grid">
        {statFields(position).map(([label, key]) => {
          const value = line[key];
          if (value === null || value === undefined) return null;
          return (
            <Metric key={key} label={label} value={statDisplay(key, value)} />
          );
        })}
      </div>
    </section>
  );
}

function RecentStats({
  games,
  position,
}: {
  games: StatGame[];
  position: string | null;
}) {
  if (!games.length) return null;
  const visibleGames = games.slice(-5);
  return (
    <section className="section">
      <div className="section-title">
        <div>
          <h2>RECENT FORM</h2>
            <p className="subtle">Últimos cinco partidos; amplía el historial desde la gráfica.</p>
          </div>
      </div>
      <div className="panel stat-sequences">
        <div className="game-strip">
          {visibleGames.map((game) => (
            <span key={game.gameId}>
              {String(game.season).slice(-2)} W{game.week}
              <strong>{game.team ?? "—"} {game.opponent ? `vs ${game.opponent}` : ""}</strong>
            </span>
          ))}
        </div>
        {statFields(position).map(([label, key]) => {
          const values = visibleGames
            .map((game) => game[key])
            .filter(
              (value): value is number => value !== null && value !== undefined,
            );
          if (!values.length) return null;
          return (
            <div className="stat-sequence" key={key}>
              <span>{label}</span>
              <strong>
                {values.map((value) => statDisplay(key, value)).join("  →  ")}
                {trendIndicator(values)}
              </strong>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function OpponentHistoryBlock({
  history,
  summary,
  position,
}: {
  history: StatGame[];
  summary: PlayerProfile["phase2"]["opponentSummary"];
  position: string | null;
}) {
  if (!summary && !history.length) return null;
  const historyLine = (game: StatGame) => {
    if (position === "QB") {
      return `${statNumber(game.completions)}/${statNumber(game.attempts)} cmp · ${statNumber(game.passingYards)} yd · ${statNumber(game.passingTds)} TD · ${statNumber(game.interceptions)} INT`;
    }
    if (position === "RB") {
      return `${statNumber(game.rushAttempts)} car · ${statNumber(game.rushingYards)} yd · ${statNumber(game.rushingTds)} TD · ${statNumber(game.targets)} tgt · ${statNumber(game.receptions)} rec · ${statNumber(game.receivingYards)} yd`;
    }
    return `${statNumber(game.receptions)} rec · ${statNumber(game.receivingYards)} yd · ${statNumber(game.receivingTds)} TD`;
  };
  const summaryFields: Array<[string, number | null | undefined]> =
    position === "QB"
      ? [
          ["Completions", summary?.completionsAvg],
          ["Attempts", summary?.attemptsAvg],
          ["Passing yards", summary?.passingYardsAvg],
          ["Passing TD", summary?.passingTdsAvg],
          ["INT", summary?.interceptionsAvg],
          ["Rushing yards", summary?.rushingYardsAvg],
          ["Rushing TD", summary?.rushingTdsAvg],
        ]
      : position === "RB"
        ? [
            ["Carries", summary?.rushAttemptsAvg],
            ["Rushing yards", summary?.rushingYardsAvg],
            ["Rushing TD", summary?.rushingTdsAvg],
            ["Targets", summary?.targetsAvg],
            ["Receptions", summary?.receptionsAvg],
            ["Receiving yards", summary?.receivingYardsAvg],
            ["Touches", summary?.touchesAvg],
          ]
        : [
            ["Targets", summary?.targetsAvg],
            ["Receptions", summary?.receptionsAvg],
            ["Receiving yards", summary?.receivingYardsAvg],
            ["Receiving TD", summary?.receivingTdsAvg],
          ];
  return (
    <section className="section">
      <div className="section-title">
        <div>
          <h2>VS OPPONENT</h2>
          <p className="subtle">
            Historial observado del jugador contra su próximo rival; no es una
            predicción.
          </p>
        </div>
      </div>
      <div className="grid grid-2">
        <div className="panel">
          <div className="panel-head">
            <h3>Últimos enfrentamientos</h3>
            <span className="subtle">Máximo 4</span>
          </div>
          <div className="history-list">
            {history.map((game) => (
              <div
                className="history-row"
                key={`${game.season}-${game.week}-${game.gameId}`}
              >
                <span>
                  {game.season} · W{game.week}
                </span>
                <strong>{historyLine(game)}</strong>
              </div>
            ))}
          </div>
        </div>
        {summary && (
          <div className="panel">
            <div className="panel-head">
              <h3>Promedios vs {summary.opponent}</h3>
              <span className="subtle">{summary.games} juegos</span>
            </div>
            <div className="grid grid-2 compact-metrics">
              {summaryFields.map(([label, value]) =>
                value === null || value === undefined ? null : (
                  <Metric
                    key={label}
                    label={label}
                    value={statNumber(value, 1)}
                  />
                ),
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function DefenseBlock({
  defense,
  position,
}: {
  defense: DefenseVsPosition | null;
  position: string | null;
}) {
  if (!defense) return null;
  const keys =
    position === "QB"
      ? [
          ["Yardas de pase permitidas", "passingYardsAllowed"],
          ["TD de pase permitidos", "passingTdsAllowed"],
          ["Intercepciones", "interceptionsAllowed"],
          ["Yardas terrestres QB", "qbRushingYardsAllowed"],
        ]
      : position === "RB"
        ? [
            ["Acarreos permitidos", "carriesAllowed"],
            ["Yardas terrestres", "rushingYardsAllowed"],
            ["TD terrestres", "rushingTdsAllowed"],
            ["Targets RB", "targetsAllowed"],
            ["Yardas recibidas RB", "receivingYardsAllowed"],
          ]
        : [
            ["Targets permitidos", "targetsAllowed"],
            ["Recepciones permitidas", "receptionsAllowed"],
            ["Yardas recibidas", "receivingYardsAllowed"],
            ["TD recibidos", "receivingTdsAllowed"],
          ];
  return (
    <section className="section">
      <div className="section-title">
        <div>
          <h2>OPPONENT VS POSITION</h2>
          <p className="subtle">
            {defense.opponent} vs {defense.position} · promedios por juego
            observados esta temporada.
          </p>
        </div>
      </div>
      <div className="grid grid-4 stat-grid">
        {keys.map(([label, key]) => {
          const value = defense[key as keyof DefenseVsPosition] as
            | number
            | null;
          if (value === null || value === undefined) return null;
          const rank = defense.ranks[key];
          return (
            <Metric
              key={key}
              label={label}
              value={`${statNumber(value, 1)}${rank ? ` · ${rank}/${defense.rankTotal}` : ""}`}
              foot={
                rank
                  ? `1 = menos permisiva · ${defense.rankTotal} equipos con datos`
                  : undefined
              }
            />
          );
        })}
      </div>
    </section>
  );
}

function MarketStatInsights({ insights }: { insights: MarketStatInsight[] }) {
  if (!insights.length) return null;
  return (
    <section className="section market-stat-insights">
      <div className="section-title">
        <div>
          <h2>MARKET × STATS</h2>
          <p className="subtle">
            Relaciones observadas entre uso, producción y movimiento Fantasy. No son predicciones.
          </p>
        </div>
      </div>
      <div className="insight-grid">
        {insights.map((insight) => (
          <div className={`insight-card ${insight.tone}`} key={insight.key}>
            <div className="insight-card-head">
              <span className={`badge ${insight.tone}`}>{insight.label}</span>
            </div>
            <p>{insight.detail}</p>
            <div className="insight-evidence">
              {insight.evidence.map((item) => <span key={item}>{item}</span>)}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function useRows(url: string) {
  const [rows, setRows] = useState<MarketRow[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    getJson<{ rows: MarketRow[] }>(url, controller.signal)
      .then((body) => setRows(body.rows ?? []))
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setRows([]);
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [url]);
  return { rows, loading };
}

function WeeklyDashboardSection() {
  const [weeks, setWeeks] = useState<WeekOption[]>([]);
  const [week, setWeek] = useState<number | undefined>();
  const [rows, setRows] = useState<WeeklySummaryRow[]>([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    getJson<{ weeks: WeekOption[] }>("/api/weeks", controller.signal)
      .then((body) => {
        setWeeks(body.weeks ?? []);
        setWeek(body.weeks.find((item) => item.current && !item.locked)?.week ?? 1);
      })
      .catch((error: unknown) => { if (!(error instanceof DOMException && error.name === "AbortError")) setWeeks([]); });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    if (week === undefined) return;
    const controller = new AbortController();
    setLoading(true);
    getJson<{ rows: WeeklySummaryRow[] }>(`/api/weekly?week=${week}`, controller.signal)
      .then((body) => setRows(body.rows ?? []))
      .catch((error: unknown) => { if (!(error instanceof DOMException && error.name === "AbortError")) setRows([]); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [week]);
  if (!weeks.length && !loading) return null;
  return (
    <section className="section weekly-dashboard">
      <div className="summary-toolbar">
        <div>
          <div className="eyebrow">Summary · lectura semanal</div>
          <h2>TE con actividad de mercado</h2>
          <p className="subtle">Rostered 80–89% · Adds/Drops y cambios contra la semana anterior.</p>
        </div>
        <label className="week-select-label">
          <span>Semana</span>
          <select value={week ?? ""} onChange={(event) => setWeek(Number(event.target.value))}>
            {weeks.map((item) => (
              <option key={item.week} value={item.week} disabled={item.locked}>
                {item.label}{item.locked ? " · bloqueada" : ""}
              </option>
            ))}
          </select>
        </label>
      </div>
      {loading ? (
        <div className="empty">Cargando mercado semanal…</div>
      ) : rows.length ? (
        <>
          <div className="panel table-wrap weekly-table summary-table">
            <table>
              <thead>
                <tr>
                  <th>Player</th>
                  <th>Opp</th>
                  <th>Rostered %</th>
                  <th>Rostered Change %</th>
                  <th>Started %</th>
                  <th>Started Change %</th>
                  <th>Adds</th>
                  <th>Drops</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  return (
                    <tr key={row.player.id}>
                      <td>
                        <Link
                          className="player-link"
                          href={`/player/${row.player.id}?week=${row.week}`}
                        >
                          <span className="player-cell">
                            <PlayerVisual
                              name={row.player.name}
                              playerId={row.player.id}
                              espnId={row.player.espnId}
                              team={row.player.team}
                              size="small"
                            />
                            <span>
                              {row.player.name}
                              <span className="player-meta">
                                {row.player.position} ·{" "}
                                {row.player.team ?? "FA"}
                              </span>
                            </span>
                          </span>
                        </Link>
                      </td>
                      <td>{row.opponent ? `vs ${row.opponent}` : "—"}</td>
                      <td>{row.rosteredPct === null ? "—" : `${row.rosteredPct.toFixed(1)}%`}</td>
                      <td className={tone(row.rosteredChangePct)}>{row.rosteredChangePct === null ? "—" : signed(row.rosteredChangePct) + "%"}</td>
                      <td>{row.startedPct === null ? "—" : `${row.startedPct.toFixed(1)}%`}</td>
                      <td className={tone(row.startedChangePct)}>{row.startedChangePct === null ? "—" : signed(row.startedChangePct) + "%"}</td>
                      <td>{fmt(row.adds)}</td>
                      <td>{fmt(row.drops)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="weekly-cards">
            {rows.map((row) => {
              return (
                <Link
                  className="weekly-card"
                  href={`/player/${row.player.id}?week=${row.week}`}
                  key={row.player.id}
                >
                  <div className="player-cell">
                    <PlayerVisual
                      name={row.player.name}
                      playerId={row.player.id}
                      espnId={row.player.espnId}
                      team={row.player.team}
                      size="small"
                    />
                    <span>
                      <strong>{row.player.name}</strong>
                      <span className="player-meta">
                        {row.player.position} · {row.player.team ?? "FA"}
                      </span>
                    </span>
                  </div>
                  <div className="summary-mobile-grid">
                    <span><small>OPP</small><strong>{row.opponent ? `vs ${row.opponent}` : "—"}</strong></span>
                    <span><small>ROSTERED</small><strong>{row.rosteredPct === null ? "—" : `${row.rosteredPct.toFixed(1)}%`}</strong></span>
                    <span><small>STARTED Δ</small><strong className={tone(row.startedChangePct)}>{row.startedChangePct === null ? "—" : signed(row.startedChangePct) + "%"}</strong></span>
                    <span><small>ADDS / DROPS</small><strong>{fmt(row.adds)} / {fmt(row.drops)}</strong></span>
                  </div>
                </Link>
              );
            })}
          </div>
        </>
      ) : (
        <div className="empty">
          No hay TE con Rostered 80–89%, Adds/Drops y cambio de Started % para esta semana.
        </div>
      )}
    </section>
  );
}

export function Dashboard() {
  return (
    <>
      <div className="hero">
        <div className="hero-copy">
          <div className="eyebrow">
            Fantasy Market Tracker · Summary
          </div>
          <h1>Mercado semanal</h1>
          <p>
            Una lectura por semana, sin mezclar históricos: TEs con 80–89% de
            rostered y movimiento observado en Adds/Drops y Started %.
          </p>
        </div>
      </div>
      <WeeklyDashboardSection />
      <div className="footer-note">
        La tabla muestra únicamente la semana seleccionada. Las variaciones de
        Rostered/Started son diferencias de snapshots semanales; Adds/Drops son
        el último snapshot 24H disponible de esa semana.
      </div>
    </>
  );
}

function MarketSection({
  title,
  href,
  rows,
  loading,
  mode,
  compact = false,
}: {
  title: string;
  href: string;
  rows: MarketRow[];
  loading: boolean;
  mode: "rising" | "waivers" | "score" | "position";
  compact?: boolean;
}) {
  return (
    <section className="section">
      <div className="section-title">
        <div>
          <h2>{title}</h2>
          <p className="subtle">
            {mode === "rising"
              ? "Mejora de ADP: un número mayor significa una mejor posición de draft."
              : mode === "waivers"
                ? "Sleeper devuelve jugadores con actividad visible; N/A no significa cero."
                : "Patrones de mercado calculados matemáticamente."}
          </p>
        </div>
        <Link className="subtle" href={href}>
          Ver todo →
        </Link>
      </div>
      {loading ? (
        <div className="empty">Cargando datos de las fuentes…</div>
      ) : (
        <div className="panel">
          <MarketTable
            rows={compact ? rows.slice(0, 6) : rows.slice(0, 10)}
            mode={mode}
          />
        </div>
      )}
    </section>
  );
}

export function MarketList({
  kind,
  title,
  subtitle,
  position,
}: {
  kind: "rising" | "waivers" | "hot" | "early" | "divergences" | "position";
  title: string;
  subtitle: string;
  position?: string;
}) {
  const [window, setWindow] = useState("24H");
  const [waiverSort, setWaiverSort] = useState("net");
  const url =
    kind === "waivers"
      ? `/api/waivers?window=${window}&sort=${waiverSort}`
      : kind === "position"
        ? `/api/position/${position}`
        : `/api/${kind}`;
  const { rows, loading } = useRows(url);
  return (
    <>
      <div className="hero">
        <div className="hero-copy">
          <div className="eyebrow">Pantalla de mercado</div>
          <h1>{title}</h1>
          <p>{subtitle}</p>
        </div>
      </div>
      {kind === "waivers" && (
        <div className="market-controls" style={{ marginBottom: 16 }}>
          <div className="tabs">
            {["24H", "3D", "7D"].map((value) => (
              <button
                className={`tab ${window === value ? "active" : ""}`}
                key={value}
                onClick={() => setWindow(value)}
              >
                {value}
              </button>
            ))}
          </div>
          <div className="tabs">
            {[
              { key: "net", label: "Más net adds" },
              { key: "adds", label: "Más adds" },
              { key: "drops", label: "Más drops" },
            ].map((option) => (
              <button
                className={`tab ${waiverSort === option.key ? "active" : ""}`}
                key={option.key}
                onClick={() => setWaiverSort(option.key)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      )}
      {loading ? (
        <div className="empty">Cargando datos de las fuentes…</div>
      ) : (
        <div className="panel">
          <MarketTable
            rows={rows}
            mode={
              kind === "waivers"
                ? "waivers"
                : kind === "hot" || kind === "early"
                  ? "score"
                  : kind === "position"
                    ? "position"
                    : "rising"
            }
            window={window}
          />
        </div>
      )}
      <div className="footer-note">
        Las señales usan umbrales determinísticos en{" "}
        <code>config/signals.ts</code>. No se utiliza clasificación con LLM.
      </div>
    </>
  );
}

function NflStatsSection({
  phase2,
  position,
  insights,
}: {
  phase2: PlayerProfile["phase2"];
  position: string | null;
  insights: MarketStatInsight[];
}) {
  const hasStats = Boolean(phase2.seasonStats || phase2.recentStats.length || phase2.opponentHistory.length || phase2.defenseVsPosition);
  return (
    <>
      <section className="section nfl-stats-heading">
        <div className="section-title">
          <div>
            <div className="eyebrow">Contexto de rendimiento</div>
            <h2>NFL STATS</h2>
            <p className="subtle">
              Uso reciente, producción de temporada, historial contra el rival y
              defensa actual por posición.
            </p>
            <div className="stats-source-line">
              {phase2.previousStatsSeason ? `Temporada de referencia ${phase2.previousStatsSeason}` : "Sin temporada anterior disponible"} · {phase2.recentStats.length} partidos recientes observados
            </div>
          </div>
        </div>
      </section>
      {!hasStats ? <div className="data-note">No hay suficientes estadísticas registradas para este jugador en las temporadas disponibles. El mercado Fantasy sigue visible y este bloque se completará cuando exista un partido válido.</div> : null}
      <MarketStatInsights insights={insights} />
      <div className="stats-visual-grid">
        <StatTrendChart games={phase2.recentStats} position={position} />
      </div>
      <RecentStats games={phase2.recentStats} position={position} />
      <StatCards
        title={phase2.previousStatsSeason ? `SEASON ${phase2.previousStatsSeason}` : "SEASON"}
        line={phase2.previousSeasonStats}
        position={position}
      />
      {phase2.seasonStats && phase2.statsSeason && (
        <StatCards title={`CURRENT ${phase2.statsSeason}`} line={phase2.seasonStats} position={position} />
      )}
      <OpponentHistoryBlock
        history={phase2.opponentHistory}
        summary={phase2.opponentSummary}
        position={position}
      />
      <DefenseBlock defense={phase2.defenseVsPosition} position={position} />
    </>
  );
}

export function PlayerProfileView({ id }: { id: string }) {
  const [profile, setProfile] = useState<PlayerProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedWeek, setSelectedWeek] = useState<number | undefined>();
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    const query = selectedWeek ? `?week=${selectedWeek}` : "";
    getJson<PlayerProfile>(`/api/player/${id}${query}`, controller.signal)
      .then((body) => {
        setProfile(body);
        if (selectedWeek === undefined)
          setSelectedWeek(body.phase2.selectedWeek);
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) setProfile(null);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => {
      controller.abort();
    };
  }, [id, selectedWeek]);
  if (loading && !profile) return <div className="empty">Cargando perfil de mercado…</div>;
  if (!profile)
    return (
      <div className="empty">Jugador no encontrado en la fuente canónica.</div>
    );
  const { player, metrics } = profile;
  const phase2 = profile.phase2;
  const sourceRows = (() => {
    const latest = new Map<string, (typeof profile.adpHistory)[number]>();
    for (const point of profile.adpHistory) {
      const current = latest.get(point.source);
      if (
        !current ||
        new Date(point.capturedAt).getTime() >=
          new Date(current.capturedAt).getTime()
      )
        latest.set(point.source, point);
    }
    return [...latest.entries()].map(([source, current]) => {
      const first = profile.adpHistory
        .filter((point) => point.source === source)
        .sort(
          (a, b) =>
            new Date(a.capturedAt).getTime() - new Date(b.capturedAt).getTime(),
        )[0];
      return {
        source,
        format: current.format,
        adp: current.adp,
        auctionValue: current.auctionValue,
        firstAdp: first?.adp ?? null,
        movement:
          first?.adp != null && current.adp != null
            ? first.adp - current.adp
            : null,
      };
    });
  })();
  const waiverRows = [...profile.waiverHistory].sort(
    (a, b) =>
      new Date(b.capturedAt).getTime() - new Date(a.capturedAt).getTime(),
  );
  const adpWindows = ["24H", "3D", "7D", "14D", "30D", "FIRST"];
  const marketReading = (() => {
    const adp7 = metrics.adpMovement["7D"];
    const net24 = metrics.netAdds["24H"];
    if (adp7 === null && net24 === null) {
      return {
        title: "Sin lectura suficiente todavía",
        body: "Este jugador aún no tiene observaciones suficientes en ADP y waivers para describir un movimiento de mercado.",
      };
    }
    if (
      adp7 !== null &&
      net24 !== null &&
      Math.abs(adp7) < SIGNAL_CONFIG.EARLY_ADP_STABILITY &&
      net24 >= SIGNAL_CONFIG.EARLY_RECENT_NET &&
      metrics.acceleration === "ACCELERATING"
    ) {
      return {
        title: "Los waivers se están moviendo antes que el ADP",
        body: "La actividad neta reportada por Sleeper es fuerte y está acelerando, mientras el ADP todavía permanece relativamente estable. Es una señal temprana de atención del mercado, no una explicación causal.",
      };
    }
    if (
      adp7 !== null &&
      net24 !== null &&
      adp7 >= SIGNAL_CONFIG.ADP_NOTABLE_MOVE &&
      net24 >= SIGNAL_CONFIG.WAIVER_SURGE_MIN_NET
    ) {
      return {
        title: "ADP y waivers están confirmando el movimiento",
        body: "El jugador está mejorando su posición de draft y también concentra demanda neta en waivers dentro de las ventanas observadas.",
      };
    }
    if (
      adp7 !== null &&
      net24 !== null &&
      adp7 >= SIGNAL_CONFIG.ADP_NOTABLE_MOVE &&
      net24 < 0
    ) {
      return {
        title: "El draft y los waivers están divergiendo",
        body: "El ADP mejora, pero los net adds reportados son negativos. La plataforma muestra la divergencia sin asumir por qué ocurre.",
      };
    }
    if (adp7 !== null && adp7 >= SIGNAL_CONFIG.ADP_NOTABLE_MOVE) {
      return {
        title: "El movimiento comenzó en el mercado de drafts",
        body: "El ADP mejoró de forma notable en 7D, pero la actividad de waivers todavía no alcanza el umbral de surge configurado.",
      };
    }
    if (net24 !== null && net24 >= SIGNAL_CONFIG.WAIVER_SURGE_MIN_NET) {
      return {
        title: "Waivers muestran atención fuerte",
        body: "Los net adds reportados son altos en la ventana más reciente. Revisa la velocidad y la aceleración para saber si la atención está creciendo o enfriándose.",
      };
    }
    return {
      title: "Movimiento mixto o todavía moderado",
      body: "Las observaciones disponibles no activan una señal fuerte de subida de ADP, surge de waivers o confirmación entre ambas fuentes.",
    };
  })();
  return (
    <>
      <div className="profile-head">
        <div>
          <div className="eyebrow">Perfil de mercado del jugador</div>
          <div className="profile-name">
            <PlayerVisual
              name={player.name}
              playerId={player.id}
              espnId={player.espnId}
              team={player.team}
              size="hero"
            />
            <div>
              <h1>{player.name}</h1>
              <div className="player-tag">
                {player.position ?? "—"} · {player.team ?? "FA"} · perfil
                canónico
              </div>
            </div>
          </div>
        </div>
        <div className="score">
          {loading && <span className="subtle">Actualizando semana…</span>}
          <strong>
            {profile.score ?? "—"}
            <small style={{ fontSize: 14, color: "var(--muted)" }}>
              {profile.score === null ? "" : "/100"}
            </small>
          </strong>
          <span>Score del mercado Fantasy</span>
        </div>
      </div>
      <section className="section">
        <div className="panel week-market-panel">
          <div className="panel-head">
            <div>
              <div className="eyebrow">Mercado Fantasy por semana</div>
              <h2>
                WEEK {phase2.selectedWeek} ·{" "}
                {phase2.weeklyMarket?.opponent
                  ? `vs ${phase2.weeklyMarket.opponent}`
                  : "sin matchup"}
              </h2>
              <div className="subtle">
            La ventana va del martes al kickoff del jugador. Cada semana se
            habilita tres días antes de su primer kickoff.
              </div>
            </div>
            <span className="subtle">
              Temporada {phase2.weeks[0]?.season ?? "—"}
            </span>
          </div>
          <div className="week-tabs">
            {phase2.weeks.map((week) => (
              <button
                className={`tab ${phase2.selectedWeek === week.week ? "active" : ""}`}
                disabled={week.locked}
                key={week.week}
                onClick={() => setSelectedWeek(week.week)}
                title={week.locked ? `Semana bloqueada${week.unlocksAt ? ` · se habilita ${dateLabel(week.unlocksAt)}` : ""}` : "Semana disponible"}
              >
                {week.label}
                {week.locked ? " 🔒" : ""}
              </button>
            ))}
          </div>
        </div>
      </section>
      <section className="section">
        <div className="section-title">
          <div>
            <h2>Mercado de la semana</h2>
            <p className="subtle">
              ADP de inicio de ventana contra el último snapshot anterior al
              kickoff. Un ADP menor es mejor.
            </p>
          </div>
          {phase2.weeklyMarket?.kickoffAt && (
            <span className="subtle">
              Kickoff {dateLabel(phase2.weeklyMarket.kickoffAt)}
            </span>
          )}
        </div>
        {phase2.weeklyMarket ? (
          <div className="grid grid-4">
            {phase2.weeklyMarket.adpStart !== null && (
              <Metric
                label="ADP al inicio"
                value={fmt(phase2.weeklyMarket.adpStart, 1)}
                foot="Primer snapshot desde el martes"
              />
            )}
            {phase2.weeklyMarket.adpPregame !== null && (
              <Metric
                label="ADP pregame"
                value={fmt(phase2.weeklyMarket.adpPregame, 1)}
                foot="Último snapshot antes del kickoff"
              />
            )}
            {phase2.weeklyMarket.adpMovement !== null && (
              <Metric
                label="Movimiento ADP"
                value={signed(phase2.weeklyMarket.adpMovement)}
                tone={tone(phase2.weeklyMarket.adpMovement)}
                foot="Positivo = mejora"
              />
            )}
            {phase2.weeklyMarket.netAdds !== null && (
              <Metric
                label="Net adds 24H"
                value={signed(phase2.weeklyMarket.netAdds, 0)}
                tone={tone(phase2.weeklyMarket.netAdds)}
              />
            )}
            {phase2.weeklyMarket.adds !== null && (
              <Metric
                label="Adds reportados"
                value={fmt(phase2.weeklyMarket.adds)}
              />
            )}
            {phase2.weeklyMarket.drops !== null && (
              <Metric
                label="Drops reportados"
                value={fmt(phase2.weeklyMarket.drops)}
              />
            )}
            {phase2.weeklyMarket.ratio !== null && (
              <Metric
                label="Ratio add / drop"
                value={`${fmt(phase2.weeklyMarket.ratio, 2)}x`}
              />
            )}
          </div>
        ) : (
          <div className="empty">
            No hay partido o snapshots suficientes para esta semana.
          </div>
        )}
        <div className="data-note" style={{ marginTop: 16 }}>
          Adds y drops son el último snapshot 24H observado dentro de la
          ventana. No se suman snapshots y no representan nuevas transacciones
          exactas.
        </div>
      </section>
      <section className="section">
        <div className="panel reading-panel">
          <div className="eyebrow">Lectura del movimiento</div>
          <h2>{marketReading.title}</h2>
          <p className="reading-copy">{marketReading.body}</p>
          <div className="reading-evidence">
            Evidencia observada · ADP 7D {signed(metrics.adpMovement["7D"])} ·
            Net adds 24H {fmt(metrics.netAdds["24H"])} · Momentum{" "}
            {metrics.waiverVelocity === null
              ? "N/A"
              : `${signed(metrics.waiverVelocity, 0)} puntos/hora`}{" "}
            · {accelerationLabel(metrics.acceleration)}
          </div>
        </div>
      </section>
      <section className="section">
        <div className="section-title">
          <div>
            <h2>Market details</h2>
            <p className="subtle">
              ADP por fuente, histórico, waivers y señales matemáticas.
            </p>
          </div>
        </div>
      </section>
      <details className="section advanced-data">
        <summary>Advanced Data · cobertura y conexiones</summary>
        <div className="panel">
          <div className="panel-head">
            <div>
              <h2>Identidad y cobertura</h2>
              <div className="subtle">
                Datos básicos del jugador y cobertura disponible
              </div>
            </div>
            <span className={player.active === false ? "negative" : "positive"}>
              {player.active === false ? "INACTIVO" : "ACTIVO"}
            </span>
          </div>
          <div className="grid grid-4">
            <Metric label="Posición" value={player.position ?? "N/A"} />
            <Metric label="Equipo" value={player.team ?? "Agente libre"} />
            <Metric
              label="Fuentes ADP"
              value={
                metrics.adpSources.length
                  ? metrics.adpSources.join(" · ")
                  : "N/A"
              }
            />
          </div>
          <div className="source-pills">
            <span>Perfil reconciliado</span>
            <span>
              {player.espnId
                ? "Foto ESPN disponible"
                : "Foto Sleeper disponible"}
            </span>
            <span>
              {profile.sourceIds.length
                ? `${profile.sourceIds.length} conexiones de fuente`
                : "Sin conexiones adicionales"}
            </span>
          </div>
        </div>
      </details>
      <section className="section">
        <div className="section-title">
          <div>
            <h2>Mercado Fantasy</h2>
            <p className="subtle">
              Un movimiento ADP positivo significa que el jugador mejoró su
              posición de draft.
            </p>
          </div>
        </div>
        <div className="grid grid-4">
          <Metric
            label="ADP actual"
            value={fmt(metrics.currentAdp, 1)}
            foot={metrics.adpSources.join(" · ") || "Sin fuente ADP disponible"}
          />
          <Metric
            label="Valor de subasta"
            value={fmt(metrics.currentAuctionValue, 1)}
            foot="Promedio de la última observación disponible"
          />
          <Metric
            label="Rank"
            value={fmt(metrics.currentRank)}
            foot="Último rank disponible"
          />
          <Metric
            label="Movimiento 24H"
            value={signed(metrics.adpMovement["24H"])}
            tone={tone(metrics.adpMovement["24H"])}
            foot="Snapshot base si existe"
          />
          <Metric
            label="Movimiento 7D"
            value={signed(metrics.adpMovement["7D"])}
            tone={tone(metrics.adpMovement["7D"])}
            foot="Snapshot base si existe"
          />
          <Metric
            label="Movimiento 30D"
            value={signed(metrics.adpMovement["30D"])}
            tone={tone(metrics.adpMovement["30D"])}
            foot="Snapshot base si existe"
          />
        </div>
      </section>
      <div className="grid grid-2 section">
        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>ADP por fuente</h2>
              <div className="subtle">
                Última observación disponible para cada proveedor
              </div>
            </div>
          </div>
          {sourceRows.length ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Fuente</th>
                    <th>Formato</th>
                    <th>ADP</th>
                    <th>Subasta</th>
                    <th>Desde primero</th>
                  </tr>
                </thead>
                <tbody>
                  {sourceRows.map((row) => (
                    <tr key={row.source}>
                      <td>{row.source}</td>
                      <td className="muted">{row.format ?? "—"}</td>
                      <td>{fmt(row.adp, 1)}</td>
                      <td>{fmt(row.auctionValue, 1)}</td>
                      <td className={tone(row.movement)}>
                        {signed(row.movement)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty">No hay observaciones ADP.</div>
          )}
        </section>
        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>Movimientos ADP</h2>
              <div className="subtle">
                ADP inicial menos ADP actual · positivo = mejora
              </div>
            </div>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Ventana</th>
                  <th>Movimiento</th>
                  <th>Lectura</th>
                </tr>
              </thead>
              <tbody>
                {adpWindows.map((window) => (
                  <tr key={window}>
                    <td>
                      {window === "FIRST" ? "Desde primer snapshot" : window}
                    </td>
                    <td className={tone(metrics.adpMovement[window])}>
                      {signed(metrics.adpMovement[window])}
                    </td>
                    <td className="muted">
                      {metrics.adpMovement[window] === null
                        ? "Histórico insuficiente"
                        : metrics.adpMovement[window]! > 0
                          ? "ADP mejorando"
                          : metrics.adpMovement[window]! < 0
                            ? "ADP empeorando"
                            : "Sin cambio"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
      <section className="section">
        <div className="panel">
          <div className="panel-head">
            <div>
              <h2>Histórico ADP</h2>
              <div className="subtle">
                Histórico por fuente · eje invertido para que la mejora suba
              </div>
            </div>
            <span className="subtle">
              Desde el primer snapshot {signed(metrics.adpMovement.FIRST)}
            </span>
          </div>
          <div className="chart">
            <AdpChart points={profile.adpHistory} />
          </div>
        </div>
      </section>
      <section className="section">
        <div className="section-title">
          <div>
            <h2>Mercado de waivers</h2>
            <p className="subtle">
              Actividad reportada por Sleeper en ventanas móviles, conservada
              como observaciones.
            </p>
          </div>
        </div>
        <div className="grid grid-4">
          <Metric label="Adds 24H" value={fmt(metrics.adds["24H"])} />
          <Metric label="Drops 24H" value={fmt(metrics.drops["24H"])} />
          <Metric
            label="Net adds"
            value={
              metrics.netAdds["24H"] === null
                ? "—"
                : `${metrics.netAdds["24H"] >= 0 ? "+" : ""}${fmt(metrics.netAdds["24H"])}`
            }
            tone={tone(metrics.netAdds["24H"])}
          />
          <Metric
            label="Ratio add / drop"
            value={
              metrics.ratios["24H"] === null
                ? "N/A"
                : `${fmt(metrics.ratios["24H"], 2)}x`
            }
            foot={`Net 3D ${fmt(metrics.netAdds["3D"])} · Net 7D ${fmt(metrics.netAdds["7D"])}`}
          />
        </div>
        <div className="table-wrap" style={{ marginTop: 16 }}>
          <table>
            <thead>
              <tr>
                <th>Ventana</th>
                <th>Adds reportados</th>
                <th>Drops reportados</th>
                <th>Net adds</th>
                <th>Ratio</th>
              </tr>
            </thead>
            <tbody>
              {[
                ["24H", "24H"],
                ["3D", "3D"],
                ["7D", "7D"],
              ].map(([label, key]) => (
                <tr key={key}>
                  <td>{label}</td>
                  <td>{fmt(metrics.adds[key])}</td>
                  <td>{fmt(metrics.drops[key])}</td>
                  <td className={tone(metrics.netAdds[key])}>
                    {metrics.netAdds[key] === null
                      ? "N/A"
                      : `${metrics.netAdds[key]! >= 0 ? "+" : ""}${fmt(metrics.netAdds[key])}`}
                  </td>
                  <td>
                    {metrics.ratios[key] === null
                      ? "N/A"
                      : `${fmt(metrics.ratios[key], 2)}x`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {(metrics.adds["24H"] === null || metrics.drops["24H"] === null) && (
          <div className="data-note" style={{ marginTop: 16 }}>
            Sleeper devuelve un ranking de jugadores con más actividad, no un
            censo completo. Si este jugador no aparece en adds o drops, aquí
            mostramos N/A: no significa necesariamente cero actividad.
          </div>
        )}
      </section>
      <section className="section">
        <div className="panel">
          <div className="panel-head">
            <div>
              <h2>Histórico de waivers</h2>
              <div className="subtle">
                Adds, drops y net adds reportados por captura
              </div>
            </div>
            <div
              className={
                metrics.acceleration === "ACCELERATING" ? "positive" : "muted"
              }
            >
              {metrics.waiverVelocity === null
                ? "Momentum —"
                : `Momentum ${signed(metrics.waiverVelocity, 0)} puntos/hora`}{" "}
              · {accelerationLabel(metrics.acceleration)}
            </div>
          </div>
          <div className="chart">
            <WaiverChart points={profile.waiverHistory} />
          </div>
          <div className="panel-head" style={{ marginTop: 24 }}>
            <div>
              <h3>Observaciones recientes</h3>
              <div className="subtle">
                Histórico completo en la gráfica; aquí se muestran las últimas
                60 filas
              </div>
            </div>
          </div>
          {waiverRows.length ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Capturado (hora local)</th>
                    <th>Ventana</th>
                    <th>Adds</th>
                    <th>Drops</th>
                    <th>Net</th>
                    <th>Ratio</th>
                  </tr>
                </thead>
                <tbody>
                  {waiverRows.slice(0, 60).map((row, index) => (
                    <tr key={`${row.capturedAt}-${row.lookbackHours}-${index}`}>
                      <td>{dateLabel(row.capturedAt)}</td>
                      <td>
                        {row.lookbackHours === 24
                          ? "24H"
                          : row.lookbackHours === 72
                            ? "3D"
                            : row.lookbackHours === 168
                              ? "7D"
                              : `${row.lookbackHours}H`}
                      </td>
                      <td>{fmt(row.adds)}</td>
                      <td>{fmt(row.drops)}</td>
                      <td className={tone(row.netAdds)}>
                        {row.netAdds === null
                          ? "N/A"
                          : `${row.netAdds >= 0 ? "+" : ""}${fmt(row.netAdds)}`}
                      </td>
                      <td>
                        {row.ratio === null ? "N/A" : `${fmt(row.ratio, 2)}x`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty">
              Todavía no hay snapshots Sleeper para este jugador.
            </div>
          )}
        </div>
      </section>
      <NflStatsSection phase2={phase2} position={player.position} insights={profile.marketInsights} />
      <section className="section">
        <div className="panel">
          <div className="panel-head">
            <div>
              <h2>Señales de mercado</h2>
              <div className="subtle">
                Solo reglas transparentes · desglose del score{" "}
                {Object.entries(profile.scoreBreakdown)
                  .map(([key, value]) => `${key} ${Math.round(value)}`)
                  .join(" · ")}
              </div>
            </div>
          </div>
          {profile.signals.length ? (
            <div className="signal-list">
              {profile.signals.map((signal) => (
                <div className={`signal-item ${signal.tone}`} key={signal.key}>
                  <span className={`badge ${signal.tone}`}>{signal.label}</span>
                  <div className="signal-detail">{signal.detail}</div>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty">
              No hay una señal configurada activa para las observaciones
              disponibles.
            </div>
          )}
        </div>
      </section>
      <div className="footer-note">
        Movimiento ADP = ADP base menos ADP actual. La velocidad de waivers es
        el cambio de net adds reportados entre snapshots dividido por las horas
        transcurridas; no representa nuevas altas por hora.
      </div>
    </>
  );
}

function Metric({
  label,
  value,
  foot,
  tone: color = "text",
}: {
  label: string;
  value: string;
  foot?: string;
  tone?: string;
}) {
  if (value === "N/A" || value === "—") return null;
  return (
    <div className="metric-card">
      <div className="metric-label">{label}</div>
      <div className={`metric-value ${color}`}>{value}</div>
      {foot && <div className="metric-foot">{foot}</div>}
    </div>
  );
}

export function CompareView() {
  const [query, setQuery] = useState("");
  const [players, setPlayers] = useState<
    Array<{
      id: string;
      name: string;
      team: string | null;
      position: string | null;
    }>
  >([]);
  const [selected, setSelected] = useState<MarketRow[]>([]);
  useEffect(() => {
    if (query.trim().length < 2) {
      setPlayers([]);
      return;
    }
    const timer = setTimeout(
      () =>
        getJson<{ players: typeof players }>(
          `/api/players?q=${encodeURIComponent(query)}`,
        )
          .then((body) => setPlayers(body.players))
          .catch(() => setPlayers([])),
      150,
    );
    return () => clearTimeout(timer);
  }, [query]);
  const add = async (id: string) => {
    if (selected.some((row) => row.player.id === id) || selected.length >= 5)
      return;
    const row = await getJson<MarketRow>(`/api/player/${id}`).catch(() => null);
    if (row) setSelected((current) => [...current, row]);
    setPlayers([]);
    setQuery("");
  };
  const metrics: Array<[string, (row: MarketRow) => string]> = [
    ["ADP actual", (row) => fmt(row.metrics.currentAdp, 1)],
    ["Cambio ADP 7D", (row) => signed(row.metrics.adpMovement["7D"])],
    ["Cambio 30D", (row) => signed(row.metrics.adpMovement["30D"])],
    ["Adds 24H", (row) => fmt(row.metrics.adds["24H"])],
    ["Drops 24H", (row) => fmt(row.metrics.drops["24H"])],
    ["Net adds", (row) => fmt(row.metrics.netAdds["24H"])],
    [
      "Ratio add / drop",
      (row) =>
        row.metrics.ratios["24H"] === null
          ? "N/A"
          : `${fmt(row.metrics.ratios["24H"], 2)}x`,
    ],
    [
      "Momentum",
      (row) =>
        row.metrics.waiverVelocity === null
          ? "—"
          : `${fmt(row.metrics.waiverVelocity, 0)}/h`,
    ],
    ["Aceleración", (row) => accelerationLabel(row.metrics.acceleration)],
    [
      "Score de mercado",
      (row) => (row.score === null ? "—" : `${row.score}/100`),
    ],
  ];
  return (
    <>
      <div className="hero">
        <div className="hero-copy">
          <div className="eyebrow">Vista comparativa</div>
          <h1>Comparar jugadores</h1>
          <p>
            Elige hasta cinco jugadores canónicos y compara los mismos campos
            determinísticos del mercado lado a lado.
          </p>
        </div>
        <div className="search-box">
          <span className="search-icon">⌕</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Agregar jugador…"
          />
          {players.length > 0 && (
            <div className="search-results">
              {players.map((player) => (
                <button
                  className="search-result"
                  key={player.id}
                  onClick={() => add(player.id)}
                >
                  <span>{player.name}</span>
                  <span>
                    {player.team ?? "Agente libre"} · {player.position ?? "—"}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="panel">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Métrica</th>
                {selected.map((row) => (
                  <th key={row.player.id}>
                    <Link
                      className="player-link"
                      href={`/player/${row.player.id}`}
                    >
                      {row.player.name}
                    </Link>
                    <div className="player-meta">
                      {row.player.position} ·{" "}
                      {row.player.team ?? "Agente libre"}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {metrics.map(([label, get]) => (
                <tr key={label}>
                  <td className="muted">{label}</td>
                  {selected.map((row) => (
                    <td key={row.player.id}>{get(row)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {selected.length === 0 && (
          <div className="empty" style={{ marginTop: 14 }}>
            Busca jugadores para iniciar una comparación.
          </div>
        )}
      </div>
    </>
  );
}

export function DataHealthView() {
  const [health, setHealth] = useState<any>(null);
  useEffect(() => {
    getJson("/api/data")
      .then(setHealth)
      .catch(() => setHealth(null));
  }, []);
  if (!health) return <div className="empty">Cargando salud de datos…</div>;
  return (
    <>
      <div className="hero">
        <div className="hero-copy">
          <div className="eyebrow">Observabilidad del pipeline</div>
          <h1>Salud de datos</h1>
          <p>
            Cobertura, frescura y controles de integridad de la capa Parquet
            local.
          </p>
        </div>
      </div>
      <div className="grid grid-3">
        <Metric
          label="Jugadores"
          value={fmt(health.counts.players)}
          foot={
            health.files.players
              ? "players.parquet encontrado"
              : "Falta players.parquet"
          }
        />
        <Metric
          label="Snapshots ADP"
          value={fmt(health.counts.adpSnapshots)}
          foot={`${health.adp.days} días de captura distintos`}
        />
        <Metric
          label="Snapshots waivers"
          value={fmt(health.counts.waiverSnapshots)}
          foot={`${health.waiver.snapshots} capturas distintas`}
        />
      </div>
      <div className="grid grid-2 section">
        <div className="panel">
          <div className="panel-head">
            <h2>Cobertura</h2>
            <span className="subtle">UTC internamente</span>
          </div>
          <div className="health-list">
            <div className="health-row">
              <span>Primer snapshot ADP</span>
              <span>{health.adp.first ?? "—"}</span>
            </div>
            <div className="health-row">
              <span>Último snapshot ADP</span>
              <span>{health.adp.latest ?? "—"}</span>
            </div>
            <div className="health-row">
              <span>Primer snapshot de waivers</span>
              <span>{health.waiver.first ?? "—"}</span>
            </div>
            <div className="health-row">
              <span>Último snapshot de waivers</span>
              <span>{health.waiver.latest ?? "—"}</span>
            </div>
            <div className="health-row">
              <span>Filas de fuente no resueltas</span>
              <span>{fmt(health.counts.unresolved)}</span>
            </div>
            <div className="health-row">
              <span>Jugadores Sleeper no vinculados</span>
              <span>{fmt(health.counts.unmatchedSleeperPlayers)}</span>
            </div>
          </div>
        </div>
        <div className="panel">
          <div className="panel-head">
            <h2>Integridad</h2>
            <span
              className={health.duplicateWaiverKeys ? "warning" : "positive"}
            >
              {health.duplicateWaiverKeys ? "Revisar" : "Limpio"}
            </span>
          </div>
          <div className="health-list">
            <div className="health-row">
              <span>Claves de waivers duplicadas</span>
              <span>{fmt(health.duplicateWaiverKeys)}</span>
            </div>
            <div className="health-row">
              <span>Archivo ADP</span>
              <span>{health.files.adpSnapshots ? "Disponible" : "Falta"}</span>
            </div>
            <div className="health-row">
              <span>Archivo de waivers</span>
              <span>
                {health.files.waiverSnapshots
                  ? "Disponible"
                  : "Aún no capturado"}
              </span>
            </div>
            <div className="health-row">
              <span>Última revisión</span>
              <span>{new Date(health.now).toLocaleString()}</span>
            </div>
          </div>
        </div>
      </div>
      <div className="footer-note">
        Un archivo de waivers faltante no se trata como actividad cero:
        significa que aún no hay observaciones.
      </div>
    </>
  );
}
