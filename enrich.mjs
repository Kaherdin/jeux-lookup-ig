#!/usr/bin/env node
/**
 * Game Backlog Enricher — batch CSV (Node 18+, zéro dépendance)
 *
 *   Entrée : jeux-collection-enrichi.csv
 *   Sortie : jeux-enrichi.json  +  jeux-enrichi.csv
 *
 *   node enrich.mjs            (utilise le cache)
 *   node enrich.mjs --force    (rafraîchit tout)
 *
 * Clés (optionnelles) via .env : TWITCH_ID, TWITCH_SECRET, ITAD_KEY
 * Sans clé : Steam seul, ça marche déjà.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { loadEnv, parseCSV, toCSV, sleep, enrichGame, DELAY } from "./lib.mjs";

const IN = "jeux-collection-enrichi.csv";
const CACHE = "enrich-cache.json";
const FORCE = process.argv.includes("--force");

const env = loadEnv();
const cache = existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, "utf8")) : {};

export function flatten(out) {
  return out.map(g => ({
    Titre: g.titre, Dispo: g.dispo ? "Oui" : "Non", Gratuit: g.gratuit ? "Oui" : (g.gratuitMention || ""),
    "Bon plan": g.bonPlan ? "Oui" : "", "Prix meilleur": g.prix?.meilleur ?? g.prixSteam ?? "",
    Devise: g.prix?.devise ?? (g.prixSteam != null ? "CHF" : ""),
    Store: g.prix?.store ?? (g.prixSteam != null ? "Steam" : ""), "Plus-bas histo": g.prix?.plusBasHisto ?? "",
    "Sortie ISO": g.sortieISO, "Précision": g.sortiePrec,
    Note: g.note ?? "", "Note source": g.noteSource || "", "Steam %": g.steamPct ?? "",
    Solo: g.modes?.solo ? "Oui" : "", Coop: g.modes?.coop ? "Oui" : "", PvP: g.modes?.pvp ? "Oui" : "",
    Multi: g.modes?.multi ? "Oui" : "", Joueurs: g.nbJoueurs,
    Genre: g.genre, Univers: g.univers, Plateformes: (g.plateformes || []).join(" "),
    Steam: g.urlSteam, Store_url: g.urlStore, Reel: g.reel, Createur: g.createur,
  }));
}

async function main() {
  const raw = parseCSV(readFileSync(IN, "utf8"));
  const seen = new Set(), rows = [];
  for (const r of raw) {
    const titre = (r["Titre"] || "").trim();
    if (!titre) continue;
    if (r["Type"] && !/jeu|compilation/i.test(r["Type"])) continue;
    const key = titre.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key); rows.push(r);
  }
  console.log(`→ ${raw.length} lignes brutes → ${rows.length} jeux uniques. IGDB:${env.TWITCH_ID ? "on" : "off"} ITAD:${env.ITAD_KEY ? "on" : "off"}\n`);

  const out = [];
  for (const [i, row] of rows.entries()) {
    const title = (row["Titre"] || "").trim();
    if (cache[title] && !FORCE) { out.push(cache[title]); console.log(`[${i + 1}/${rows.length}] (cache) ${title}`); continue; }

    const g = await enrichGame({
      titre: title,
      steamAppId: row["Steam (si connu)"],
      coop: row["Coop"], multi: row["Multijoueur"],
      genre: row["Genre"], univers: row["Univers"],
      sortieISO: row["Sortie ISO"], sortiePrec: row["Précision sortie"],
      gratuitCsv: row["Gratuit"], legende: row["Légende"],
      reel: row["URL"], createur: row["Créateur handle"], plateforme: row["Plateforme"],
    }, env);

    cache[title] = g; out.push(g);
    writeFileSync(CACHE, JSON.stringify(cache));
    const m = g.modes || {};
    const mBadge = [m.solo && "🎯", m.coop && "👥", m.pvp && "⚔️"].filter(Boolean).join("");
    const badges = [g.dispo && "✅", g.gratuit && "🆓", g.bonPlan && "💸", g.bienNote && "⭐"].filter(Boolean).join("");
    console.log(`[${i + 1}/${rows.length}] ${title.padEnd(34).slice(0, 34)} ${(g.sortieISO || "").padEnd(10)} ${String(g.prix?.meilleur ?? g.prixSteam ?? "?").padEnd(6)} ${mBadge.padEnd(6)} ${badges}`);
    if (g.steamAppId) await sleep(DELAY);
  }

  writeFileSync("jeux-enrichi.json", JSON.stringify(out, null, 2));
  writeFileSync("jeux-enrichi.csv", toCSV(flatten(out)));
  const n = (f) => out.filter(f).length;
  console.log(`\n✅ jeux-enrichi.json + jeux-enrichi.csv`);
  console.log(`   Dispo:${n(g => g.dispo)}  Gratuits:${n(g => g.gratuit)}  Bons plans:${n(g => g.bonPlan)}  Bien notés:${n(g => g.bienNote)}`);
  console.log(`   Solo:${n(g => g.modes?.solo)}  Coop:${n(g => g.modes?.coop)}  PvP:${n(g => g.modes?.pvp)}`);
}
// n'exécute le batch que si lancé directement (pas à l'import depuis server.mjs)
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch(e => { console.error(e); process.exit(1); });
