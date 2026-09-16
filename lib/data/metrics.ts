import { SIGNAL_CONFIG, type AccelerationLabel } from "../../config/signals";
import type { AdpPoint, MarketMetrics, Signal, WaiverPoint } from "../types";

const windows: Record<string, number> = {
  "24H": 24,
  "3D": 72,
  "7D": 168,
  "14D": 336,
  "30D": 720,
};

function timestamp(value: string) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function average(values: Array<number | null>) {
  const usable = values.filter(
    (value): value is number => value !== null && Number.isFinite(value),
  );
  return usable.length
    ? usable.reduce((sum, value) => sum + value, 0) / usable.length
    : null;
}

function currentBySource(history: AdpPoint[]) {
  const latest = new Map<string, AdpPoint>();
  for (const point of history) {
    const existing = latest.get(point.source);
    if (
      !existing ||
      timestamp(point.capturedAt) >= timestamp(existing.capturedAt)
    )
      latest.set(point.source, point);
  }
  return latest;
}

function adpAtOrBefore(history: AdpPoint[], cutoff: number) {
  const bySource = new Map<string, AdpPoint>();
  for (const point of history) {
    const time = timestamp(point.capturedAt);
    if (!Number.isFinite(time) || time > cutoff) continue;
    const existing = bySource.get(point.source);
    if (!existing || time > timestamp(existing.capturedAt))
      bySource.set(point.source, point);
  }
  return bySource;
}

function movement(history: AdpPoint[], hours: number, currentTime: number) {
  const current = currentBySource(history);
  const baseline = adpAtOrBefore(history, currentTime - hours * 3_600_000);
  if (!baseline.size || !current.size) return null;
  const currentAverage = average([...current.values()].map((p) => p.adp));
  const baselineAverage = average([...baseline.values()].map((p) => p.adp));
  return currentAverage !== null && baselineAverage !== null
    ? baselineAverage - currentAverage
    : null;
}

function latestWaiver(history: WaiverPoint[], lookback: number) {
  return (
    history
      .filter((point) => point.lookbackHours === lookback)
      .sort((a, b) => timestamp(b.capturedAt) - timestamp(a.capturedAt))[0] ??
    null
  );
}

function velocity(history: WaiverPoint[]) {
  const points = history
    .filter((point) => point.lookbackHours === 24 && point.netAdds !== null)
    .sort((a, b) => timestamp(a.capturedAt) - timestamp(b.capturedAt));
  if (points.length < 2) return null;
  const latest = points.at(-1)!;
  const cutoff =
    timestamp(latest.capturedAt) -
    SIGNAL_CONFIG.VELOCITY_RECENT_HOURS * 3_600_000;
  const prior =
    [...points]
      .reverse()
      .find((point) => timestamp(point.capturedAt) <= cutoff) ?? points.at(-2)!;
  const elapsedHours =
    (timestamp(latest.capturedAt) - timestamp(prior.capturedAt)) / 3_600_000;
  return elapsedHours > 0
    ? (latest.netAdds! - prior.netAdds!) / elapsedHours
    : null;
}

function accelerationState(
  history: WaiverPoint[],
  recentVelocity: number | null,
): AccelerationLabel {
  if (recentVelocity === null) return "N/A";
  const points = history
    .filter((point) => point.lookbackHours === 24 && point.netAdds !== null)
    .sort((a, b) => timestamp(a.capturedAt) - timestamp(b.capturedAt));
  if (points.length < 3) return "N/A";
  const latest = points.at(-1)!;
  const cutoff =
    timestamp(latest.capturedAt) -
    SIGNAL_CONFIG.VELOCITY_BASELINE_HOURS * 3_600_000;
  const baselineStart = [...points]
    .reverse()
    .findIndex((point) => timestamp(point.capturedAt) <= cutoff);
  const index = baselineStart < 0 ? 0 : points.length - 1 - baselineStart;
  const base = points[index];
  const beforeBase = points[index - 1];
  if (!base || !beforeBase) return "N/A";
  const elapsedHours =
    (timestamp(base.capturedAt) - timestamp(beforeBase.capturedAt)) / 3_600_000;
  if (elapsedHours <= 0) return "N/A";
  const baselineVelocity = (base.netAdds! - beforeBase.netAdds!) / elapsedHours;
  if (baselineVelocity === 0)
    return recentVelocity > 0
      ? "ACCELERATING"
      : recentVelocity < 0
        ? "DECELERATING"
        : "STEADY";
  if (
    recentVelocity >
    baselineVelocity * SIGNAL_CONFIG.WAIVER_ACCELERATION_MULTIPLIER
  )
    return "ACCELERATING";
  if (
    recentVelocity <
    baselineVelocity / SIGNAL_CONFIG.WAIVER_ACCELERATION_MULTIPLIER
  )
    return "DECELERATING";
  return "STEADY";
}

export function calculateMetrics(
  adpHistory: AdpPoint[],
  waiverHistory: WaiverPoint[],
  rank?: number | null,
): MarketMetrics {
  const current = currentBySource(adpHistory);
  const currentTime = Math.max(
    ...adpHistory
      .map((point) => timestamp(point.capturedAt))
      .filter(Number.isFinite),
    Date.now(),
  );
  const currentAdp = average([...current.values()].map((point) => point.adp));
  const currentAuctionValue = average(
    [...current.values()].map((point) => point.auctionValue),
  );
  const recentVelocity = velocity(waiverHistory);
  const adds: Record<string, number | null> = {};
  const drops: Record<string, number | null> = {};
  const netAdds: Record<string, number | null> = {};
  const ratios: Record<string, number | null> = {};
  for (const [label, lookback] of [
    ["24H", 24],
    ["3D", 72],
    ["7D", 168],
  ] as const) {
    const row = latestWaiver(waiverHistory, lookback);
    adds[label] = row?.adds ?? null;
    drops[label] = row?.drops ?? null;
    netAdds[label] = row?.netAdds ?? null;
    ratios[label] = row?.ratio ?? null;
  }
  const adpMovement: Record<string, number | null> = {};
  for (const [label, hours] of Object.entries(windows))
    adpMovement[label] = movement(adpHistory, hours, currentTime);
  adpMovement.FIRST =
    adpHistory.length && currentAdp !== null
      ? (adpHistory[0].adp ?? currentAdp) - currentAdp
      : null;
  return {
    currentAdp,
    adpMovement,
    currentAuctionValue,
    currentRank: rank ?? null,
    adds,
    drops,
    netAdds,
    ratios,
    waiverVelocity: recentVelocity,
    acceleration: accelerationState(waiverHistory, recentVelocity),
    adpSources: [...current.keys()].sort(),
  };
}

const signed = (value: number | null, digits = 1) =>
  value === null ? "—" : `${value >= 0 ? "+" : ""}${value.toFixed(digits)}`;

export function buildSignals(metrics: MarketMetrics): {
  signals: Signal[];
  score: number | null;
  breakdown: Record<string, number>;
} {
  const adp7 = metrics.adpMovement["7D"];
  const net24 = metrics.netAdds["24H"];
  const signals: Signal[] = [];
  if (adp7 !== null && adp7 >= SIGNAL_CONFIG.ADP_STRONG_MOVE)
    signals.push({
      key: "adp-rise-strong",
      label: "SUBIDA FUERTE DE ADP",
      tone: "positive",
      detail: `El ADP mejoró ${signed(adp7)} en 7D.`,
    });
  else if (adp7 !== null && adp7 >= SIGNAL_CONFIG.ADP_NOTABLE_MOVE)
    signals.push({
      key: "adp-rise",
      label: "SUBIDA DE ADP",
      tone: "positive",
      detail: `El ADP mejoró ${signed(adp7)} en 7D.`,
    });
  if (net24 !== null && net24 >= SIGNAL_CONFIG.WAIVER_SURGE_MIN_NET)
    signals.push({
      key: "waiver-surge",
      label: "SURGE DE WAIVERS",
      tone: "positive",
      detail: `${net24.toLocaleString()} net adds reportados en la ventana 24H más reciente.`,
    });
  if (metrics.acceleration === "ACCELERATING")
    signals.push({
      key: "waiver-acceleration",
      label: "WAIVERS ACELERANDO",
      tone: "positive",
      detail:
        "La velocidad reciente de net adds reportados está materialmente por encima de su base.",
    });
  if (
    adp7 !== null &&
    net24 !== null &&
    Math.abs(adp7) < SIGNAL_CONFIG.EARLY_ADP_STABILITY &&
    net24 >= SIGNAL_CONFIG.EARLY_RECENT_NET &&
    metrics.acceleration === "ACCELERATING"
  )
    signals.push({
      key: "early-waiver",
      label: "SEÑAL TEMPRANA DE WAIVERS",
      tone: "warning",
      detail:
        "La actividad de waivers es fuerte y acelera mientras el ADP permanece relativamente estable.",
    });
  if (
    adp7 !== null &&
    net24 !== null &&
    adp7 >= SIGNAL_CONFIG.ADP_NOTABLE_MOVE &&
    net24 >= SIGNAL_CONFIG.WAIVER_SURGE_MIN_NET
  )
    signals.push({
      key: "confirmation",
      label: "CONFIRMACIÓN DE MERCADO",
      tone: "positive",
      detail:
        "La mejora del ADP y la demanda de waivers avanzan en la misma dirección.",
    });
  if (
    adp7 !== null &&
    net24 !== null &&
    adp7 >= SIGNAL_CONFIG.ADP_NOTABLE_MOVE &&
    net24 < 0
  )
    signals.push({
      key: "divergence-adds-adp",
      label: "DIVERGENCIA",
      tone: "warning",
      detail: "El ADP mejora mientras los net adds reportados son negativos.",
    });
  if (
    adp7 !== null &&
    net24 !== null &&
    adp7 <= -SIGNAL_CONFIG.ADP_NOTABLE_MOVE &&
    net24 > 0
  )
    signals.push({
      key: "divergence-adp-adds",
      label: "DIVERGENCIA",
      tone: "warning",
      detail: "Los net adds reportados son positivos mientras el ADP empeora.",
    });
  const breakdown = {
    adp:
      adp7 === null
        ? 0
        : Math.min(
            SIGNAL_CONFIG.SCORE_ADP_MAX,
            Math.max(
              0,
              (adp7 / SIGNAL_CONFIG.ADP_STRONG_MOVE) *
                SIGNAL_CONFIG.SCORE_ADP_MAX,
            ),
          ),
    waiver:
      net24 === null
        ? 0
        : Math.min(
            SIGNAL_CONFIG.SCORE_WAIVER_MAX,
            Math.max(
              0,
              (net24 / SIGNAL_CONFIG.WAIVER_SURGE_MIN_NET) *
                SIGNAL_CONFIG.SCORE_WAIVER_MAX,
            ),
          ),
    acceleration:
      metrics.acceleration === "ACCELERATING"
        ? SIGNAL_CONFIG.SCORE_ACCELERATION_MAX
        : metrics.acceleration === "STEADY"
          ? SIGNAL_CONFIG.SCORE_ACCELERATION_MAX / 2
          : 0,
    confirmation:
      adp7 !== null &&
      net24 !== null &&
      adp7 >= SIGNAL_CONFIG.ADP_NOTABLE_MOVE &&
      net24 >= SIGNAL_CONFIG.WAIVER_SURGE_MIN_NET
        ? SIGNAL_CONFIG.SCORE_CONFIRMATION_MAX
        : 0,
  };
  const hasData =
    adp7 !== null || net24 !== null || metrics.waiverVelocity !== null;
  return {
    signals,
    score: hasData
      ? Math.round(
          breakdown.adp +
            breakdown.waiver +
            breakdown.acceleration +
            breakdown.confirmation,
        )
      : null,
    breakdown,
  };
}
