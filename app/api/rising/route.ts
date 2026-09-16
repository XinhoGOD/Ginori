import { NextResponse } from 'next/server';
import { getAllMarketRows } from '../../../lib/data/players';

export async function GET() {
  const rows = await getAllMarketRows();
  return NextResponse.json({ rows: rows.filter((row) => row.metrics.adpMovement['7D'] !== null).sort((a, b) => (b.metrics.adpMovement['7D'] ?? -Infinity) - (a.metrics.adpMovement['7D'] ?? -Infinity)).slice(0, 50) });
}
