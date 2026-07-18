import { NextResponse } from "next/server";
import { getGames } from "../../../lib/store.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/seed → statut santé (DB + clés)
export async function GET() {
  let dbGames = 0, dbOk = true, err = null;
  try { dbGames = (await getGames()).length; } catch (e) { dbOk = false; err = String(e?.message || e); }
  return NextResponse.json({
    dbOk, dbGames, err,
    hasDb: !!process.env.POSTGRES_URL,
    keysApi: {
      twitch: !!process.env.TWITCH_ID,
      itad: !!process.env.ITAD_KEY,
      youtube: !!process.env.YOUTUBE_API_KEY,
    },
  });
}
