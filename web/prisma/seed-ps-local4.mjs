/**
 * Liste exhaustive « PS4/PS5 — 4 joueurs en LOCAL » (couch coop / versus, hors ligne).
 *
 * Pipeline :
 *  1. IGDB — pool candidat large : tout jeu sorti sur PS4 (48) ou PS5 (167) ayant un signal
 *     de multi local (offlinemax/offlinecoopmax ≥ 4, splitscreen, game_mode « Split screen »,
 *     offlinecoop) + une liste de secours de titres canapé connus.
 *  2. Arbitrage — les multiplayer_modes IGDB sont lus PAR PLATEFORME (un mode « 4 joueurs »
 *     déclaré pour la version PC ne prouve rien pour la PS4), puis chaque candidat est
 *     confirmé/infirmé par lot via Claude Haiku (« 4 manettes sur la même console ? »).
 *  3. Enrichissement complet (Steam + IGDB + ITAD + LLM) et écriture dans la liste dédiée.
 *
 * Usage :
 *   node --env-file=.env.local prisma/seed-ps-local4.mjs [--dry] [--limit=N] [--no-cache]
 */
import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PrismaClient } from "@prisma/client";
import Anthropic from "@anthropic-ai/sdk";
import { enrichGame } from "../lib/enrich.mjs";
import { toRow } from "../lib/game-row.mjs";
import { upsertGames } from "./catalogue.mjs";

const ARGS = process.argv.slice(2);
const DRY = ARGS.includes("--dry");
const NOCACHE = ARGS.includes("--no-cache");
const LIMIT = +(ARGS.find((a) => a.startsWith("--limit="))?.split("=")[1] || 0);

const SLUG = "ps-4-joueurs-local";
const PS4 = 48, PS5 = 167;
const PS = new Set([PS4, PS5]);

const CACHE_DIR = process.env.SEED_CACHE_DIR || join(tmpdir(), "ps-local4-cache");
if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
const cacheFile = (n) => join(CACHE_DIR, n);
const readCache = (n) => (!NOCACHE && existsSync(cacheFile(n)) ? JSON.parse(readFileSync(cacheFile(n), "utf8")) : null);
const writeCache = (n, v) => writeFileSync(cacheFile(n), JSON.stringify(v));

const env = {
  TWITCH_ID: process.env.TWITCH_ID, TWITCH_SECRET: process.env.TWITCH_SECRET,
  ITAD_KEY: process.env.ITAD_KEY, ITAD_ID: process.env.ITAD_ID,
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
};

// ─── IGDB ──────────────────────────────────────────────────────────────
let TOKEN = null;
async function igdbAuth() {
  if (TOKEN) return TOKEN;
  const j = await fetch(`https://id.twitch.tv/oauth2/token?client_id=${env.TWITCH_ID}&client_secret=${env.TWITCH_SECRET}&grant_type=client_credentials`, { method: "POST" }).then((r) => r.json());
  TOKEN = j.access_token;
  if (!TOKEN) throw new Error("Auth IGDB/Twitch impossible — vérifie TWITCH_ID / TWITCH_SECRET.");
  return TOKEN;
}
async function igdb(endpoint, body) {
  const tok = await igdbAuth();
  for (let a = 0; a < 5; a++) {
    const r = await fetch(`https://api.igdb.com/v4/${endpoint}`, {
      method: "POST",
      headers: { "Client-ID": env.TWITCH_ID, Authorization: `Bearer ${tok}`, "Content-Type": "text/plain" },
      body,
    });
    if (r.status === 429) { await new Promise((s) => setTimeout(s, 400)); continue; }
    const t = await r.text();
    try { return JSON.parse(t); } catch { console.error("IGDB", r.status, t.slice(0, 200)); return []; }
  }
  return [];
}
const FIELDS = "name,slug,first_release_date,total_rating,total_rating_count,aggregated_rating,game_type,parent_game,version_parent,platforms,genres.name,game_modes.slug,cover.image_id,multiplayer_modes.*,summary";
async function igdbPage(where) {
  const out = [];
  for (let off = 0; off < 5000; off += 500) {
    const arr = await igdb("games", `where ${where}; fields ${FIELDS}; sort id asc; limit 500; offset ${off};`);
    if (!Array.isArray(arr) || !arr.length) break;
    out.push(...arr);
    if (arr.length < 500) break;
  }
  return out;
}

// Titres « canapé » notoires : filet de sécurité si IGDB n'a aucun signal exploitable.
const SECOURS = [
  "Overcooked! 2", "Overcooked! All You Can Eat", "Overcooked", "Moving Out", "Moving Out 2",
  "Gang Beasts", "Ultimate Chicken Horse", "TowerFall Ascension", "Broforce", "Castle Crashers",
  "Rocket League", "Minecraft", "Minecraft Dungeons", "Nine Parchments", "Boomerang Fu",
  "Lovers in a Dangerous Spacetime", "Trine 4: The Nightmare Prince", "Trine 5: A Clockwork Conspiracy",
  "PlateUp!", "Streets of Rage 4", "Diablo III", "Diablo IV", "Helldivers", "Alienation",
  "Crash Team Racing Nitro-Fueled", "Crash Bandicoot 4: It's About Time", "Team Sonic Racing",
  "Sonic Mania", "Rayman Legends", "LittleBigPlanet 3", "Sackboy: A Big Adventure",
  "It Takes Two", "Nickelodeon All-Star Brawl", "Nickelodeon All-Star Brawl 2",
  "Brawlhalla", "Fall Guys", "Fuser", "Just Dance 2024 Edition", "Just Dance 2023 Edition",
  "Jackbox Party Pack 10", "The Jackbox Party Pack 9", "The Jackbox Party Pack 8",
  "Borderlands 3", "Borderlands: The Handsome Collection", "Terraria", "Stardew Valley",
  "Guacamelee! 2", "Cuphead", "Enter the Gungeon", "Risk of Rain 2", "Children of Morta",
  "Untitled Goose Game", "Human: Fall Flat", "Heave Ho", "Pummel Party", "Chivalry 2",
  "WWE 2K24", "WWE 2K23", "NBA 2K24", "FIFA 23", "EA Sports FC 24", "EA Sports FC 25",
  "Mario"/* absent PS — sera filtré */, "Knockout City", "Worms Rumble", "Worms W.M.D",
  "Divinity: Original Sin 2", "Dragon Ball FighterZ", "Mortal Kombat 11", "Mortal Kombat 1",
  "Tekken 8", "Street Fighter 6", "Power Rangers: Battle for the Grid", "Samurai Gunn 2",
  "Nidhogg 2", "Duck Game", "Speedrunners", "Regular Human Basketball", "Stikbold!",
  "ScourgeBringer", "Shredders", "Riders Republic", "Trackmania Turbo", "Micro Machines: World Series",
  "Dirt 5", "Wreckfest", "GRID", "F1 24", "Hot Wheels Unleashed 2", "Garfield Kart: Furious Racing",
  "Sonic Superstars", "Prince of Persia: The Lost Crown"/* solo — sera filtré */,
  "Astro Bot"/* solo — filtré */, "Bloodstained: Curse of the Moon 2", "Streets of Rogue",
  "Full Metal Furies", "Chariot", "Trials Rising", "Screencheat", "Ape Out"/* solo */,
  "Overwatch 2", "Rogue Company", "Divekick", "Windjammers 2", "Toy Soldiers HD",
  "Aces of the Luftwaffe: Squadron", "Ghostbusters: The Video Game Remastered", "Blazing Chrome",
  "Panzer Paladin", "Skullgirls 2nd Encore", "Them's Fightin' Herds", "Multiversus",
  "Bomberman"/* générique */, "Super Bomberman R", "Super Bomberman R 2", "Overwatch",
  "Rock Band 4", "Guitar Hero Live", "Let's Sing 2024", "SingStar Celebration",
  "Puyo Puyo Tetris 2", "Tetris Effect: Connected", "Everybody's Golf", "Golf With Your Friends",
  "Party Animals", "Stumble Guys", "Goat Simulator 3", "Goat Simulator", "Human Fall Flat",
];

async function buildPool() {
  const cached = readCache("pool.json");
  if (cached) { console.log(`Pool (cache) : ${cached.length} jeux`); return cached; }
  const W = "platforms = (48,167)";
  const queries = [
    `${W} & (multiplayer_modes.offlinecoopmax >= 4 | multiplayer_modes.offlinemax >= 4)`,
    `${W} & multiplayer_modes.splitscreen = true`,
    `${W} & game_modes = (4)`,
    `${W} & multiplayer_modes.offlinecoop = true`,
  ];
  const sets = await Promise.all(queries.map(igdbPage));
  const byId = new Map();
  sets.forEach((arr, i) => arr.forEach((g) => {
    const e = byId.get(g.id) || { ...g, srcs: [] };
    e.srcs.push("ABCD"[i]);
    byId.set(g.id, e);
  }));
  // filet de sécurité : recherche nominative des classiques du canapé
  const known = new Set([...byId.keys()]);
  const CONC = 6;
  for (let i = 0; i < SECOURS.length; i += CONC) {
    await Promise.all(SECOURS.slice(i, i + CONC).map(async (t) => {
      const arr = await igdb("games", `search "${t.replace(/"/g, "")}"; where platforms = (48,167); fields ${FIELDS}; limit 4;`);
      for (const g of (Array.isArray(arr) ? arr : [])) {
        if (known.has(g.id)) continue;
        known.add(g.id);
        byId.set(g.id, { ...g, srcs: ["S"] });
      }
    }));
    process.stdout.write(`\r  secours ${Math.min(i + CONC, SECOURS.length)}/${SECOURS.length}`);
  }
  const pool = [...byId.values()];
  console.log(`\nPool IGDB : ${pool.length} jeux candidats`);
  writeCache("pool.json", pool);
  return pool;
}

// ─── signaux IGDB (lus PAR plateforme) ─────────────────────────────────
function igdbSignals(g) {
  let psMax = 0, genMax = 0, otherMax = 0, psSplit = false, psCoop = false;
  for (const m of g.multiplayer_modes || []) {
    const mx = Math.max(m.offlinecoopmax || 0, m.offlinemax || 0);
    const onPS = m.platform != null && PS.has(m.platform);
    const generic = m.platform == null;
    if (onPS) { if (m.splitscreen) psSplit = true; if (m.offlinecoop) psCoop = true; }
    if (mx >= 4) {
      if (onPS) psMax = Math.max(psMax, mx);
      else if (generic) genMax = Math.max(genMax, mx);
      else otherMax = Math.max(otherMax, mx);
    }
  }
  return { psMax, genMax, otherMax, psSplit, psCoop };
}

// ─── arbitrage LLM ─────────────────────────────────────────────────────
// Passe 1 (Haiku, large) : dégrossit le pool. Passe 2 (Opus, audit) : tranche pour de bon.
const SYS_TRI = `Tu es une base de données de référence sur le multijoueur LOCAL des jeux vidéo console.
Pour chaque jeu de la liste, dis s'il est jouable à 4 joueurs ou plus EN LOCAL sur une même PS4 ou PS5
(4 manettes branchées sur la même console : écran partagé, écran unique partagé, ou mode party à la manette).
RÈGLES STRICTES :
- Le multijoueur EN LIGNE ne compte pas. Share Play / Remote Play Together ne comptent pas.
- 2 ou 3 joueurs en local seulement → local4 = false.
- 4+ en local sur PC/Switch/Xbox mais limité à 2 ou 0 sur PS4/PS5 → local4 = false.
- Jeu inconnu de toi ou dont tu n'es pas sûr → "confiance":"inconnu". N'invente JAMAIS.
Réponds UNIQUEMENT par un tableau JSON, un objet par jeu, dans le même ordre :
[{"i":<index>,"local4":true|false,"localMax":<nb max en local ou null>,"type":"coop"|"versus"|"les deux"|null,"confiance":"certain"|"probable"|"inconnu"}]`;

const SYS_AUDIT = `Tu audites une liste de jeux censés être jouables à 4 joueurs ou plus EN LOCAL sur PS4/PS5.
Ton rôle est celui d'un SCEPTIQUE : la plupart des jeux multijoueur modernes sont en ligne uniquement,
ou limités à 2 joueurs en écran partagé. Élimine tout ce qui n'est pas certain.

Compte comme LOCAL : 4 manettes (ou plus) branchées sur la MÊME PS4/PS5 jouant EN MÊME TEMPS —
écran partagé, écran unique partagé, mode party, ou jeu à la manette passée si le mode est simultané.
Ne compte PAS : le multijoueur en ligne, le co-op à 2 en local, le Share Play, le Remote Play Together,
le mode « chacun son tour » (hot-seat séquentiel), les modes solo à plusieurs profils.

Pour CHAQUE jeu, donne :
- "localMax" : nombre EXACT de joueurs simultanés en local sur PS4/PS5 (0 si aucun multi local).
- "preuve" : le nom du mode concerné dans le jeu (ex. « écran partagé 4 joueurs », « mode Party »,
  « co-op canapé 4 » ). Si tu ne peux pas nommer le mode, tu n'es pas sûr.
- "sur" : true UNIQUEMENT si tu es certain du chiffre. Dans le doute → false.
Réponds UNIQUEMENT par un tableau JSON, un objet par jeu, dans le même ordre :
[{"i":<index>,"localMax":<nb>,"type":"coop"|"versus"|"les deux"|null,"preuve":"<court>","sur":true|false}]`;

const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
const label = (c) => {
  const g = c.g;
  const y = g.first_release_date ? new Date(g.first_release_date * 1000).getUTCFullYear() : "";
  const genres = (g.genres || []).map((x) => x.name).join("/");
  return `${g.name}${y ? ` (${y})` : ""}${genres ? ` [${genres}]` : ""}`;
};
function parseArr(t) {
  const m = (t || "").match(/\[[\s\S]*\]/);
  if (!m) return [];
  try { return JSON.parse(m[0]); } catch { return []; }
}
async function askLLM(batch, model, system, max = 3000) {
  const lines = batch.map((c, i) => `${i}. ${label(c)}`).join("\n");
  const user = `Jeux sortis sur PS4/PS5 :\n${lines}`;
  // OpenAI (arbitre de secours / second avis) — modèles gpt-*
  if (/^(gpt|o[0-9])/.test(model)) {
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, max_completion_tokens: max, messages: [{ role: "system", content: system }, { role: "user", content: user }] }),
    });
    const j = await r.json();
    if (j.error) throw new Error(`OpenAI: ${j.error.message}`);
    return parseArr(j.choices?.[0]?.message?.content);
  }
  const msg = await anthropic.messages.create({
    model, max_tokens: max, system, messages: [{ role: "user", content: user }],
  });
  return parseArr((msg.content || []).map((b) => (b.type === "text" ? b.text : "")).join(""));
}
async function runPass(todo, { file, model, system, batch, conc, max }) {
  const cache = readCache(file) || {};
  const rest = todo.filter((c) => !cache[c.g.id]);
  console.log(`${file} : ${rest.length} à interroger (${todo.length - rest.length} en cache)`);
  const batches = [];
  for (let i = 0; i < rest.length; i += batch) batches.push(rest.slice(i, i + batch));
  let done = 0;
  for (let i = 0; i < batches.length; i += conc) {
    await Promise.all(batches.slice(i, i + conc).map(async (b) => {
      const res = await askLLM(b, model, system, max).catch((e) => { console.error("\n", e.message); return []; });
      for (const r of res) if (b[r.i]) cache[b[r.i].g.id] = r;
      done += b.length;
      process.stdout.write(`\r  ${done}/${rest.length}`);
    }));
    writeCache(file, cache);
  }
  if (rest.length) console.log("");
  return cache;
}

// ─── décision ──────────────────────────────────────────────────────────
// Un jeu n'est retenu que si DEUX sources concordent : la donnée structurée IGDB
// (mode multijoueur hors ligne ≥ 4) et/ou l'audit LLM sceptique. L'IA seule ne
// suffit jamais à créer une entrée sauf certitude explicite avec preuve nommée.
//
// Garde-fous appris des faux positifs observés :
//  · IGDB confond parfois joueurs EN LIGNE et hors ligne (Warzone « offlinemax 100 »)
//    → tout maximum local invraisemblable (> 12) doit être confirmé par l'audit ;
//  · l'audit rend parfois un chiffre ≥ 4 tout en écrivant dans sa preuve que le mode
//    est en ligne / hot-seat / incertain → la preuve prime sur le chiffre.
const PLAFOND_LOCAL = 12;
const PREUVE_SUSPECTE = /en ligne uniquement|online uniquement|aucun mode|pas de (?:mode |multi)?(?:local|canapé)|hot-?seat|non simultané|tour de rôle|tours successifs|successi|incertain|inconnu|pas certain|non (?:vérifié|confirmé|identifié)|supposé/i;

// Faux positifs constatés à la relecture : IGDB/IA leur prête un multi local à 4
// alors que ces jeux plafonnent à 2 en local (le reste du multi est en ligne).
const EXCLUSIONS = [
  "Overwatch", "Overwatch 2", "Tiny Tina's Wonderlands", "Capcom Fighting Collection",
  "Capcom Fighting Collection 2", "Marvel Cosmic Invasion", "Mutant Football League",
  "Call of Duty: Warzone", "Split Fiction", "Helldivers 2", "Risk of Rain 2",
  "Street Fighter 6", "Tekken 8", "Dragon Ball: Sparking! Zero", "Knockout City",
  "Rock Band 4: Rivals Bundle", // bundle de DLC — le jeu de base est ajouté séparément
].map((t) => t.toLowerCase());
// DLC / season pass que le filtre parent_game d'IGDB laisse passer
const TITRE_DERIVE = /season pass|expansion pass|\bdlc\b|character pack|costume pack/i;

// Classiques du canapé PS4/PS5 absents des données IGDB (multiplayer_modes non renseignés)
// — nombre de joueurs en local vérifié titre par titre.
const INCLUSIONS = [
  ["Overcooked! 2", 4, "coop"], ["Gang Beasts", 4, "versus"], ["TowerFall Ascension", 4, "les deux"],
  ["Castle Crashers Remastered", 4, "coop"], ["Rayman Legends", 4, "coop"],
  ["Crash Team Racing Nitro-Fueled", 4, "versus"], ["Minecraft", 4, "coop"],
  ["Stardew Valley", 4, "coop"], ["Diablo III: Eternal Collection", 4, "coop"],
  ["Trine 4: The Nightmare Prince", 4, "coop"], ["Boomerang Fu", 6, "versus"],
  ["Spelunky", 4, "coop"], ["Serious Sam Collection", 4, "coop"], ["Streets of Rogue", 4, "coop"],
  ["Dirt 5", 4, "versus"], ["Micro Machines: World Series", 4, "versus"],
  ["Puyo Puyo Tetris", 4, "les deux"], ["Puyo Puyo Tetris 2", 4, "les deux"],
  ["Super Bomberman R 2", 4, "les deux"], ["Nickelodeon Kart Racers 2: Grand Prix", 4, "versus"],
  ["Nickelodeon All-Star Brawl", 4, "versus"], ["Rock Band 4", 4, "coop"],
  ["Worms W.M.D", 4, "versus"], ["Guacamelee! Super Turbo Championship Edition", 4, "coop"],
  ["WWE 2K22", 4, "versus"], ["WWE 2K23", 4, "versus"], ["WWE 2K24", 4, "versus"],
  ["NBA 2K23", 4, "versus"], ["NBA 2K24", 4, "versus"],
  ["EA Sports FC 24", 4, "versus"], ["EA Sports FC 25", 4, "versus"], ["FIFA 23", 4, "versus"],
  ["The Jackbox Party Pack 6", 8, "versus"], ["The Jackbox Party Pack 7", 8, "versus"],
  ["The Jackbox Party Pack 8", 8, "versus"], ["The Jackbox Party Pack 9", 10, "versus"],
  ["The Jackbox Party Pack 10", 10, "versus"], ["The Jackbox Party Pack 3", 8, "versus"],
  ["Overcooked", 4, "coop"], ["Human Fall Flat", 0, ""], // 0 = repère : 2 joueurs seulement, non retenu
].filter(([, n]) => n >= 4);

function decide(sig, tri, ...audits) {
  // deux arbitres indépendants (Claude + GPT) : un « non » certain de l'un suffit à exclure,
  // un « oui » certain de l'un suffit à confirmer un signal IGDB.
  const vus = audits.filter(Boolean);
  const lu = vus.map((x) => ({
    max: +x.localMax || 0,
    suspecte: x.preuve ? PREUVE_SUSPECTE.test(x.preuve) : false,
    sur: x.sur === true,
  }));
  const aSure = lu.some((x) => x.sur && x.max >= 4 && !x.suspecte);
  const aVeto = lu.some((x) => (x.sur && x.max < 4) || x.suspecte);
  const a = vus.find((x) => (+x.localMax || 0) >= 4 && x.sur === true) || vus[0] || null;
  const aMax = Math.max(0, ...lu.filter((x) => x.sur && !x.suspecte).map((x) => x.max));
  const triYes = tri?.local4 === true && (tri.confiance === "certain" || tri.confiance === "probable");
  const igdbLocal = Math.max(sig.psMax, sig.genMax, sig.otherMax);
  // chiffre affiché : l'audit fait autorité quand il est sûr (IGDB gonfle avec l'online)
  const mx = (igdbMax) => (aSure ? aMax : Math.min(igdbMax, PLAFOND_LOCAL));

  if (aVeto) return { keep: false };
  if (sig.psMax >= 4) {
    if (sig.psMax > PLAFOND_LOCAL && !aSure) return { keep: false }; // valeur IGDB invraisemblable, non confirmée
    return { keep: true, raison: "IGDB PS4/PS5", localMax: mx(sig.psMax), conf: aSure ? "double" : "igdb" };
  }
  if (sig.genMax >= 4 && (aSure || triYes)) {
    if (sig.genMax > PLAFOND_LOCAL && !aSure) return { keep: false };
    return { keep: true, raison: "IGDB + audit IA", localMax: mx(sig.genMax), conf: aSure ? "double" : "moyen" };
  }
  if (sig.otherMax >= 4 && aSure) return { keep: true, raison: "IGDB (autre plateforme) confirmé IA", localMax: aMax, conf: "double" };
  if (sig.psSplit && aSure) return { keep: true, raison: "écran partagé PS + audit IA", localMax: aMax, conf: "double" };
  if (aSure && a.preuve && igdbLocal === 0 && !sig.psSplit) return { keep: true, raison: "audit IA (preuve nommée)", localMax: aMax, conf: "ia" };
  return { keep: false };
}

// ─── main ──────────────────────────────────────────────────────────────
const prisma = new PrismaClient({ datasources: { db: { url: process.env.POSTGRES_URL } } });

// IGDB game_type : 0 jeu principal · 1 DLC · 2 extension · 3 bundle · 4 extension autonome
// 5 mod · 6 épisode · 7 saison · 8 remake · 9 remaster · 10 jeu étendu · 11 portage · 13 pack
// Les portages/remasters PS4 sont rattachés à un parent_game (Castle Crashers Remastered,
// Rayman Legends, Minecraft…) : on ne peut donc PAS filtrer sur parent_game, seulement sur le type.
// Le type 13 « pack » regroupe les DLC cosmétiques (Minecraft: Dragonborn Mash-up, Rocket
// League: Chaos Run) : à exclure aussi.
const TYPES_EXCLUS = new Set([1, 2, 5, 6, 7, 12, 13, 14]);
// Les bundles (type 3) sont soit de vraies compilations jouables (Borderlands: The Handsome
// Collection, Doom + Doom II), soit de simples références boutique sans identité propre
// (« Overcooked! + Overcooked! 2 », « Minecraft Starter Collection »). Ces dernières n'ont
// jamais la moindre note ni le moindre avis : c'est le discriminant.
const estBundleVide = (g) => g.game_type === 3 && !(g.total_rating_count > 0);

// Clé de regroupement : un jeu et ses rééditions ne doivent apparaître qu'une fois.
const SUFFIXE_EDITION = /\s*[:\-–]?\s*\b(?:complete|definitive|remastered?|goty|game of the year|deluxe|ultimate|anniversary|enhanced|special|legendary|gold|premium)\b(?:\s+edition)?\s*$/i;
function familleDe(g) {
  if (g.parent_game) return `p${g.parent_game}`;
  let n = g.name;
  for (let i = 0; i < 2; i++) n = n.replace(SUFFIXE_EDITION, "");
  return `n${n.toLowerCase().replace(/[^a-z0-9]/g, "")}`;
}

async function main() {
  const pool = await buildPool();
  // écarte DLC, extensions, mods, saisons — garde jeux, bundles, remasters et portages
  const cands = pool
    .filter((g) => !g.version_parent && !TYPES_EXCLUS.has(g.game_type ?? 0) && !estBundleVide(g))
    .filter((g) => (g.platforms || []).some((p) => PS.has(p)))
    .map((g) => ({ g, sig: igdbSignals(g) }));
  console.log(`Candidats (hors DLC/packs/bundles boutique) : ${cands.length}`);

  // passe 1 — tri large (rapide, pas cher)
  const tri = await runPass(cands, { file: "verdicts.json", model: "claude-haiku-4-5", system: SYS_TRI, batch: 20, conc: 6, max: 3000 })
    .catch((e) => { console.error("tri Claude indisponible :", e.message); return readCache("verdicts.json") || {}; });
  // passe 2 — audit sceptique sur tout ce qui a la moindre chance
  const shortlist = cands.filter((c) => {
    const t = tri[c.g.id] || {};
    return c.sig.psMax >= 4 || c.sig.genMax >= 4 || c.sig.otherMax >= 4 || c.sig.psSplit || t.local4 === true;
  });
  console.log(`Shortlist à auditer : ${shortlist.length}`);
  const audit = await runPass(shortlist, { file: "audit.json", model: "claude-opus-5", system: SYS_AUDIT, batch: 12, conc: 5, max: 4000 })
    .catch((e) => { console.error("audit Claude indisponible :", e.message); return {}; });
  // second arbitre indépendant (OpenAI) — couvre aussi les jeux que le premier n'a pas pu traiter
  const audit2 = await runPass(shortlist, { file: "audit-gpt.json", model: "gpt-5.4-mini", system: SYS_AUDIT, batch: 12, conc: 6, max: 5000 })
    .catch((e) => { console.error("audit GPT indisponible :", e.message); return {}; });

  const rows = [];
  for (const c of cands) {
    if (EXCLUSIONS.includes(c.g.name.toLowerCase()) || TITRE_DERIVE.test(c.g.name)) continue;
    const t = tri[c.g.id] || { confiance: "inconnu" };
    const a = audit[c.g.id], b = audit2[c.g.id];
    const d = decide(c.sig, t, a, b);
    if (!d.keep) continue;
    rows.push({
      igdbId: c.g.id, titre: c.g.name,
      annee: c.g.first_release_date ? new Date(c.g.first_release_date * 1000).getUTCFullYear() : null,
      note: c.g.total_rating ? Math.round(c.g.total_rating) : null,
      pop: c.g.total_rating_count || 0,
      genres: (c.g.genres || []).map((x) => x.name).join(", "),
      localMax: d.localMax, type: a?.type || b?.type || t.type || null, raison: d.raison, conf: d.conf,
      preuve: a?.preuve || b?.preuve || "", famille: familleDe(c.g),
      ps5: (c.g.platforms || []).includes(PS5), ps4: (c.g.platforms || []).includes(PS4),
    });
  }

  // rattrapage : classiques du canapé absents des données IGDB, vérifiés à la main
  const dejaLa = new Set(rows.map((r) => r.titre.toLowerCase().replace(/[^a-z0-9]/g, "")));
  const CONC_S = 6;
  for (let i = 0; i < INCLUSIONS.length; i += CONC_S) {
    await Promise.all(INCLUSIONS.slice(i, i + CONC_S).map(async ([titre, max, type]) => {
      if (dejaLa.has(titre.toLowerCase().replace(/[^a-z0-9]/g, ""))) return;
      const arr = await igdb("games", `search "${titre.replace(/"/g, "")}"; where platforms = (48,167) & version_parent = null; fields ${FIELDS}; limit 5;`);
      const best = (Array.isArray(arr) ? arr : []).find((g) => g.name.toLowerCase().replace(/[^a-z0-9]/g, "").includes(titre.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 12)))
        || (Array.isArray(arr) ? arr[0] : null);
      if (!best) { console.log(`  ⚠ inclusion introuvable sur IGDB : ${titre}`); return; }
      const k = best.name.toLowerCase().replace(/[^a-z0-9]/g, "");
      if (dejaLa.has(k)) return;
      dejaLa.add(k);
      rows.push({
        igdbId: best.id, titre: best.name,
        annee: best.first_release_date ? new Date(best.first_release_date * 1000).getUTCFullYear() : null,
        note: best.total_rating ? Math.round(best.total_rating) : null,
        pop: best.total_rating_count || 0,
        genres: (best.genres || []).map((x) => x.name).join(", "),
        localMax: max, type, raison: "vérification manuelle", conf: "manuel", preuve: `${max} joueurs en local (vérifié à la main)`,
        famille: familleDe(best),
        ps5: (best.platforms || []).includes(PS5), ps4: (best.platforms || []).includes(PS4),
      });
    }));
  }

  // dédoublonne par famille : un jeu, son portage PS4 et ses rééditions = une seule entrée,
  // celle qui a le plus d'avis (« Minecraft » plutôt que « Minecraft: PlayStation 4 Edition »).
  const seen = new Map();
  for (const r of rows.sort((a, b) => b.pop - a.pop)) {
    if (!seen.has(r.famille)) seen.set(r.famille, r);
  }
  let final = [...seen.values()].sort((a, b) => (b.note ?? 0) - (a.note ?? 0) || b.pop - a.pop);
  if (LIMIT) final = final.slice(0, LIMIT);

  console.log(`\n✅ ${final.length} jeux PS4/PS5 jouables à 4+ en LOCAL`);
  const par = {};
  for (const r of final) par[r.raison] = (par[r.raison] || 0) + 1;
  console.log("Sources :", par);
  writeCache("final.json", final);

  if (DRY) {
    console.log("\n--- (--dry) aperçu top 80 ---");
    console.log(final.slice(0, 80).map((r, i) => `${String(i + 1).padStart(3)}. ${r.titre} (${r.annee ?? "?"}) · ${r.localMax}j · ${r.type ?? "?"} · ⭐${r.note ?? "-"} · ${r.raison} · ${r.preuve}`).join("\n"));
    return;
  }

  // ─── écriture DB ─────────────────────────────────────────────────────
  const user = await prisma.user.findFirst({ orderBy: { createdAt: "asc" } });
  const list = await prisma.list.upsert({
    where: { slug: SLUG },
    update: { name: "🛋️ PS4/PS5 — 4 joueurs en local", description: "Tous les jeux PS4/PS5 jouables à 4 (ou plus) sur la même console : coop canapé et versus, hors ligne. Vérifiés via IGDB (modes multijoueur par plateforme) + contrôle IA." },
    create: {
      slug: SLUG, name: "🛋️ PS4/PS5 — 4 joueurs en local", isPublic: true, ownerId: user?.id ?? null,
      description: "Tous les jeux PS4/PS5 jouables à 4 (ou plus) sur la même console : coop canapé et versus, hors ligne. Vérifiés via IGDB (modes multijoueur par plateforme) + contrôle IA.",
    },
  });
  console.log(`Liste : /l/${list.slug} (owner: ${user?.email ?? "communautaire"})`);

  const today = new Date().toISOString().slice(0, 10);
  let ok = 0, fail = 0;
  const CONC = 5;
  for (let i = 0; i < final.length; i += CONC) {
    await Promise.all(final.slice(i, i + CONC).map(async (r) => {
      const g = await enrichGame({ titre: r.titre, igdbId: r.igdbId, ajouteLe: today }, env).catch(() => null);
      if (!g || !g.titre) { fail++; return; }
      // la vérification « 4 local » de ce script fait autorité sur les données brutes
      g.joueursLocalMax = Math.max(g.joueursLocalMax || 0, r.localMax || 4);
      g.nbJoueursMax = Math.max(g.nbJoueursMax || 0, g.joueursLocalMax);
      if (!g.nbJoueurs || (+(g.nbJoueurs.match(/(\d+)\s*$/)?.[1] || 0) < g.joueursLocalMax)) g.nbJoueurs = `1-${g.nbJoueursMax}`;
      g.modes = { ...(g.modes || {}), multi: true };
      if (r.type === "coop" || r.type === "les deux") g.modes.coop = true;
      if (r.type === "versus" || r.type === "les deux") g.modes.pvp = true;
      g.modesDetail = { ...(g.modesDetail || {}), splitscreen: true, local4: true, sourceLocal4: r.raison };
      // plateformes : garantit PS4/PS5 (IGDB abrège parfois autrement)
      const pl = new Set(g.plateformes || []);
      if (r.ps4) pl.add("PS4");
      if (r.ps5) pl.add("PS5");
      g.plateformes = [...pl];
      try {
        await upsertGames(prisma, list.id, [g]);
        ok++;
      } catch { fail++; }
    }));
    process.stdout.write(`\r  enrichis ${Math.min(i + CONC, final.length)}/${final.length} (${ok} ok, ${fail} ko)`);
  }
  // purge : le script fait autorité sur le contenu de SA liste — on retire ce qui a été
  // écarté depuis (DLC, faux positifs corrigés), sinon les anciennes passes restent en base.
  const gardes = new Set(final.map((r) => r.titre));
  const enTrop = (await prisma.game.findMany({ where: { items: { some: { listId: list.id } } }, select: { id: true, titre: true } }))
    .filter((g) => !gardes.has(g.titre));
  if (enTrop.length) {
    // on retire l'APPARTENANCE, pas la fiche : le jeu peut vivre dans d'autres listes
    await prisma.listItem.deleteMany({ where: { listId: list.id, gameId: { in: enTrop.map((g) => g.id) } } });
    console.log(`\n  ${enTrop.length} entrée(s) obsolète(s) retirée(s) : ${enTrop.slice(0, 8).map((g) => g.titre).join(", ")}${enTrop.length > 8 ? "…" : ""}`);
  }
  console.log(`\n${ok} jeux écrits dans /l/${SLUG} · ${fail} échecs`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
