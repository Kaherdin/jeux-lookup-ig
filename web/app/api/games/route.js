import { NextResponse } from "next/server";
import { readGames } from "../../../lib/store.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const games = await readGames();
  return NextResponse.json(games, { headers: { "Cache-Control": "no-store" } });
}
