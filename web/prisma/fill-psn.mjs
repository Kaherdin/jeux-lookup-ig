/**
 * Remplit `urlPsn` et `prixPsn` sur les jeux déjà au catalogue.
 *
 * Le pipeline d'enrichissement sait désormais le faire tout seul, mais rejouer un
 * rescan complet sur 576 jeux rappellerait Steam, ITAD et le LLM — cher, long, et sans
 * rapport avec ce qu'on cherche ici. Ce script ne fait que les deux appels utiles :
 * le lien via IGDB (par lots), puis le prix sur la fiche du store.
 *
 * Usage : node prisma/fill-psn.mjs            → aperçu, n'écrit rien
 *         node prisma/fill-psn.mjs --go       → écrit
 *         node prisma/fill-psn.mjs --go --limit=20
 */
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { prixPsn } from "../lib/psn-store.mjs";

for (const f of [".env.local", ".env"]) {
  try {
    for (const line of readFileSync(new URL(`../${f}`, import.meta.url), "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z_0-9]+)\s*=\s*(.*)\s*$/);
      if (m) process.env[m[1]] ??= m[2].trim().replace(/^["']|["']$/g, "");
    }
  } catch { /* absent */ }
}

const GO = process.argv.includes("--go");
const LIMIT = +(process.argv.find((a) => a.startsWith("--limit="))?.split("=")[1] || 0);
const PARALLELE = 4; // le store répond en ~1,5 s et sert 500 Ko : au-delà on le fatigue pour rien

const prisma = new PrismaClient({ datasources: { db: { url: process.env.POSTGRES_URL } } });

/** exécute `fn` sur tous les items, `n` à la fois, en gardant l'ordre des résultats */
async function enParallele(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); }
  }));
  return out;
}

// ── 1. les candidats : un igdbId, et au moins une machine PlayStation ───
const tousJeux = await prisma.game.findMany({
  where: { igdbId: { not: null } },
  select: { id: true, titre: true, igdbId: true, plateformes: true, urlPsn: true },
});
let candidats = tousJeux.filter((g) => (g.plateformes || []).some((p) => /^ps\d|^psvr|vita|psp/i.test(p)));
if (LIMIT) candidats = candidats.slice(0, LIMIT);
console.log(`${tousJeux.length} jeux avec un igdbId · ${candidats.length} sur PlayStation${LIMIT ? ` (limité à ${LIMIT})` : ""}`);

// ── 2. les liens, par lots : IGDB accepte une liste d'ids en une requête ─
const tok = await fetch(
  `https://id.twitch.tv/oauth2/token?client_id=${process.env.TWITCH_ID}&client_secret=${process.env.TWITCH_SECRET}&grant_type=client_credentials`,
  { method: "POST" },
).then((r) => r.json());
if (!tok?.access_token) { console.error("Auth IGDB impossible — vérifie TWITCH_ID / TWITCH_SECRET."); process.exit(1); }

const liens = new Map();
for (let i = 0; i < candidats.length; i += 100) {
  const lot = candidats.slice(i, i + 100);
  const r = await fetch("https://api.igdb.com/v4/external_games", {
    method: "POST",
    headers: { "Client-ID": process.env.TWITCH_ID, Authorization: `Bearer ${tok.access_token}`, "Content-Type": "text/plain" },
    body: `fields url,game; where game = (${lot.map((g) => g.igdbId).join(",")}) & external_game_source = 36; limit 500;`,
  }).then((r) => r.json()).catch(() => []);
  for (const e of Array.isArray(r) ? r : []) if (e.url && !liens.has(String(e.game))) liens.set(String(e.game), e.url);
  process.stdout.write(`\r  liens IGDB : ${liens.size} trouvés (${Math.min(i + 100, candidats.length)}/${candidats.length} interrogés)`);
}
console.log("");

const avecLien = candidats.filter((g) => liens.has(String(g.igdbId)));
console.log(`${avecLien.length} jeux ont une fiche PlayStation Store, ${candidats.length - avecLien.length} n'en ont pas.`);

if (!GO) {
  console.log("\nAperçu (10 premiers) :");
  for (const g of avecLien.slice(0, 10)) console.log(`  ${g.titre.padEnd(38).slice(0, 38)} ${liens.get(String(g.igdbId))}`);
  console.log("\nRien n'a été écrit. Relance avec --go.");
  await prisma.$disconnect();
  process.exit(0);
}

// ── 3. les prix, relevés sur les fiches ────────────────────────────────
let faits = 0, avecPrix = 0, sansPrix = 0;
const resultats = await enParallele(avecLien, PARALLELE, async (g) => {
  const p = await prixPsn(liens.get(String(g.igdbId)));
  faits++;
  if (p) avecPrix++; else sansPrix++;
  if (faits % 10 === 0 || faits === avecLien.length) {
    process.stdout.write(`\r  prix : ${faits}/${avecLien.length} · ${avecPrix} relevés, ${sansPrix} illisibles`);
  }
  return { g, p, url: p?.url || liens.get(String(g.igdbId)) };
});
console.log("");

// ── 4. écriture ────────────────────────────────────────────────────────
let ecrits = 0;
for (const { g, p, url } of resultats) {
  await prisma.game.update({
    where: { id: g.id },
    data: {
      urlPsn: g.urlPsn || url,
      prixPsn: p && !p.gratuit
        ? { prix: p.prix, base: p.base, reducPct: p.reducPct, devise: p.devise, plusInclus: p.plusInclus }
        : null,
    },
  });
  ecrits++;
}
console.log(`\n✅ ${ecrits} jeux mis à jour · ${avecPrix} avec un prix · ${sansPrix} lien seul`);
await prisma.$disconnect();
