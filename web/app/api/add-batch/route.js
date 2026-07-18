import { NextResponse } from "next/server";
import { enrichGame } from "../../../lib/enrich.mjs";
import { getGames, getTitles, createGames } from "../../../lib/store.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// POST { items:[{titre, steamAppId?, source?, input?, psnUrl?}] } → enrichit + insère en lot
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

  const existing = new Set((await getTitles()).map(t => t.toLowerCase()));
  const todo = items.filter(it => it.titre && !existing.has(it.titre.toLowerCase()));

  const enriched = [];
  const CONC = 4;
  for (let i = 0; i < todo.length; i += CONC) {
    const slice = todo.slice(i, i + CONC);
    const res = await Promise.all(slice.map(it =>
      enrichGame({
        titre: it.titre,
        steamAppId: it.steamAppId,
        psnUrl: it.psnUrl,
        reel: (it.source === "instagram" || it.source === "youtube") ? it.input : "",
        ajouteLe: new Date().toISOString().slice(0, 10),
      }, env).catch(() => null)
    ));
    for (const g of res) if (g && g.titre) enriched.push(g);
  }

  let added = 0;
  try {
    added = await createGames(enriched);
  } catch (e) {
    return NextResponse.json({ error: "Échec de sauvegarde : " + (e?.message || e) }, { status: 500 });
  }
  const games = await getGames();
  return NextResponse.json({ ok: true, added, titres: enriched.map(g => g.titre), games });
}
