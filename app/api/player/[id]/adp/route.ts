import { NextResponse } from 'next/server';
import { getPlayerProfile } from '../../../../../lib/data/players';

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const profile = await getPlayerProfile((await context.params).id);
  if (!profile) return NextResponse.json({ error: 'Player not found' }, { status: 404 });
  return NextResponse.json({ history: profile.adpHistory, metrics: profile.metrics });
}
