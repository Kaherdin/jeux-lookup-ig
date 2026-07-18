import { NextResponse } from "next/server";
import { detectTitle, enrichGame } from "../../../lib/enrich.mjs";
import { readGames, writeGames } from "../../../lib/store.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30; // enrichissement multi-API

export async function POST(req) {
  let input = "";
  try { ({ input } = await req.json()); } catch { /* body vide */ }
  input = (input || "").trim();
  if (!input) return NextResponse.json({ error: "Entrée vide" }, { status: 400 });

  const env = {
    TWITCH_ID: process.env.TWITCH_ID,
    TWITCH_SECRET: process.env.TWITCH_SECRET,
    ITAD_KEY: process.env.ITAD_KEY,
  };

  const det = await detectTitle(input);
  if (!det.titre)
    return NextResponse.json({ error: "Impossible de détecter un titre. Tape le nom du jeu directement." }, { status: 422 });

  const games = await readGames();
  const dup = games.find(g => g.titre.toLowerCase() === det.titre.toLowerCase());
  if (dup) return NextResponse.json({ duplicate: true, game: dup, source: det.source, games });

  const g = await enrichGame({
    titre: det.titre,
    steamAppId: det.steamAppId,
    reel: (det.source === "instagram" || det.source === "youtube") ? input : "",
    ajouteLe: new Date().toISOString().slice(0, 10),
  }, env);

  games.unshift(g);
  try {
    await writeGames(games);
  } catch (e) {
    return NextResponse.json({ error: "Enrichi mais échec de sauvegarde : " + (e?.message || e), game: g, games }, { status: 500 });
  }
  return NextResponse.json({ game: g, source: det.source, rawTitle: det.rawTitle || "", games });
}
