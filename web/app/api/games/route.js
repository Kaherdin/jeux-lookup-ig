import { NextResponse } from "next/server";
import { getGames } from "../../../lib/store.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const games = await getGames();
  return NextResponse.json(games, { headers: { "Cache-Control": "no-store" } });
}
