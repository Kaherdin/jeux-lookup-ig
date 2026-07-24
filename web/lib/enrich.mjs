/**
 * lib.mjs — logique partagée d'enrichissement (Steam + IGDB + ITAD).
 * Utilisé par enrich.mjs (batch CSV) et server.mjs (ajout à la volée).
 * Node 18+, zéro dépendance.
 */
import { readFileSync, existsSync } from "node:fs";

export const COUNTRY = "CH", LANG = "fr", DELAY = 1100;
export const SEUIL_BON_PLAN = 15, SEUIL_REDUC = 40, SEUIL_NOTE = 80;

// mini .env loader
export function loadEnv() {
  if (existsSync(".env"))
    for (const line of readFileSync(".env", "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
      if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, "");
    }
  return {
    TWITCH_ID: process.env.TWITCH_ID,
    TWITCH_SECRET: process.env.TWITCH_SECRET,
    ITAD_KEY: process.env.ITAD_KEY,
    YOUTUBE_API_KEY: process.env.YOUTUBE_API_KEY,
  };
}
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- CSV --------------------------------------------------------------
export function parseCSV(text) {
  text = text.replace(/^﻿/, "");
  const rows = []; let row = [], field = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') q = false;
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\r") {}
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  const head = rows.shift();
  return rows.filter(r => r.length > 1).map(r => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ""])));
}
export function toCSV(objs) {
  const cols = Object.keys(objs[0]);
  const esc = (v) => { v = v == null ? "" : String(v); return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; };
  return "﻿" + [cols.join(","), ...objs.map(o => cols.map(c => esc(o[c])).join(","))].join("\n");
}

// --- date -> ISO ------------------------------------------------------
const MONTHS = { janv:"01",jan:"01","févr":"02",fevr:"02","fév":"02",feb:"02",mars:"03",mar:"03",avr:"04",apr:"04",mai:"05",may:"05",juin:"06",jun:"06",juil:"07",jul:"07","août":"08",aug:"08",sept:"09",sep:"09",oct:"10",nov:"11","déc":"12",dec:"12" };
export function dateToISO(txt) {
  if (!txt) return ["", ""];
  const t = txt.toLowerCase();
  if (/prochainement|à venir|a venir|coming|tba|to be announced/.test(t)) return ["", "à venir"];
  let m = t.match(/(\d{1,2})\s+([a-zéûà.]+?)\.?,?\s+(\d{4})/);
  if (m) { const mo = MONTHS[m[2].slice(0,4)] || MONTHS[m[2].slice(0,3)]; if (mo) return [`${m[3]}-${mo}-${String(+m[1]).padStart(2,"0")}`, "jour"]; }
  m = t.match(/([a-zéûà.]+?)\.?\s+(\d{4})/);
  if (m) { const mo = MONTHS[m[1].slice(0,4)] || MONTHS[m[1].slice(0,3)]; if (mo) return [`${m[2]}-${mo}`, "mois"]; }
  m = t.match(/[tq]([1-4])\s*(\d{4})/); if (m) return [`${m[2]}-${["","03","06","09","12"][+m[1]]}`, "trimestre"];
  m = t.match(/\b(20\d{2})\b/); if (m) return [m[1], "année"];
  return ["", "?"];
}
export const isoFromUnix = (s) => (s ? new Date(s * 1000).toISOString().slice(0, 10) : "");

// --- nb de joueurs depuis la légende ----------------------------------
export function parseJoueurs(legende) {
  if (!legende) return "";
  const t = legende.toLowerCase();
  let m = t.match(/(\d+)\s*(?:-|to|à|–)\s*(\d+)\s*(?:players?|joueurs?|player)/);
  if (m) return `${m[1]}-${m[2]}`;
  m = t.match(/up to\s*(\d+)\s*(?:players?|joueurs?)/);
  if (m) return `1-${m[1]}`;
  m = t.match(/(\d+)\s*(?:players?|joueurs?)/);
  if (m) return m[1];
  if (/single[\s-]?player|solo\b|1 player/.test(t)) return "1";
  return "";
}

// --- Steam ------------------------------------------------------------
// Similarité de noms (coefficient de Dice sur bigrammes) — 0..1, sans dépendance.
function bigrams(s) {
  const t = (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const m = new Map();
  for (let i = 0; i < t.length - 1; i++) { const g = t.slice(i, i + 2); m.set(g, (m.get(g) || 0) + 1); }
  return m;
}
export function dice(a, b) {
  const x = (a || "").toLowerCase(), y = (b || "").toLowerCase();
  if (!x || !y) return 0;
  if (x === y) return 1;
  const A = bigrams(x), B = bigrams(y);
  let inter = 0, sa = 0, sb = 0;
  for (const v of A.values()) sa += v;
  for (const v of B.values()) sb += v;
  for (const [g, ca] of A) inter += Math.min(ca, B.get(g) || 0);
  return sa + sb ? (2 * inter) / (sa + sb) : 0;
}

export async function steamSearch(title) {
  const u = `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(title)}&l=${LANG}&cc=${COUNTRY}`;
  const j = await fetch(u).then(r => r.json()).catch(() => ({}));
  const items = (j.items || []).slice(0, 10);
  if (!items.length) return null;
  // prend le meilleur match de NOM (évite un jeu obscur/à-venir mieux classé par Steam)
  items.sort((a, b) => dice(title, b.name) - dice(title, a.name));
  const it = items[0];
  // rejette les faux matchs (asset-flips type « WarOfGods 2 » pour « God of War II ») : seuil de similarité
  if (dice(title, it.name) < 0.6) return null;
  return { appid: String(it.id), name: it.name };
}
export async function steamDetails(appid) {
  const u = `https://store.steampowered.com/api/appdetails?appids=${appid}&cc=${COUNTRY}&l=${LANG}`;
  const j = await fetch(u).then(r => r.json()).catch(() => ({}));
  const d = j?.[appid]?.data; if (!d) return null;
  const [iso, prec] = dateToISO(d.release_date?.date || "");
  // On matche par ID de catégorie Steam (indépendant de la langue) :
  //  1 Multi · 2 Solo · 9 Coop · 20 MMO · 24 Écran partagé · 27 Cross-platform
  //  36 PvP en ligne · 37 PvP écran partagé · 38 Coop en ligne · 39 Coop écran partagé
  //  44 Remote Play Together · 47 PvP LAN · 48 Coop LAN · 49 PvP
  const ids = new Set((d.categories || []).map(c => c.id));
  const H = (id) => ids.has(id);
  const detail = {
    coopOnline: H(38), coopCouch: H(39), coopLan: H(48),
    pvpOnline: H(36), pvpCouch: H(37), pvpLan: H(47),
    remotePlay: H(44), crossPlatform: H(27),
  };
  const coop = H(9) || H(38) || H(39) || H(48);
  const pvp = H(49) || H(36) || H(37) || H(47);
  return {
    steamName: d.name,
    isFree: !!d.is_free,
    comingSoon: !!d.release_date?.coming_soon,
    priceCHF: d.is_free ? 0 : (d.price_overview?.final ?? null) / 100 || null,
    reducPct: d.price_overview?.discount_percent || 0,
    sortieISO: iso, sortiePrec: prec,
    metacritic: d.metacritic?.score ?? null,
    genres: (d.genres || []).map(g => g.description).join(", "),
    developpeur: (d.developers || []).slice(0, 2).join(", "),
    editeur: (d.publishers || []).slice(0, 2).join(", "),
    description: (d.short_description || "").slice(0, 600),
    header: d.header_image || "",
    solo: H(2),
    coop, pvp,
    multi: H(1) || H(20) || coop || pvp,
    detail,
    screenshots: (d.screenshots || []).slice(0, 10).map(s => s.path_full).filter(Boolean),
    trailer: (() => { const m = (d.movies || [])[0]; return m ? (m.mp4?.max || m.webm?.max || "") : ""; })(),
    trailerThumb: (d.movies || [])[0]?.thumbnail || "",
    url: `https://store.steampowered.com/app/${appid}/`,
  };
}
// % d'avis Steam (couvre la plupart des jeux sortis, même indés sans Metacritic)
export async function steamReviews(appid) {
  const u = `https://store.steampowered.com/appreviews/${appid}?json=1&language=all&purchase_type=all&num_per_page=0`;
  const j = await fetch(u).then(r => r.json()).catch(() => null);
  const s = j?.query_summary;
  if (!s || !s.total_reviews) return null;
  return {
    pct: Math.round((100 * s.total_positive) / s.total_reviews),
    count: s.total_reviews,
    desc: s.review_score_desc || "",
  };
}

// --- IGDB -------------------------------------------------------------
let igdbToken = null;
async function igdbAuth(env) {
  if (!env.TWITCH_ID || !env.TWITCH_SECRET) return null;
  if (igdbToken) return igdbToken;
  const u = `https://id.twitch.tv/oauth2/token?client_id=${env.TWITCH_ID}&client_secret=${env.TWITCH_SECRET}&grant_type=client_credentials`;
  const j = await fetch(u, { method: "POST" }).then(r => r.json()).catch(() => ({}));
  return (igdbToken = j.access_token || null);
}
const IGDB_FIELDS = "name,summary,first_release_date,aggregated_rating,total_rating,total_rating_count,platforms.abbreviation,genres.name,themes.name,involved_companies.company.name,involved_companies.developer,involved_companies.publisher,url,game_modes.slug,multiplayer_modes.*";
async function igdbQuery(body, env) {
  const tok = await igdbAuth(env); if (!tok) return [];
  const j = await fetch("https://api.igdb.com/v4/games", {
    method: "POST",
    headers: { "Client-ID": env.TWITCH_ID, Authorization: `Bearer ${tok}`, "Content-Type": "text/plain" },
    body,
  }).then(r => r.json()).catch(() => []);
  return Array.isArray(j) ? j : [];
}
// Transforme un objet jeu IGDB brut → forme normalisée.
function igdbShape(g) {
  const modes = (g.game_modes || []).map(m => m.slug);
  const mp = (g.multiplayer_modes || [])[0] || {};
  const joueursMax = Math.max(mp.onlinemax || 0, mp.offlinemax || 0, mp.onlinecoopmax || 0, mp.offlinecoopmax || 0) || null;
  return {
    igdbId: g.id, igdbName: g.name,
    sortieISO: isoFromUnix(g.first_release_date),
    note: g.aggregated_rating ? Math.round(g.aggregated_rating) : null,
    totalRating: g.total_rating ? Math.round(g.total_rating) : null,
    plateformes: (g.platforms || []).map(p => p.abbreviation).filter(Boolean),
    genres: (g.genres || []).map(x => x.name).join(", "),
    solo: modes.includes("single-player"),
    coop: modes.includes("co-operative"),
    pvp: modes.some(m => /player-versus-player|battle-royale/.test(m)),
    multi: modes.includes("multiplayer") || modes.includes("co-operative"),
    joueursMax,
    developpeur: pickCompany(g.involved_companies, "developer"),
    editeur: pickCompany(g.involved_companies, "publisher"),
    description: (g.summary || "").slice(0, 600),
    themes: (g.themes || []).map(t => t.name).join(", "),
    totalRatingCount: g.total_rating_count || 0,
    url: g.url,
  };
}
// Recherche par titre (fuzzy) → meilleur match par similarité de nom puis popularité.
export async function igdbLookup(title, env) {
  const arr = await igdbQuery(`search "${title.replace(/"/g, '')}"; fields ${IGDB_FIELDS}; limit 10;`, env);
  if (!arr.length) return null;
  arr.sort((a, b) => (dice(title, b.name) - dice(title, a.name)) || ((b.total_rating_count || 0) - (a.total_rating_count || 0)));
  return igdbShape(arr[0]);
}
// Récupère un jeu IGDB par ID exact (pas de re-recherche → données cohérentes avec le candidat).
export async function igdbById(id, env) {
  const arr = await igdbQuery(`where id = ${Number(id)}; fields ${IGDB_FIELDS}; limit 1;`, env);
  return arr.length ? igdbShape(arr[0]) : null;
}
// développeur / éditeur depuis involved_companies IGDB
function pickCompany(list, kind) {
  const c = (list || []).filter(x => x[kind]).map(x => x.company?.name).filter(Boolean);
  return [...new Set(c)].slice(0, 2).join(", ");
}

// --- ITAD -------------------------------------------------------------
export async function itadLookup(appid, title, env) {
  if (!env.ITAD_KEY) return null;
  const q = appid ? `appid=${appid}` : `title=${encodeURIComponent(title)}`;
  const j = await fetch(`https://api.isthereanydeal.com/games/lookup/v1?key=${env.ITAD_KEY}&${q}`).then(r => r.json()).catch(() => ({}));
  return j?.found ? j.game?.id : null;
}
export async function itadPrices(gameId, env) {
  if (!env.ITAD_KEY || !gameId) return null;
  const j = await fetch(`https://api.isthereanydeal.com/games/prices/v3?key=${env.ITAD_KEY}&country=${COUNTRY}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify([gameId]),
  }).then(r => r.json()).catch(() => []);
  const node = Array.isArray(j) ? j.find(x => x.id === gameId) : null;
  if (!node) return null;
  const deals = node.deals || [];
  const best = deals.reduce((a, d) => (a && a.price.amount <= d.price.amount ? a : d), null);
  return {
    meilleur: best?.price?.amount ?? null,
    devise: best?.price?.currency ?? "CHF",
    store: best?.shop?.name ?? "",
    reducPct: best?.cut ?? 0,
    plusBasHisto: node.historyLow?.all?.amount ?? node.historyLow?.y1?.amount ?? null,
    url: best?.url ?? "",
  };
}

// --- flags ------------------------------------------------------------
export function computeFlags(g) {
  const today = new Date().toISOString().slice(0, 10);
  const prix = g.prix?.meilleur ?? g.prixSteam;
  const dispo = g.comingSoon === false || (g.sortieISO && g.sortieISO <= today) || (prix != null && prix > 0);
  const gratuit = g.isFree === true || prix === 0;
  const bonPlan = !gratuit && prix != null && (
    prix <= SEUIL_BON_PLAN || (g.reducPct ?? 0) >= SEUIL_REDUC ||
    (g.prix?.plusBasHisto != null && prix <= g.prix.plusBasHisto * 1.1)
  );
  const note = g.note ?? g.metacritic ?? null;
  return { dispo: !!dispo, gratuit: !!gratuit, bonPlan: !!bonPlan, bienNote: note != null && note >= SEUIL_NOTE };
}

// --- détection de titre depuis un lien --------------------------------
const NOISE = "official|gameplay|trailer|launch|release date|release|announce(?:ment)?|reveal|teaser|review|walkthrough|first look|early access|remaster|4k|hd|full game|demo|pc|ps5|xbox|switch|steam";
function cleanTitle(raw) {
  if (!raw) return "";
  let t = raw
    // enlève les parenthèses/crochets bruités : (Official Video), [4K], (Launch Trailer)…
    .replace(new RegExp(`[\\(\\[][^\\)\\]]*(?:${NOISE})[^\\)\\]]*[\\)\\]]`, "gi"), "")
    // coupe à partir d'un séparateur suivi d'un mot bruité : "Nom - Official Trailer"
    .replace(new RegExp(`\\s*[-–|:]\\s*(?:${NOISE}).*`, "i"), "")
    // coupe un mot bruité isolé en fin : "Nom Gameplay"
    .replace(new RegExp(`\\b(?:${NOISE})\\b.*`, "i"), "")
    .replace(/[#|].*$/, "")
    .replace(/\s+\d{4}$/, "")
    .replace(/["""'']/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  return t.slice(0, 80);
}
async function fetchText(url) {
  return fetch(url, { headers: { "User-Agent": "Mozilla/5.0 GameBacklog/1.0" } })
    .then(r => r.text()).catch(() => "");
}
function metaContent(html, prop) {
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"']+)["']`, "i");
  const m = html.match(re) || html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${prop}["']`, "i"));
  return m ? m[1] : "";
}
/** Retourne {titre, steamAppId?, source} détecté depuis un lien ou du texte. */
export async function detectTitle(input) {
  const s = (input || "").trim();
  if (!s) return { titre: "", source: "vide" };

  // Steam
  let m = s.match(/store\.steampowered\.com\/app\/(\d+)/);
  if (m) {
    const d = await steamDetails(m[1]);
    return { titre: d?.steamName || "", steamAppId: m[1], source: "steam" };
  }
  // PlayStation Store (best-effort : og:title / twitter:title / <title>)
  if (/store\.playstation\.com\//.test(s)) {
    const html = await fetchText(s);
    let t = metaContent(html, "og:title") || metaContent(html, "twitter:title") || "";
    if (!t) { const m2 = html.match(/<title>([^<]*)<\/title>/i); t = m2 ? m2[1] : ""; }
    t = t.split(/\s*[|·–-]\s*/)[0]
      .replace(/\s+(sur|on|pour|for)\s+PlayStation.*/i, "")
      .replace(/PlayStation.*/i, "").trim();
    return { titre: cleanTitle(t), source: "psn", psnUrl: s };
  }
  // YouTube (oEmbed → titre vidéo → nettoyage)
  if (/youtube\.com\/watch|youtu\.be\/|youtube\.com\/shorts/.test(s)) {
    const j = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(s)}&format=json`)
      .then(r => r.ok ? r.json() : null).catch(() => null);
    return { titre: cleanTitle(j?.title || ""), source: "youtube", rawTitle: j?.title || "" };
  }
  // Instagram (og:title / og:description best-effort)
  if (/instagram\.com\//.test(s)) {
    const html = await fetchText(s);
    const title = metaContent(html, "og:title");
    const desc = metaContent(html, "og:description");
    // og:title Insta = "Username on Instagram: caption" ; on tente la caption
    let guess = "";
    const cap = (title.split(/ on Instagram[:]?/i)[1] || desc || "").trim();
    // cherche un motif "Name of the game: X" fréquent dans les reels
    const gm = cap.match(/(?:nom du jeu|game name|it['’]s called|jeu\s*:)\s*[:\-]?\s*([^\n.#]{2,60})/i);
    guess = gm ? gm[1] : cleanTitle(cap.split(/[\n#]/)[0] || "");
    return { titre: guess.trim().slice(0, 80), source: "instagram", rawTitle: cap.slice(0, 140) };
  }
  // texte libre = titre
  return { titre: cleanTitle(s), source: "texte" };
}

// Détecte les titres de « listicles » (Top 10, 15 Best Games…) qui ne sont pas un jeu unique.
export function looksLikeListicle(t) {
  const s = (t || "").trim();
  if (!s) return false;
  return /^\s*(top\s*)?\d+\s+(best|worst|top|greatest|amazing|awesome|new|upcoming|must|insane|craziest|meilleurs?|pires?)/i.test(s)
    || /\btop\s*\d+\b/i.test(s)
    || /\b\d+\s+(best|meilleurs?|jeux|games)\b/i.test(s)
    || /\bbest\b.*\bgames\b/i.test(s);
}

// Fallback LLM (Claude Haiku 4.5) pour compléter le nb de joueurs / modes quand les APIs ne les donnent pas.
async function llmGameInfo(titre, env) {
  const key = env.ANTHROPIC_API_KEY;
  if (!key || !titre) return null;
  try {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic({ apiKey: key });
    const msg = await client.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 300,
      system: "Tu es une base de données de jeux vidéo fiable. Réponds uniquement avec du JSON valide, sans aucun texte autour.",
      messages: [{
        role: "user",
        content: `Jeu vidéo : "${titre}". Réponds en JSON strict : {"joueurs": plage réelle comme "1", "1-4", "2-8" ou null, "solo": bool, "coop": bool, "pvp": bool, "dureeVie": durée de vie principale approx comme "~12h", "~40h", "100h+" ou null, "envergure": "Indé" | "AA" | "AAA" | null, "equipe": taille d'équipe approx comme "solo", "petit studio", "~50", "grand studio" ou null, "developpeur": nom du studio développeur ou null, "editeur": nom de l'éditeur ou null}. Si tu n'es pas certain qu'il s'agisse d'un vrai jeu, mets TOUT à null.`,
      }],
    });
    const txt = (msg.content || []).map((b) => (b.type === "text" ? b.text : "")).join("");
    const m = txt.match(/\{[\s\S]*\}/);
    return m ? JSON.parse(m[0]) : null;
  } catch {
    return null;
  }
}

// Correction de titre via Claude Haiku (typo → titre officiel), uniquement quand aucun match.
async function llmCorrectTitle(raw, env) {
  const key = env.ANTHROPIC_API_KEY;
  if (!key || !raw) return null;
  try {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic({ apiKey: key });
    const msg = await client.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 60,
      system: "Tu corriges des noms de jeux vidéo mal orthographiés. Réponds UNIQUEMENT par le titre officiel exact du jeu le plus probable, ou le mot NONE si ce n'est pas un jeu vidéo reconnaissable. Aucune autre parole, pas de guillemets.",
      messages: [{ role: "user", content: `Nom saisi : "${raw}". Titre officiel exact ?` }],
    });
    const t = (msg.content || []).map((b) => (b.type === "text" ? b.text : "")).join("").trim().replace(/^["']|["']$/g, "");
    return !t || /^none$/i.test(t) ? null : t.slice(0, 80);
  } catch {
    return null;
  }
}

// Extraction des titres de jeux depuis un texte libre / document (via Claude Haiku).
export async function llmExtractTitles(text, env) {
  const key = env.ANTHROPIC_API_KEY;
  if (!key || !text) return [];
  try {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic({ apiKey: key });
    const msg = await client.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 1200,
      system: "Tu extrais les noms de JEUX VIDÉO mentionnés dans un texte. Réponds UNIQUEMENT avec un tableau JSON de titres officiels exacts (chaînes), sans doublon, dans l'ordre d'apparition, sans aucun texte autour. Si aucun jeu, réponds [].",
      messages: [{ role: "user", content: text.slice(0, 12000) }],
    });
    const t = (msg.content || []).map((b) => (b.type === "text" ? b.text : "")).join("");
    const m = t.match(/\[[\s\S]*\]/);
    if (!m) return [];
    const arr = JSON.parse(m[0]);
    return Array.isArray(arr) ? arr.filter((x) => typeof x === "string" && x.trim()).slice(0, 40) : [];
  } catch {
    return [];
  }
}

// Envergure approximative (Indé / AA / AAA) depuis les genres/thèmes + popularité.
function envergureHeuristic(igdb, reviews, steam) {
  const g = `${igdb?.genres || ""} ${igdb?.themes || ""} ${steam?.genres || ""}`.toLowerCase();
  if (/\bindie\b|indé/.test(g)) return "Indé";
  const pop = Math.max(igdb?.totalRatingCount || 0, reviews?.count || 0);
  if (pop >= 20000) return "AAA";
  if (pop >= 2000) return "AA";
  return "";
}

/**
 * Enrichit un jeu à partir d'un enregistrement partiel.
 * rec = { titre, steamAppId?, coop?, multi?, genre?, univers?, sortieISO?,
 *         sortiePrec?, gratuitCsv?, legende?, reel?, createur?, plateforme? }
 */
export async function enrichGame(rec, env) {
  const title = (rec.titre || "").trim();
  let appid = rec.steamAppId ? String(rec.steamAppId).replace(/\/$/, "").split("/").pop() : null;
  if (appid && !/^\d+$/.test(appid)) appid = null;

  // résolution de l'appid Steam (nécessaire à Steam/ITAD) — le reste part en parallèle
  // si un ID IGDB est fourni (candidat choisi), on l'épingle au lieu de re-chercher (données cohérentes)
  const igdbP = rec.igdbId ? igdbById(rec.igdbId, env) : igdbLookup(title, env);
  if (!appid) { const s = await steamSearch(title); if (s) appid = s.appid; }
  const [igdb, steam, reviews, itadId] = await Promise.all([
    igdbP,
    appid ? steamDetails(appid) : null,
    appid ? steamReviews(appid) : null,
    itadLookup(appid, title, env),
  ]);
  const prix = itadId ? await itadPrices(itadId, env) : null;

  const coopCsv = (rec.coop || "").trim(), multiCsv = (rec.multi || "").trim();
  const modes = {
    solo: igdb?.solo || steam?.solo || false,
    coop: /oui|yes/i.test(coopCsv) || igdb?.coop || steam?.coop || false,
    pvp: igdb?.pvp || steam?.pvp || false,
    multi: /oui|yes/i.test(multiCsv) || igdb?.multi || steam?.multi || false,
  };
  if (modes.coop || modes.pvp) modes.multi = true;

  // note « affichée » multi-source : critiques IGDB > Metacritic > IGDB global > % avis Steam
  let noteAffichee = null, noteSource = "";
  if (igdb?.note != null) { noteAffichee = igdb.note; noteSource = "IGDB critiques"; }
  else if (steam?.metacritic != null) { noteAffichee = steam.metacritic; noteSource = "Metacritic"; }
  else if (igdb?.totalRating != null) { noteAffichee = igdb.totalRating; noteSource = "IGDB"; }
  else if (reviews?.pct != null) { noteAffichee = reviews.pct; noteSource = `Steam ${reviews.count} avis`; }

  // nb de joueurs : légende Insta > IGDB multiplayer_modes > existant
  let nbJoueurs = parseJoueurs(rec.legende) || rec.nbJoueurs || "";
  if (!nbJoueurs && igdb?.joueursMax) nbJoueurs = igdb.joueursMax > 1 ? `1-${igdb.joueursMax}` : "1";
  // enrichissement estimé via LLM (joueurs manquants + durée de vie / envergure / équipe / studio, absents ou douteux dans les APIs)
  let dureeVie = "", tailleEquipe = "", llmDev = "", llmEd = "";
  let envergure = envergureHeuristic(igdb, reviews, steam);
  if (env.ANTHROPIC_API_KEY) {
    const li = await llmGameInfo(title, env);
    if (li) {
      if (!nbJoueurs && li.joueurs) nbJoueurs = String(li.joueurs);
      if (!modes.solo && li.solo) modes.solo = true;
      if (!modes.coop && li.coop) { modes.coop = true; modes.multi = true; }
      if (!modes.pvp && li.pvp) { modes.pvp = true; modes.multi = true; }
      if (li.dureeVie) dureeVie = String(li.dureeVie);
      if (li.equipe) tailleEquipe = String(li.equipe);
      if (li.envergure) envergure = String(li.envergure);
      if (li.developpeur) llmDev = String(li.developpeur);
      if (li.editeur) llmEd = String(li.editeur);
    }
  }
  const mJ = nbJoueurs.match(/(\d+)\s*$/) || nbJoueurs.match(/(\d+)/);
  const nbJoueursMax = mJ ? +mJ[1] : (igdb?.joueursMax ?? null);

  const g = {
    titre: title,
    igdbId: igdb?.igdbId ?? "", steamAppId: appid ?? "",
    sortieISO: igdb?.sortieISO || steam?.sortieISO || rec.sortieISO || "",
    sortiePrec: igdb?.sortieISO ? "jour (IGDB)" : steam?.sortiePrec || rec.sortiePrec || "",
    isFree: steam?.isFree ?? null, comingSoon: steam?.comingSoon ?? null,
    prixSteam: steam?.priceCHF ?? null, reducPct: prix?.reducPct ?? steam?.reducPct ?? 0,
    prix,
    note: noteAffichee, noteSource,
    noteCritique: igdb?.note ?? steam?.metacritic ?? null,
    metacritic: steam?.metacritic ?? null,
    steamPct: reviews?.pct ?? null, steamAvis: reviews?.count ?? null, steamDesc: reviews?.desc ?? "",
    modes, modesDetail: steam?.detail || {},
    coop: modes.coop ? "Oui" : (coopCsv || ""),
    multi: modes.multi ? "Oui" : (multiCsv || ""),
    nbJoueurs, nbJoueursMax,
    genre: rec.genre || igdb?.genres || steam?.genres || "",
    themes: igdb?.themes || "",
    developpeur: steam?.developpeur || llmDev || igdb?.developpeur || "",
    editeur: steam?.editeur || llmEd || igdb?.editeur || "",
    description: steam?.description || igdb?.description || "",
    envergure, dureeVie, tailleEquipe,
    univers: rec.univers || "",
    plateformes: (() => {
      let p = igdb?.plateformes?.length ? igdb.plateformes : (rec.plateforme ? [rec.plateforme] : []);
      if (appid && !p.some((x) => /^pc$/i.test(x))) p = [...p, "PC"]; // sur Steam ⇒ au moins PC
      return p;
    })(),
    gratuitCsv: (rec.gratuitCsv || "").trim(),
    image: steam?.header || "",
    screenshots: steam?.screenshots || [],
    trailer: steam?.trailer || "", trailerThumb: steam?.trailerThumb || "",
    urlSteam: steam?.url || "", urlIgdb: igdb?.url || "", urlStore: prix?.url || "",
    urlPsn: rec.psnUrl || "",
    reel: rec.reel || "", createur: rec.createur || "",
    ajouteLe: rec.ajouteLe || "",
  };
  Object.assign(g, computeFlags(g));
  if (!g.gratuit && /gratuit|free/i.test(g.gratuitCsv)) g.gratuitMention = g.gratuitCsv;
  return g;
}

// --- ajout multiple ---------------------------------------------------
// Récupère les titres des vidéos d'une playlist YouTube (nécessite YOUTUBE_API_KEY).
export async function youtubePlaylistTitles(url, env) {
  const key = env.YOUTUBE_API_KEY;
  const m = url.match(/[?&]list=([\w-]+)/);
  if (!key) return { error: "YOUTUBE_API_KEY manquante (playlist YouTube)." };
  if (!m) return { error: "URL de playlist YouTube invalide (pas de paramètre list=)." };
  const titles = [];
  let pageToken = "";
  for (let i = 0; i < 5; i++) { // max 250 vidéos
    const u = `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&maxResults=50&playlistId=${m[1]}&key=${key}${pageToken ? `&pageToken=${pageToken}` : ""}`;
    const j = await fetch(u).then(r => r.json()).catch(() => ({}));
    if (j.error) return { error: j.error?.message || "Erreur API YouTube." };
    for (const it of (j.items || [])) {
      const t = it.snippet?.title;
      if (t && !/deleted video|private video/i.test(t)) titles.push(t);
    }
    if (!j.nextPageToken) break;
    pageToken = j.nextPageToken;
  }
  return { titles };
}

// Détection « légère » pour la preview : résout le titre canonique (via Steam) sans tout enrichir.
export async function detectLight(input, env) {
  const det = await detectTitle(input);
  let titre = det.titre, appid = det.steamAppId || "", name = titre, image = "";
  if (titre && !appid) { const s = await steamSearch(titre); if (s) { appid = s.appid; name = s.name; } }
  if (appid) { const d = await steamDetails(appid); if (d) { name = d.steamName || name; image = d.header || ""; } }
  return {
    input, source: det.source,
    titre: (name || titre || "").trim(),
    steamAppId: appid, image, psnUrl: det.psnUrl || "",
  };
}

// Analyse un lot d'entrées (texte multi-lignes + playlist) → jeux ENRICHIS complets (preview).
// Chaque jeu non-doublon est entièrement enrichi (genre, joueurs, note, prix, date, screenshots…).
export async function detectMany({ text = "", playlist = "", extract = false }, env, existingTitles = []) {
  const inputs = [];
  if (playlist) {
    const r = await youtubePlaylistTitles(playlist, env);
    if (r.error) return { error: r.error };
    inputs.push(...r.titles);
  }
  if (text) {
    // extract = texte libre / document → on demande au LLM d'en extraire les titres
    if (extract) inputs.push(...(await llmExtractTitles(text, env)));
    else inputs.push(...text.split(/\r?\n/).map(s => s.trim()).filter(Boolean));
  }
  if (!inputs.length) return { error: extract ? "Aucun jeu trouvé dans le texte." : "Rien à analyser." };
  if (inputs.length > 40) inputs.length = 40; // garde-fou

  const seen = new Set(existingTitles.map(t => t.toLowerCase()));
  const out = [];
  const skipped = [];
  const CONC = 4;
  for (let i = 0; i < inputs.length; i += CONC) {
    const batch = await Promise.all(inputs.slice(i, i + CONC).map(async (inp) => {
      // écarte les listicles (Top 10, 15 Best Games…) : ce ne sont pas des jeux
      if (looksLikeListicle(inp)) return { skip: inp };
      const d = await detectLight(inp, env).catch(() => null);
      if (!d || !d.titre) return { skip: inp };
      if (looksLikeListicle(d.titre)) return { skip: inp };
      const key = d.titre.toLowerCase();
      if (seen.has(key)) return { ...d, duplicate: true };
      const enriched = await enrichGame(
        { titre: d.titre, steamAppId: d.steamAppId, psnUrl: d.psnUrl,
          reel: d.source === "instagram" || d.source === "youtube" ? d.input : "" },
        env
      ).catch(() => null);
      const good = enriched && (enriched.steamAppId || enriched.igdbId) &&
        !(d.source === "texte" && dice(inp, enriched.titre) < 0.34);
      if (good) return { ...enriched, input: d.input, source: d.source, duplicate: false };
      // aucun match fiable : dernier recours = correction du titre via LLM, puis nouvelle tentative
      if (d.source === "texte" && env.ANTHROPIC_API_KEY) {
        const fixed = await llmCorrectTitle(inp, env);
        if (fixed && fixed.toLowerCase() !== inp.toLowerCase()) {
          const e2 = await enrichGame({ titre: fixed }, env).catch(() => null);
          if (e2 && (e2.steamAppId || e2.igdbId)) {
            if (seen.has(e2.titre.toLowerCase())) return { ...e2, duplicate: true };
            return { ...e2, input: d.input, source: d.source, duplicate: false, corrected: inp };
          }
        }
      }
      return { skip: d.input || inp };
    }));
    for (const g of batch) {
      if (!g) continue;
      if (g.skip) { skipped.push(g.skip); continue; }
      if (!g.duplicate) seen.add(g.titre.toLowerCase());
      out.push(g);
    }
  }
  return { games: out, skipped };
}

// Moteur de découverte IGDB : filtre par plateforme / genre / mode / coop local / joueurs / note.
// criteria = { platforms:[ids], genres:[ids], modes:[ids], coopLocal:bool, playersMin:int, noteMin:int, sinceYear:int, sort:"pop"|"note"|"recent" }
export async function igdbDiscover(criteria, env, limit = 30) {
  const c = criteria || {};
  const w = ["game_type = 0", "parent_game = null", "version_parent = null"]; // jeux principaux (pas DLC/éditions)
  const ids = (a) => (Array.isArray(a) ? a.filter((x) => Number.isFinite(+x)).map(Number) : []);
  const plats = ids(c.platforms), genres = ids(c.genres), modes = ids(c.modes);
  if (plats.length) w.push(`platforms = (${plats.join(",")})`);
  if (genres.length) w.push(`genres = (${genres.join(",")})`);
  if (modes.length) w.push(`game_modes = (${modes.join(",")})`);
  if (c.coopLocal) w.push("(multiplayer_modes.splitscreen = true | game_modes = (4))");
  const pMin = +c.playersMin || 0;
  if (pMin > 1) {
    w.push(c.coopLocal
      ? `(multiplayer_modes.offlinemax >= ${pMin} | multiplayer_modes.offlinecoopmax >= ${pMin})`
      : `(multiplayer_modes.onlinemax >= ${pMin} | multiplayer_modes.offlinemax >= ${pMin})`);
  }
  const nMin = +c.noteMin || 0;
  if (nMin > 0) w.push(`total_rating >= ${nMin}`);
  // seuil d'avis pour éviter les jeux obscurs notés 100 sur 5 avis (plus haut si on trie par note)
  const countFloor = c.sort === "note" ? 30 : nMin > 0 ? 15 : 5;
  w.push(`total_rating_count >= ${countFloor}`);
  const yr = +c.sinceYear || 0;
  if (yr > 1970) w.push(`first_release_date >= ${Math.floor(Date.UTC(yr, 0, 1) / 1000)}`);
  const sort = c.sort === "note" ? "total_rating desc" : c.sort === "recent" ? "first_release_date desc" : "total_rating_count desc";
  const body = `where ${w.join(" & ")}; sort ${sort}; fields name,cover.image_id,first_release_date,total_rating,total_rating_count,platforms.abbreviation,genres.name,game_modes.slug; limit ${limit};`;
  const arr = await igdbQuery(body, env);
  return arr.map((g) => ({
    igdbId: g.id,
    titre: g.name,
    cover: g.cover?.image_id ? `https://images.igdb.com/igdb/image/upload/t_cover_big/${g.cover.image_id}.jpg` : "",
    annee: g.first_release_date ? new Date(g.first_release_date * 1000).getUTCFullYear() : null,
    note: g.total_rating ? Math.round(g.total_rating) : null,
    plateformes: (g.platforms || []).map((p) => p.abbreviation).filter(Boolean),
    genres: (g.genres || []).map((x) => x.name).join(", "),
  }));
}

// Recherche IGDB brute (candidats) — renvoie [{name, total_rating_count}].
export async function igdbSearch(query, env, limit = 15) {
  const tok = await igdbAuth(env); if (!tok) return [];
  const body = `search "${query.replace(/"/g, '')}"; fields name,total_rating_count; limit ${limit};`;
  const j = await fetch("https://api.igdb.com/v4/games", {
    method: "POST",
    headers: { "Client-ID": env.TWITCH_ID, Authorization: `Bearer ${tok}`, "Content-Type": "text/plain" },
    body,
  }).then(r => r.json()).catch(() => []);
  return Array.isArray(j) ? j : [];
}

// Recherche multi-candidats pour un titre tapé → jusqu'à `max` jeux enrichis à choisir.
export async function detectCandidates(query, env, existingTitles = [], max = 6) {
  const q = (query || "").trim();
  if (!q) return { games: [] };
  let arr = await igdbSearch(q, env, 15);
  let corrected = "";
  if (!arr.length && env.ANTHROPIC_API_KEY) {
    const fixed = await llmCorrectTitle(q, env);
    if (fixed) { const a2 = await igdbSearch(fixed, env, 15); if (a2.length) { arr = a2; corrected = q; } }
  }
  const seen = new Set(existingTitles.map(t => t.toLowerCase()));
  if (!arr.length) {
    // dernier recours : un seul match via Steam
    const s = await steamSearch(q);
    if (!s) return { games: [] };
    const g = await enrichGame({ titre: s.name, steamAppId: s.appid }, env).catch(() => null);
    if (!g || (!g.steamAppId && !g.igdbId)) return { games: [] };
    return { games: [{ ...g, input: q, source: "texte", duplicate: seen.has(g.titre.toLowerCase()) }] };
  }
  // classe par similarité de nom puis popularité ; garde les meilleurs candidats
  arr.sort((a, b) => (dice(q, b.name) - dice(q, a.name)) || ((b.total_rating_count || 0) - (a.total_rating_count || 0)));
  const top = arr.filter(g => dice(q, g.name) >= 0.3).slice(0, max);
  const chosen = top.length ? top : arr.slice(0, 1);
  const out = [];
  const CONC = 4;
  for (let i = 0; i < chosen.length; i += CONC) {
    const batch = await Promise.all(chosen.slice(i, i + CONC).map(async (c) => {
      const g = await enrichGame({ titre: c.name, igdbId: c.id }, env).catch(() => null);
      if (!g || (!g.steamAppId && !g.igdbId)) return null;
      return { ...g, input: q, source: "texte", duplicate: seen.has(g.titre.toLowerCase()), corrected: corrected || undefined };
    }));
    for (const g of batch) if (g && !out.some(o => o.titre.toLowerCase() === g.titre.toLowerCase())) out.push(g);
  }
  return { games: out };
}
