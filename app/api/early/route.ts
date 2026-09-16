import { NextResponse } from 'next/server';
import { getAllMarketRows } from '../../../lib/data/players';

export async function GET() {
  const rows = await getAllMarketRows();
  return NextResponse.json({ rows: rows.filter((row) => row.signals.some((signal) => signal.key === 'early-waiver')).sort((a, b) => (b.metrics.netAdds['24H'] ?? -Infinity) - (a.metrics.netAdds['24H'] ?? -Infinity)).slice(0, 50) });
}
