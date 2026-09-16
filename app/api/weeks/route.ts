import { NextResponse } from "next/server";
import { getPhase2Weeks } from "../../../lib/data/phase2";

export async function GET() {
  return NextResponse.json(await getPhase2Weeks());
}
