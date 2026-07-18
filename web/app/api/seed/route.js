import { NextResponse } from "next/server";
import { readGames, writeGames, readSeed, blobToken } from "../../../lib/store.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

// GET /api/seed            → statut (token Blob ? nb servis ? nb dans le repo ?)
// GET /api/seed?secret=XXX → écrit le seed EMBARQUÉ (data/games.json du repo) dans le Blob
export async function GET(req) {
  const secret = new URL(req.url).searchParams.get("secret");
  const hasToken = !!blobToken();
  const tokenVar = Object.keys(process.env).find(k => /READ_WRITE_TOKEN$/.test(k)) || null;
  const seed = readSeed();

  if (secret != null) {
    if (!process.env.SEED_SECRET || secret !== process.env.SEED_SECRET)
      return NextResponse.json({ error: "Secret invalide." }, { status: 401 });
    if (!hasToken)
      return NextResponse.json({ error: "Aucun token Blob (*_READ_WRITE_TOKEN manquant)." }, { status: 400 });
    if (!seed.length)
      return NextResponse.json({ error: "Le repo ne contient pas de données (data/games.json vide)." }, { status: 400 });
    const res = await writeGames(seed);
    return NextResponse.json({ ok: true, seeded: res.count });
  }

  const current = await readGames();
  return NextResponse.json({
    hasBlobToken: hasToken,
    tokenVar,
    keysApi: { twitch: !!process.env.TWITCH_ID, itad: !!process.env.ITAD_KEY, seedSecret: !!process.env.SEED_SECRET },
    repoGames: seed.length,
    servedGames: current.length,
  });
}
