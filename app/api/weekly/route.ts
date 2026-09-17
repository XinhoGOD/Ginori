import { NextResponse } from "next/server";
import { getWeeklySummary } from "../../../lib/data/weeklySummary";

export async function GET(request: Request) {
  const value = Number(new URL(request.url).searchParams.get("week"));
  const week = Number.isFinite(value) ? value : undefined;
  return NextResponse.json({ rows: await getWeeklySummary(week) });
}
