import { NextResponse } from "next/server";
import { getPlayerProfile } from "../../../../lib/data/players";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const requestedWeek = Number(new URL(request.url).searchParams.get("week"));
  const profile = await getPlayerProfile(
    id,
    Number.isFinite(requestedWeek) ? requestedWeek : undefined,
  );
  if (!profile)
    return NextResponse.json({ error: "Player not found" }, { status: 404 });
  return NextResponse.json(profile);
}
