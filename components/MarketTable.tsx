import Link from "next/link";
import type { Signal } from "../lib/types";
import { PlayerVisual } from "./PlayerVisual";

export type MarketRow = {
  player: {
    id: string;
    name: string;
    team: string | null;
    position: string | null;
    espnId?: string | null;
  };
  metrics: {
    currentAdp: number | null;
    adpMovement: Record<string, number | null>;
    adds: Record<string, number | null>;
    drops: Record<string, number | null>;
    netAdds: Record<string, number | null>;
    ratios: Record<string, number | null>;
    waiverVelocity: number | null;
    acceleration: string;
  };
  signals: Signal[];
  score: number | null;
};
const num = (value: number | null | undefined, digits = 0) =>
  value === null || value === undefined
    ? "—"
    : value.toLocaleString(undefined, {
        maximumFractionDigits: digits,
        minimumFractionDigits: digits,
      });
const move = (value: number | null | undefined) =>
  value === null || value === undefined
    ? "—"
    : `${value >= 0 ? "+" : ""}${value.toFixed(1)}`;
const valueTone = (value: number | null | undefined) =>
  value === null || value === undefined
    ? "muted"
    : value >= 0
      ? "positive"
      : "negative";
const signal = (signals: Signal[]) => signals[0];
const acceleration = (value: string) =>
  value === "ACCELERATING"
    ? "ACELERANDO"
    : value === "DECELERATING"
      ? "DESACELERANDO"
      : value === "STEADY"
        ? "ESTABLE"
        : "N/A";

export function MarketTable({
  rows,
  mode = "rising",
  window = "24H",
}: {
  rows: MarketRow[];
  mode?: "rising" | "waivers" | "score" | "position";
  window?: string;
}) {
  if (!rows.length)
    return (
      <div className="empty">
        Aún no hay observaciones reales para esta vista. Agrega los Parquet ADP
        y ejecuta <code>npm run capture:waivers</code>.
      </div>
    );
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Jugador</th>
            <th>POS</th>
            <th>ADP actual</th>
            {mode !== "waivers" && <th>Movimiento 7D</th>}
            <th>{window} adds reportados</th>
            <th>{window} drops reportados</th>
            <th>Net</th>
            <th>Ratio</th>
            <th>Momentum</th>
            <th>Señal</th>
            {mode === "score" && <th>Score</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const tag = signal(row.signals);
            return (
              <tr key={row.player.id}>
                <td>
                  <div className="player-cell">
                    <PlayerVisual
                      name={row.player.name}
                      playerId={row.player.id}
                      espnId={row.player.espnId}
                      team={row.player.team}
                    />
                    <div>
                      <Link
                        className="player-link"
                        href={`/player/${row.player.id}`}
                      >
                        {row.player.name}
                      </Link>
                      <div className="player-meta">
                        {row.player.team ?? "Agente libre"}
                      </div>
                    </div>
                  </div>
                </td>
                <td>{row.player.position ?? "—"}</td>
                <td>{num(row.metrics.currentAdp, 1)}</td>
                {mode !== "waivers" && (
                  <td className={valueTone(row.metrics.adpMovement["7D"])}>
                    {move(row.metrics.adpMovement["7D"])}
                  </td>
                )}
                <td>{num(row.metrics.adds[window])}</td>
                <td>{num(row.metrics.drops[window])}</td>
                <td className={valueTone(row.metrics.netAdds[window])}>
                  {row.metrics.netAdds[window] === null
                    ? "—"
                    : `${(row.metrics.netAdds[window] ?? 0) >= 0 ? "+" : ""}${num(row.metrics.netAdds[window])}`}
                </td>
                <td>
                  {row.metrics.ratios[window] === null
                    ? "N/A"
                    : `${num(row.metrics.ratios[window], 1)}x`}
                </td>
                <td
                  className={
                    row.metrics.acceleration === "ACCELERATING"
                      ? "positive"
                      : row.metrics.acceleration === "DECELERATING"
                        ? "negative"
                        : "muted"
                  }
                >
                  {row.metrics.waiverVelocity === null
                    ? "—"
                    : `${row.metrics.waiverVelocity >= 0 ? "+" : ""}${num(row.metrics.waiverVelocity, 0)}/h`}
                  <div className="player-meta">
                    {acceleration(row.metrics.acceleration)}
                  </div>
                </td>
                <td>
                  {tag ? (
                    <span className={`badge ${tag.tone}`}>{tag.label}</span>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
                {mode === "score" && (
                  <td className="positive">{row.score ?? "—"}</td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
