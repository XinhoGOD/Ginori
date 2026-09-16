import { NextResponse } from 'next/server';
import { getAllMarketRows } from '../../../lib/data/players';

export async function GET() {
  const rows = await getAllMarketRows();
  return NextResponse.json({ rows: rows.filter((row) => row.score !== null).sort((a, b) => (b.score ?? -Infinity) - (a.score ?? -Infinity)).slice(0, 50) });
}
