import { calculateMetrics } from '../lib/data/metrics';

const metrics = calculateMetrics(
  [
    { capturedAt: '2026-09-01T00:00:00Z', source: 'ESPN', format: 'PPR_1QB', adp: 95, auctionValue: null },
    { capturedAt: '2026-09-08T00:00:00Z', source: 'ESPN', format: 'PPR_1QB', adp: 80, auctionValue: null }
  ],
  [{ capturedAt: '2026-09-13T10:00:00Z', lookbackHours: 24, adds: 14500, drops: 2000, netAdds: 12500, ratio: 7.25 }]
);
if (metrics.adpMovement.FIRST !== 15) throw new Error(`ADP validation failed: ${metrics.adpMovement.FIRST}`);
if (metrics.netAdds['24H'] !== 12500) throw new Error(`net adds validation failed: ${metrics.netAdds['24H']}`);
if (metrics.ratios['24H'] !== 7.25) throw new Error(`ratio validation failed: ${metrics.ratios['24H']}`);
console.log('Metric validation passed: ADP +15, net adds +12,500, ratio 7.25x');
