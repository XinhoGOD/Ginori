import { NextResponse } from 'next/server';
import { getAllMarketRows } from '../../../../lib/data/players';

export async function GET(_request: Request, context: { params: Promise<{ pos: string }> }) {
  const rows = await getAllMarketRows((await context.params).pos);
  return NextResponse.json({ rows: rows.sort((a, b) => (b.metrics.adpMovement['7D'] ?? -Infinity) - (a.metrics.adpMovement['7D'] ?? -Infinity)).slice(0, 100) });
}
