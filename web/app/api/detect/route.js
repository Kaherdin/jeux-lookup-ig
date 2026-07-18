import { NextResponse } from "next/server";
import { detectMany } from "../../../lib/enrich.mjs";
import { readGames } from "../../../lib/store.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST { text?, playlist? } → détecte les jeux (SANS sauvegarder) pour preview/confirmation
export async function POST(req) {
  let body = {};
  try { body = await req.json(); } catch {}
  const env = {
    TWITCH_ID: process.env.TWITCH_ID,
    TWITCH_SECRET: process.env.TWITCH_SECRET,
    ITAD_KEY: process.env.ITAD_KEY,
    YOUTUBE_API_KEY: process.env.YOUTUBE_API_KEY,
  };
  const existing = (await readGames()).map(g => g.titre);
  const res = await detectMany({ text: body.text || "", playlist: body.playlist || "" }, env, existing);
  if (res.error) return NextResponse.json({ error: res.error }, { status: 400 });
  return NextResponse.json({ games: res.games });
}
