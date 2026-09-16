import { NextRequest, NextResponse } from "next/server";
import { getAllMarketRows } from "../../../lib/data/players";

export async function GET(request: NextRequest) {
  const window = request.nextUrl.searchParams.get("window") ?? "24H";
  const sort = request.nextUrl.searchParams.get("sort") ?? "net";
  const rows = await getAllMarketRows();
  const metric =
    sort === "adds" ? "adds" : sort === "drops" ? "drops" : "netAdds";
  const valueFor = (row: (typeof rows)[number]) =>
    row.metrics[metric][window] ?? -Infinity;
  return NextResponse.json({
    window,
    sort: metric,
    rows: rows
      .filter((row) => row.metrics[metric][window] !== null)
      .sort((a, b) => valueFor(b) - valueFor(a))
      .slice(0, 100),
  });
}
