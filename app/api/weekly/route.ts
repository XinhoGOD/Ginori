import { NextResponse } from "next/server";
import { getAllMarketRows, getPlayerProfile } from "../../../lib/data/players";

const WEEKLY_CACHE_TTL = 60_000;
const weeklyCache = new Map<number | string, { expiresAt: number; value: { rows: unknown[] } }>();

export async function GET(request: Request) {
  const requestedWeek = Number(new URL(request.url).searchParams.get("week"));
  const week = Number.isFinite(requestedWeek) ? requestedWeek : undefined;
  const cacheKey = week ?? "current";
  const cached = weeklyCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return NextResponse.json(cached.value);
  const marketRows = await getAllMarketRows();
  const candidates = marketRows
    .filter(
      (row) =>
        row.player.position &&
        ["QB", "RB", "WR", "TE"].includes(row.player.position) &&
        (row.metrics.netAdds["24H"] !== null ||
          (row.metrics.currentAdp !== null && row.metrics.currentAdp <= 220)),
    )
    .sort((a, b) => {
      const aValue =
        (a.metrics.adpMovement["7D"] ?? -Infinity) +
        (a.metrics.netAdds["24H"] ?? 0) / 10000;
      const bValue =
        (b.metrics.adpMovement["7D"] ?? -Infinity) +
        (b.metrics.netAdds["24H"] ?? 0) / 10000;
      return bValue - aValue;
    })
    // The dashboard needs a ranked shortlist, not a full player export. Keeping
    // this pool bounded avoids running a full profile query for every player.
    .slice(0, 24);
  const profiles = await Promise.all(
    candidates.map((row) => getPlayerProfile(row.player.id, week)),
  );
  const rows = profiles
    .filter((profile): profile is NonNullable<typeof profile> =>
      Boolean(profile?.phase2.weeklyMarket),
    )
    .sort((a, b) => {
      const aValue =
        (a.phase2.weeklyMarket?.adpMovement ?? 0) +
        (a.phase2.weeklyMarket?.netAdds ?? 0) / 10000;
      const bValue =
        (b.phase2.weeklyMarket?.adpMovement ?? 0) +
        (b.phase2.weeklyMarket?.netAdds ?? 0) / 10000;
      return bValue - aValue;
    })
    .slice(0, 24)
    .map((profile) => ({
      player: profile.player,
      metrics: profile.metrics,
      phase2: profile.phase2,
    }));
  const value = { rows };
  weeklyCache.set(cacheKey, { expiresAt: Date.now() + WEEKLY_CACHE_TTL, value });
  return NextResponse.json(value);
}
