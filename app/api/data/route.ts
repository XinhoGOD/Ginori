import { NextResponse } from 'next/server';
import { getDataHealth } from '../../../lib/data/health';

export async function GET() {
  return NextResponse.json(await getDataHealth());
}
