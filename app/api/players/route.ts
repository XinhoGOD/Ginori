import { NextRequest, NextResponse } from 'next/server';
import { searchPlayers } from '../../../lib/data/players';

export async function GET(request: NextRequest) {
  const search = request.nextUrl.searchParams.get('q') ?? '';
  return NextResponse.json({ players: await searchPlayers(search) });
}
