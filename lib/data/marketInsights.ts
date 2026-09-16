import { SIGNAL_CONFIG } from "../../config/signals";
import type { MarketMetrics, MarketStatInsight, Phase2Profile, StatGame, StatLine } from "../types";

type RoleMetric = {
  label: string;
  usage: (line: StatLine | StatGame) => number | null;
  production: (line: StatLine | StatGame) => number | null;
  unit: string;
};

const sumNullable = (a: number | null, b: number | null) =>
  a === null || b === null ? null : a + b;

function roleMetric(position: string | null): RoleMetric {
  if (position === "QB") {
    return {
      label: "intentos",
      usage: (line) => line.attempts,
      production: (line) => line.passingYards,
      unit: "intentos",
    };
  }
  if (position === "RB") {
    return {
      label: "toques",
      usage: (line) => line.touches,
      production: (line) => sumNullable(line.rushingYards, line.receivingYards),
      unit: "toques",
    };
  }
  return {
    label: "targets",
    usage: (line) => line.targets,
    production: (line) => line.receivingYards,
    unit: "targets",
  };
}

function average(lines: Array<StatLine | StatGame>, read: (line: StatLine | StatGame) => number | null) {
  const values = lines.map(read).filter((value): value is number => value !== null && Number.isFinite(value));
  return values.length ? values.reduce((total, value) => total + value, 0) / values.length : null;
}

function number(value: number | null, digits = 1) {
  return value === null ? "—" : value.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

function percentChange(recent: number, baseline: number) {
  if (baseline === 0) return recent > 0 ? 1 : 0;
  return (recent - baseline) / Math.abs(baseline);
}

function marketEvidence(metrics: MarketMetrics) {
  const adp = metrics.adpMovement["7D"];
  const net = metrics.netAdds["24H"];
  return {
    adp,
    net,
    adpText: adp === null ? "ADP 7D sin dato" : `ADP 7D ${adp >= 0 ? "+" : ""}${adp.toFixed(1)}`,
    netText: net === null ? "Net adds 24H sin dato" : `Net adds 24H ${net >= 0 ? "+" : ""}${net.toLocaleString()}`,
  };
}

export function buildMarketStatInsights(
  phase2: Phase2Profile,
  metrics: MarketMetrics,
  position: string | null,
): MarketStatInsight[] {
  const role = roleMetric(position);
  const recent = phase2.recentStats;
  const season = phase2.previousSeasonStats ?? phase2.seasonStats;
  const market = marketEvidence(metrics);
  const insights: MarketStatInsight[] = [];
  const recentUsage = average(recent, role.usage);
  const seasonUsageValue = season ? role.usage(season) : null;
  const seasonProductionValue = season ? role.production(season) : null;
  const seasonUsage = season && season.games > 0 && seasonUsageValue !== null ? seasonUsageValue / season.games : null;
  const recentProduction = average(recent, role.production);
  const seasonProduction = season && season.games > 0 && seasonProductionValue !== null ? seasonProductionValue / season.games : null;
  const firstUsage = recent.length ? role.usage(recent[0]) : null;
  const lastUsage = recent.length ? role.usage(recent[recent.length - 1]) : null;
  const usageRising = firstUsage !== null && lastUsage !== null && recent.length >= SIGNAL_CONFIG.STATS_TREND_MIN_GAMES && lastUsage > firstUsage;
  const marketRising = (market.adp !== null && market.adp >= SIGNAL_CONFIG.ADP_NOTABLE_MOVE) || (market.net !== null && market.net >= SIGNAL_CONFIG.WAIVER_SURGE_MIN_NET);
  const earlyMarket = market.net !== null && market.net >= SIGNAL_CONFIG.EARLY_RECENT_NET && (market.adp === null || Math.abs(market.adp) < SIGNAL_CONFIG.EARLY_ADP_STABILITY);

  if (recentUsage !== null && seasonUsage !== null) {
    const change = percentChange(recentUsage, seasonUsage);
    if (change >= SIGNAL_CONFIG.STATS_USAGE_RISE_MIN) {
      insights.push({
        key: "recent-usage-support",
        label: "USO RECIENTE RESPALDA EL MOVIMIENTO",
        tone: "positive",
        detail: `Los últimos ${recent.length} partidos muestran más ${role.label} que la temporada de referencia. Esto coincide con una atención Fantasy más fuerte; no demuestra causalidad.`,
        evidence: [`${role.label}: ${number(seasonUsage)} por juego en la temporada de referencia → ${number(recentUsage)} recientes`, market.adpText, market.netText],
      });
    } else if (change <= -SIGNAL_CONFIG.STATS_USAGE_RISE_MIN && marketRising) {
      insights.push({
        key: "market-usage-divergence",
        label: "MERCADO ARRIBA · USO RECIENTE ABAJO",
        tone: "warning",
        detail: `El mercado se está moviendo, pero el uso reciente de ${role.label} está por debajo de la temporada de referencia. La plataforma marca la divergencia sin explicar el motivo.`,
        evidence: [`${role.label}: ${number(seasonUsage)} por juego → ${number(recentUsage)} recientes`, market.adpText, market.netText],
      });
    }
  }

  if (usageRising && marketRising) {
    insights.push({
      key: "market-and-usage-trend",
      label: earlyMarket ? "SEÑAL TEMPRANA CON USO CRECIENTE" : "MERCADO Y USO EN LA MISMA DIRECCIÓN",
      tone: "positive",
      detail: earlyMarket
        ? `Los waivers ya muestran demanda mientras el ADP aún permanece estable; la secuencia reciente de ${role.label} también sube.`
        : `El movimiento Fantasy coincide con una secuencia creciente de ${role.label} en los últimos partidos observados.`,
      evidence: [`${role.label}: ${number(firstUsage)} → ${number(lastUsage)}`, market.adpText, market.netText],
    });
  } else if (marketRising && recent.length >= SIGNAL_CONFIG.STATS_TREND_MIN_GAMES) {
    insights.push({
      key: "market-without-usage-confirmation",
      label: "ATENCIÓN DE MERCADO SIN CONFIRMACIÓN DE USO",
      tone: "warning",
      detail: `ADP/waivers están mejorando, pero la secuencia reciente de ${role.label} no sube de forma sostenida. Es una lectura de datos, no una recomendación.`,
      evidence: [`${role.label}: ${number(firstUsage)} → ${number(lastUsage)}`, market.adpText, market.netText],
    });
  }

  if (recentProduction !== null && seasonProduction !== null) {
    const change = percentChange(recentProduction, seasonProduction);
    if (change >= SIGNAL_CONFIG.STATS_USAGE_RISE_MIN && marketRising) {
      insights.push({
        key: "production-support",
        label: "PRODUCCIÓN RECIENTE AL ALZA",
        tone: "positive",
        detail: "La producción por partido reciente está por encima de la temporada de referencia y acompaña el movimiento Fantasy observado.",
        evidence: [`Producción: ${number(seasonProduction)} por juego → ${number(recentProduction)} recientes`, market.adpText, market.netText],
      });
    }
  }

  if (!insights.length && recent.length) {
    insights.push({
      key: "no-confirmation",
      label: "SIN CONFIRMACIÓN ESTADÍSTICA FUERTE",
      tone: "neutral",
      detail: "Hay datos recientes, pero no activan una relación matemática clara entre el movimiento Fantasy y el uso/producción observados.",
      evidence: [market.adpText, market.netText],
    });
  }
  return insights.slice(0, 3);
}
