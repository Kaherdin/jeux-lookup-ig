import { NextResponse } from "next/server";
import { enrichGame } from "../../../lib/enrich.mjs";
import { readGames, writeGames } from "../../../lib/store.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// POST { items:[{titre, steamAppId?, source?, input?, psnUrl?}] } → enrichit + sauvegarde en lot
export async function POST(req) {
  let body = {};
  try { body = await req.json(); } catch {}
  const items = Array.isArray(body.items) ? body.items : [];
  if (!items.length) return NextResponse.json({ error: "Aucun jeu sélectionné." }, { status: 400 });

  const env = {
    TWITCH_ID: process.env.TWITCH_ID,
    TWITCH_SECRET: process.env.TWITCH_SECRET,
    ITAD_KEY: process.env.ITAD_KEY,
  };

  let games = await readGames();
  const seen = new Set(games.map(g => g.titre.toLowerCase()));
  const added = [];

  // enrichissement concurrent limité (4 à la fois)
  const CONC = 4;
  for (let i = 0; i < items.length; i += CONC) {
    const slice = items.slice(i, i + CONC);
    const enriched = await Promise.all(slice.map(it =>
      enrichGame({
        titre: it.titre,
        steamAppId: it.steamAppId,
        psnUrl: it.psnUrl,
        reel: (it.source === "instagram" || it.source === "youtube") ? it.input : "",
        ajouteLe: new Date().toISOString().slice(0, 10),
      }, env).catch(() => null)
    ));
    for (const g of enriched) {
      if (!g || !g.titre) continue;
      const key = g.titre.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      added.push(g);
    }
  }

  games = [...added, ...games];
  try {
    await writeGames(games);
  } catch (e) {
    return NextResponse.json({ error: "Échec de sauvegarde : " + (e?.message || e), added: added.length, games }, { status: 500 });
  }
  return NextResponse.json({ ok: true, added: added.length, titres: added.map(g => g.titre), games });
}
