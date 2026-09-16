import { NextResponse } from 'next/server';
import { getAllMarketRows } from '../../../lib/data/players';

export async function GET() {
  const rows = await getAllMarketRows();
  return NextResponse.json({ rows: rows.filter((row) => row.signals.some((signal) => signal.key.startsWith('divergence'))).sort((a, b) => Math.abs(b.metrics.adpMovement['7D'] ?? 0) - Math.abs(a.metrics.adpMovement['7D'] ?? 0)).slice(0, 50) });
}
