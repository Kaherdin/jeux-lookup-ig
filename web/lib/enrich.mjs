/**
 * lib.mjs — logique partagée d'enrichissement (Steam + IGDB + ITAD).
 * Utilisé par enrich.mjs (batch CSV) et server.mjs (ajout à la volée).
 * Node 18+, zéro dépendance.
 */
import { readFileSync, existsSync } from "node:fs";
import { prixPsn } from "./psn-store.mjs";

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

// Joueurs connectés en ce moment (API publique Steam, sans clé) — indicateur de
// popularité vivante, complémentaire du nombre d'avis qui, lui, ne bouge plus.
export async function steamPlayers(appid) {
  const u = `https://api.steampowered.com/ISteamUserStats/GetNumberOfCurrentPlayers/v1/?appid=${appid}`;
  const j = await fetch(u).then((r) => r.json()).catch(() => null);
  const n = j?.response?.player_count;
  return Number.isFinite(n) ? n : null;
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
const IGDB_FIELDS = "name,summary,first_release_date,aggregated_rating,total_rating,total_rating_count,platforms.abbreviation,genres.name,themes.name,involved_companies.company.name,involved_companies.developer,involved_companies.publisher,cover.image_id,videos.video_id,url,game_modes.slug,multiplayer_modes.*";
async function igdbQuery(body, env, endpoint = "games") {
  const tok = await igdbAuth(env); if (!tok) return [];
  const j = await fetch(`https://api.igdb.com/v4/${endpoint}`, {
    method: "POST",
    headers: { "Client-ID": env.TWITCH_ID, Authorization: `Bearer ${tok}`, "Content-Type": "text/plain" },
    body,
  }).then(r => r.json()).catch(() => []);
  return Array.isArray(j) ? j : [];
}
/**
 * Lien de la fiche PlayStation Store, lu dans les « jeux externes » d'IGDB
 * (source 36 = PlayStation Store US). C'est la seule piste fiable : Sony n'expose
 * aucune recherche publique, et une URL devinée depuis le titre ne tombe jamais juste.
 * Un jeu absent du PS Store n'a tout simplement pas cette source — d'où la chaîne vide.
 */
async function igdbPsnUrl(igdbId, env) {
  if (!igdbId) return "";
  const r = await igdbQuery(`fields url; where game = ${igdbId} & external_game_source = 36; limit 1;`, env, "external_games");
  return r?.[0]?.url || "";
}

// Transforme un objet jeu IGDB brut → forme normalisée.
function igdbShape(g) {
  const modes = (g.game_modes || []).map(m => m.slug);
  const mps = g.multiplayer_modes || [];
  const maxOf = (k) => Math.max(0, ...mps.map(m => m[k] || 0));
  const splitscreen = mps.some(m => m.splitscreen || m.splitscreenonline);
  const lancoop = mps.some(m => m.lancoop);
  // distingue précisément LOCAL (hors ligne / écran partagé) et EN LIGNE
  let localMax = Math.max(maxOf("offlinemax"), maxOf("offlinecoopmax"));
  if (!localMax && splitscreen) localMax = 2;
  const onlineMax = Math.max(maxOf("onlinemax"), maxOf("onlinecoopmax")) || null;
  const joueursMax = Math.max(localMax || 0, onlineMax || 0) || null;
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
    joueursMax, localMax: localMax || null, onlineMax, splitscreen, lancoop,
    developpeur: pickCompany(g.involved_companies, "developer"),
    editeur: pickCompany(g.involved_companies, "publisher"),
    description: (g.summary || "").slice(0, 600),
    themes: (g.themes || []).map(t => t.name).join(", "),
    totalRatingCount: g.total_rating_count || 0,
    cover: g.cover?.image_id ? `https://images.igdb.com/igdb/image/upload/t_cover_big/${g.cover.image_id}.jpg` : "",
    videoYoutube: (g.videos || [])[0]?.video_id || "",
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
    // (inclut le tiret cadratin « — », très courant dans les titres de trailers)
    .replace(new RegExp(`\\s*[-–—|:]\\s*(?:${NOISE}).*`, "i"), "")
    // coupe un mot bruité isolé en fin : "Nom Gameplay"
    .replace(new RegExp(`\\b(?:${NOISE})\\b.*`, "i"), "")
    .replace(/[#|].*$/, "")
    // année de publication accolée en fin (« … 2024 ») — mais jamais une année qui fait
    // partie du titre : 2077 (Cyberpunk), 2142, 3000… ne sont pas des dates de vidéo.
    .replace(/\s+(\d{4})$/, (s, y) => (+y >= 2000 && +y <= new Date().getFullYear() + 2 ? "" : s))
    .replace(/["""'']/g, "")
    .replace(/\s{2,}/g, " ")
    // ponctuation de séparation restée orpheline en bout de titre
    .replace(/[\s\-–—|:,.]+$/, "")
    .replace(/^[\s\-–—|:,.]+/, "")
    .trim();
  return t.slice(0, 80);
}
// UA de navigateur : YouTube, le PS Store et la plupart des boutiques servent une page
// vide (ou une redirection « robot ») à un agent inconnu — sans lui, aucune métadonnée.
const BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
async function fetchText(url) {
  return fetch(url, { headers: { "User-Agent": BROWSER_UA, "Accept-Language": "fr,en;q=0.8" } })
    .then(r => r.text()).catch(() => "");
}
export const isUrl = (s) => /^https?:\/\//i.test((s || "").trim());
// Appel à l'API YouTube. Une clé Google restreinte « par référent HTTP » (le réglage par
// défaut quand on la crée depuis un site) est refusée sans en-tête Referer :
// « Requests from referer <empty> are blocked. » On envoie donc l'URL publique de l'app,
// qui est justement celle autorisée sur la clé.
export async function youtubeApi(url, env = {}) {
  const site = env.APP_URL || "http://localhost:3000";
  return fetch(url, { headers: { Referer: site.replace(/\/?$/, "/"), Origin: site.replace(/\/$/, "") } })
    .then((r) => r.json())
    .catch(() => ({}));
}
// Les liens Steam d'une description désignent les jeux sans la moindre ambiguïté.
export function steamAppIdsFrom(txt) {
  return [...new Set([...String(txt || "").matchAll(/store\.steampowered\.com\/app\/(\d+)/g)].map((x) => x[1]))];
}
// Une ligne est-elle de la prose (phrase, paragraphe, extrait d'article) plutôt qu'un titre ?
// Un titre de jeu dépasse rarement 80 caractères ou 12 mots.
export function looksLikeProse(line) {
  const s = (line || "").trim();
  if (!s) return false;
  return s.length > 80 || s.split(/\s+/).length >= 12;
}
// Une ligne est-elle un titre de jeu utilisable TEL QUEL ? Un chapitrage collé depuis
// YouTube (« 0:51 Rhythm Heaven Groover », « (1-4 Local) », « [ Review Round Up ] »)
// n'en est pas un : envoyé brut au moteur de recherche il ne matche rien — c'est à l'IA
// d'en extraire les vrais titres.
export function looksLikeCleanTitle(line) {
  const s = (line || "").trim();
  if (!s || looksLikeProse(s)) return false;
  if (/^\d{1,2}:\d{2}/.test(s)) return false;             // horodatage
  if (/^\d{1,3}\s*[).\-–—:]/.test(s)) return false;       // « 3. Jeu », « 12) Jeu »
  if (/^[[(<{•*+-]/.test(s)) return false;                // section, puce, annotation
  if (/^(?:https?:)?\/\//i.test(s)) return false;
  return true;
}
function metaContent(html, prop) {
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"']+)["']`, "i");
  const m = html.match(re) || html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${prop}["']`, "i"));
  return m ? m[1] : "";
}
/** Retourne {titre, steamAppId?, source} détecté depuis un lien ou du texte. */
export async function detectTitle(input, env = {}) {
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
  // YouTube — même logique que l'ajout multiple : un trailer donne son jeu,
  // une sélection donne son premier jeu (utiliser l'onglet « Plusieurs » pour tous les avoir).
  if (/youtube\.com\/watch|youtu\.be\/|youtube\.com\/shorts/.test(s)) {
    const r = await youtubeVideoGames(s, env).catch(() => ({ games: [] }));
    return { titre: (r.games[0] || "").slice(0, 80), source: "youtube", rawTitle: r.titreVideo || "", multi: r.multi, autres: r.games.slice(1), error: r.error };
  }
  // Instagram — la légende n'est lisible qu'avec un jeton oEmbed officiel (voir instagramGames)
  if (/instagram\.com\//.test(s)) {
    const r = await instagramGames(s, env).catch(() => ({ games: [] }));
    return { titre: (r.games[0] || "").slice(0, 80), source: "instagram", rawTitle: (r.caption || "").slice(0, 140), error: r.error };
  }
  // n'importe quel autre lien (Nintendo, Xbox, Epic, GOG, un article de blog…) :
  // on lit le titre de la page. C'est ce qui permet au champ unique de « se débrouiller ».
  if (isUrl(s)) {
    const html = await fetchText(s);
    let t = metaContent(html, "og:title") || metaContent(html, "twitter:title") || "";
    if (!t) { const m3 = html.match(/<title>([^<]*)<\/title>/i); t = m3 ? m3[1] : ""; }
    // « Hades II sur Nintendo Switch — Site officiel » → « Hades II »
    t = t.split(/\s+[|·—–]\s+/)[0].replace(/\s+(?:sur|on|pour|for)\s+(?:Nintendo|Xbox|PlayStation|PC|Steam|Epic|GOG).*/i, "").trim();
    const titre = cleanTitle(t);
    return { titre, source: "lien", error: titre ? undefined : "Lien illisible : impossible d'y lire un titre de jeu." };
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

// --- accès LLM (Claude, puis OpenAI en secours) ------------------------
// Un seul point d'entrée : si la clé Anthropic manque ou que l'appel échoue
// (quota épuisé, panne…), on rebascule automatiquement sur OpenAI. Sans quoi
// toute la détection (extraction de jeux, correction de titre) tombe en panne
// silencieusement dès qu'un fournisseur est indisponible.
export const OPENAI_MODEL_DEFAUT = "gpt-5.4-mini";

async function llmText({ system, user, maxTokens = 800, env }) {
  if (env.ANTHROPIC_API_KEY) {
    try {
      const { default: Anthropic } = await import("@anthropic-ai/sdk");
      const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
      const msg = await client.messages.create({
        model: env.ANTHROPIC_MODEL || "claude-haiku-4-5",
        max_tokens: maxTokens, system,
        messages: [{ role: "user", content: user }],
      });
      const t = (msg.content || []).map((b) => (b.type === "text" ? b.text : "")).join("").trim();
      if (t) return t;
    } catch {
      /* on tente le fournisseur suivant */
    }
  }
  if (env.OPENAI_API_KEY) {
    try {
      const r = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: env.OPENAI_MODEL || OPENAI_MODEL_DEFAUT,
          max_completion_tokens: Math.max(maxTokens, 1500), // marge pour les tokens de raisonnement
          messages: [{ role: "system", content: system }, { role: "user", content: user }],
        }),
      });
      const j = await r.json();
      if (j.error) return null;
      return (j.choices?.[0]?.message?.content || "").trim() || null;
    } catch {
      return null;
    }
  }
  return null;
}
export const hasLLM = (env) => !!(env?.ANTHROPIC_API_KEY || env?.OPENAI_API_KEY);
function parseJson(txt, ouvrant = "{", fermant = "}") {
  if (!txt) return null;
  const m = txt.match(ouvrant === "[" ? /\[[\s\S]*\]/ : /\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

// Fallback LLM pour compléter le nb de joueurs / modes quand les APIs ne les donnent pas.
async function llmGameInfo(titre, env) {
  if (!titre || !hasLLM(env)) return null;
  const txt = await llmText({
    env, maxTokens: 300,
    system: "Tu es une base de données de jeux vidéo fiable. Réponds uniquement avec du JSON valide, sans aucun texte autour.",
    user: `Jeu vidéo : "${titre}". Réponds en JSON strict : {"joueurs": plage réelle comme "1", "1-4", "2-8" ou null, "solo": bool, "coop": bool, "pvp": bool, "localMax": nb max de joueurs en LOCAL/canapé (même écran/console) ou null, "onlineMax": nb max de joueurs EN LIGNE ou null, "dureeVie": durée de vie principale approx comme "~12h", "~40h", "100h+" ou null, "envergure": "Indé" | "AA" | "AAA" | null, "equipe": taille d'équipe approx comme "solo", "petit studio", "~50", "grand studio" ou null, "developpeur": nom du studio développeur ou null, "editeur": nom de l'éditeur ou null}. Si tu n'es pas certain qu'il s'agisse d'un vrai jeu, mets TOUT à null.`,
  });
  return parseJson(txt);
}

// Correction de titre (typo → titre officiel), uniquement quand aucun match.
async function llmCorrectTitle(raw, env) {
  if (!raw || !hasLLM(env)) return null;
  const t = (await llmText({
    env, maxTokens: 60,
    system: "Tu corriges des noms de jeux vidéo mal orthographiés. Réponds UNIQUEMENT par le titre officiel exact du jeu le plus probable, ou le mot NONE si ce n'est pas un jeu vidéo reconnaissable. Aucune autre parole, pas de guillemets.",
    user: `Nom saisi : "${raw}". Titre officiel exact ?`,
  }))?.replace(/^["']|["']$/g, "").trim();
  return !t || /^none$/i.test(t) ? null : t.slice(0, 80);
}

// Extraction des titres de jeux depuis un texte libre / document.
export async function llmExtractTitles(text, env) {
  if (!text || !hasLLM(env)) return [];
  const txt = await llmText({
    env, maxTokens: 1200,
    system: "Tu extrais les noms de JEUX VIDÉO mentionnés dans un texte. Réponds UNIQUEMENT avec un tableau JSON de titres officiels exacts (chaînes), sans doublon, dans l'ordre d'apparition, sans aucun texte autour. Si aucun jeu, réponds [].",
    user: text.slice(0, 12000),
  });
  const arr = parseJson(txt, "[");
  return Array.isArray(arr) ? arr.filter((x) => typeof x === "string" && x.trim()).slice(0, 40) : [];
}

// Extraction ciblée « contenu d'une publication » (vidéo YouTube, post Instagram).
// Différence clé avec llmExtractTitles : on ne veut QUE les jeux réellement présentés,
// pas ceux qui traînent dans les liens promo, les hashtags de chaîne ou les sponsors.
export async function llmExtractGamesFromPost({ titre, texte, source }, env) {
  if (!hasLLM(env)) return [];
  const txt = await llmText({
    env, maxTokens: 1200,
    system: `Tu extrais les JEUX VIDÉO réellement présentés dans une publication ${source}.
RÈGLES :
- Ne retiens que les jeux qui font l'objet de la publication (ceux montrés / listés / recommandés).
- IGNORE : les liens promotionnels, les autres vidéos de la chaîne, les sponsors, les noms de chaînes,
  de studios, de consoles, de logiciels, les hashtags de marque et les jeux cités en simple comparaison.
- Rends les titres OFFICIELS exacts (corrige les abréviations : « BOTW » → « The Legend of Zelda: Breath of the Wild »).
- Ordre d'apparition, sans doublon.
Réponds UNIQUEMENT par un tableau JSON de chaînes. Aucun jeu → [].`,
    user: `Titre : ${titre || "(aucun)"}\n\nTexte :\n${(texte || "").slice(0, 8000)}`,
  });
  const arr = parseJson(txt, "[");
  return Array.isArray(arr) ? arr.filter((x) => typeof x === "string" && x.trim()).slice(0, 40) : [];
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
  const [igdb, steam, reviews, joueursSteam, itadId] = await Promise.all([
    igdbP,
    appid ? steamDetails(appid) : null,
    appid ? steamReviews(appid) : null,
    appid ? steamPlayers(appid) : null,
    itadLookup(appid, title, env),
  ]);
  const prix = itadId ? await itadPrices(itadId, env) : null;
  // PlayStation : le lien vient d'IGDB, le prix se relève sur la fiche du store — ITAD
  // ne suit que des boutiques PC. Un jeu sans fiche PSN ne coûte qu'une requête IGDB.
  const psnUrl = rec.psnUrl || (igdb?.igdbId ? await igdbPsnUrl(igdb.igdbId, env) : "");
  const psn = psnUrl ? await prixPsn(psnUrl) : null;

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
  let dureeVie = "", tailleEquipe = "", llmDev = "", llmEd = "", llmLocal = null, llmOnline = null;
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
      if (+li.localMax) llmLocal = +li.localMax;
      if (+li.onlineMax) llmOnline = +li.onlineMax;
    }
  }
  // joueurs LOCAL vs EN LIGNE (IGDB multiplayer_modes > LLM)
  const joueursLocalMax = igdb?.localMax ?? llmLocal ?? null;
  const joueursOnlineMax = igdb?.onlineMax ?? llmOnline ?? null;
  if (!nbJoueurs && (joueursLocalMax || joueursOnlineMax)) {
    const mx = Math.max(joueursLocalMax || 0, joueursOnlineMax || 0);
    nbJoueurs = mx > 1 ? `1-${mx}` : "1";
  }
  const mJ = nbJoueurs.match(/(\d+)\s*$/) || nbJoueurs.match(/(\d+)/);
  const nbJoueursMax = mJ ? +mJ[1] : (igdb?.joueursMax ?? (Math.max(joueursLocalMax || 0, joueursOnlineMax || 0) || null));

  const g = {
    titre: title,
    // noms officiels des sources : servent à vérifier qu'on a bien matché le bon jeu
    // (sans eux, comparer `titre` au titre saisi revient à le comparer à lui-même)
    steamName: steam?.steamName || "", igdbName: igdb?.igdbName || "",
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
    joueursSteam, igdbVotes: igdb?.totalRatingCount || null,
    modes,
    modesDetail: { ...(steam?.detail || {}), splitscreen: igdb?.splitscreen || undefined, lancoop: igdb?.lancoop || undefined },
    coop: modes.coop ? "Oui" : (coopCsv || ""),
    multi: modes.multi ? "Oui" : (multiCsv || ""),
    nbJoueurs, nbJoueursMax, joueursLocalMax, joueursOnlineMax,
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
    image: steam?.header || igdb?.cover || rec.image || "", // Steam > jaquette IGDB > image existante (PSN)
    screenshots: steam?.screenshots || [],
    trailer: steam?.trailer || "", trailerThumb: steam?.trailerThumb || "",
    trailerYoutube: igdb?.videoYoutube || "", // vidéo YouTube IGDB (fallback quand pas de trailer Steam)
    urlSteam: steam?.url || "", urlIgdb: igdb?.url || "", urlStore: prix?.url || "",
    urlPsn: psn?.url || psnUrl || "",
    prixPsn: psn && !psn.gratuit
      ? { prix: psn.prix, base: psn.base, reducPct: psn.reducPct, devise: psn.devise, plusInclus: psn.plusInclus }
      : null,
    reel: rec.reel || "", createur: rec.createur || "",
    ajouteLe: rec.ajouteLe || "",
  };
  Object.assign(g, computeFlags(g));
  if (!g.gratuit && /gratuit|free/i.test(g.gratuitCsv)) g.gratuitMention = g.gratuitCsv;
  return g;
}

// --- ajout multiple ---------------------------------------------------
// Titres des vidéos d'une playlist YouTube. L'API officielle pagine (jusqu'à 250 vidéos)
// mais échoue si la clé est restreinte par référent ; on retombe alors sur la page HTML,
// qui donne les ~100 premières vidéos sans aucune clé.
export async function youtubePlaylistTitles(url, env) {
  const propre = (t) => t && !/^(?:deleted|private) video$/i.test(t.trim());
  const m = String(url || "").match(/[?&]list=([\w-]+)/);
  if (!m) return { error: "URL de playlist YouTube invalide (pas de paramètre list=)." };
  const key = env.YOUTUBE_API_KEY;
  if (key) {
    const titles = [];
    let pageToken = "", apiError = "";
    for (let i = 0; i < 5; i++) { // max 250 vidéos
      const u = `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&maxResults=50&playlistId=${m[1]}&key=${key}${pageToken ? `&pageToken=${pageToken}` : ""}`;
      const j = await youtubeApi(u, env);
      if (j.error) {
        apiError = j.error?.message || "Erreur API YouTube.";
        console.warn("[youtube] API playlist refusée :", apiError, "— repli sur la page HTML.");
        break;
      }
      for (const it of (j.items || [])) if (propre(it.snippet?.title)) titles.push(it.snippet.title);
      if (!j.nextPageToken) break;
      pageToken = j.nextPageToken;
    }
    if (titles.length) return { titles };
    if (apiError && !/quota/i.test(apiError)) { /* clé restreinte : on tente le repli HTML */ }
  }
  const html = await fetchText(`https://www.youtube.com/playlist?list=${m[1]}`);
  const titles = [
    ...[...html.matchAll(/"lockupMetadataViewModel":\{"title":\{"content":"((?:[^"\\]|\\.)*)"/g)],
    ...[...html.matchAll(/"playlistVideoRenderer":\{.*?"title":\{"runs":\[\{"text":"((?:[^"\\]|\\.)*)"/g)],
  ].map((x) => { try { return JSON.parse(`"${x[1]}"`); } catch { return ""; } }).filter(propre);
  if (!titles.length) return { error: "Playlist YouTube illisible (privée, vide, ou lien invalide)." };
  return { titles: [...new Set(titles)] };
}

// Nettoie une description de vidéo : les liens, hashtags et blocs « réseaux sociaux »
// noient le LLM et lui font inventer des jeux à partir des URLs promotionnelles.
export function cleanDescription(txt) {
  return (txt || "")
    .split(/\r?\n/)
    .map((l) => l.replace(/https?:\/\/\S+/g, " ").replace(/\s{2,}/g, " ").trim())
    .filter((l) => l && !/^(?:twitter|x|facebook|instagram|discord|tiktok|twitch|reddit|patreon|merch|shop|abonne|subscribe|follow|suis[- ]moi|rejoins|music|musique|credits?|©|\d{4}\s|#\w+\s*$)/i.test(l))
    .join("\n")
    .slice(0, 6000);
}

// Une vidéo présente-t-elle PLUSIEURS jeux (Top 10, best of, sélection) ou un seul ?
// C'est la distinction qui manquait : on extrayait tous les jeux cités même pour un
// simple trailer, ce qui ramenait les jeux des liens promo de la description.
export function looksLikeMultiGameVideo(titre, description) {
  if (looksLikeListicle(titre)) return true;
  if (/\b(?:top|best|meilleurs?|selection|sélection|classement|list[e]?|round\s?-?up|monthly|weekly|mensuel|hebdo|nouveaut[ée]s|coming (?:out|soon)|showcase|direct|wrap[\s-]?up)\b/i.test(titre || "")) return true;
  // sommaire numéroté ou chapitrage horodaté dans la description : « 1. Jeu », « 03:12 Jeu »
  const lignes = (description || "").split(/\r?\n/);
  const numerotees = lignes.filter((l) => /^\s*(?:\d{1,2}\s*[).\-–:]|\d{1,2}:\d{2})\s+\S/.test(l)).length;
  if (numerotees >= 4) return true;
  // une description qui pointe 3 fiches Steam différentes présente forcément plusieurs jeux
  return steamAppIdsFrom(description).length >= 3;
}

// Endpoint interne du lecteur YouTube (celui qu'utilise le site lui-même) : renvoie un
// petit JSON avec titre + description complète, SANS clé API. C'est la source la plus
// fiable côté serveur — l'API officielle refuse une clé restreinte par référent, et la
// page /watch fait 2 Mo (lente, et parfois remplacée par un mur de consentement).
export async function youtubePlayerDetails(id) {
  const j = await fetch("https://www.youtube.com/youtubei/v1/player?prettyPrint=false", {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": BROWSER_UA },
    body: JSON.stringify({
      context: { client: { clientName: "WEB", clientVersion: "2.20240101.00.00", hl: "fr", gl: "CH" } },
      videoId: id,
    }),
  }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  const vd = j?.videoDetails;
  return vd?.title || vd?.shortDescription ? vd : null;
}

// Titre + description d'une vidéo, par ordre de fiabilité :
//  1. l'API officielle — mais une clé restreinte « par référent HTTP » est refusée côté
//     serveur (« Requests from referer <empty> are blocked ») : l'API renvoyait donc VIDE ;
//  2. la page /watch, où « shortDescription » est toujours présent (aucune clé requise) ;
//  3. oEmbed, qui ne donne que le titre.
// Sans le point 2, toute vidéo « Top 10 » se réduisait à son titre → aucun jeu détecté.
export async function youtubeMeta(url, env = {}) {
  const m = String(url || "").match(/(?:v=|youtu\.be\/|shorts\/|embed\/|live\/)([\w-]{11})/);
  if (!m) return { titre: "", description: "", error: "Lien YouTube invalide (identifiant de vidéo introuvable)." };
  const id = m[1];
  let titre = "", description = "", apiError = "";
  if (env.YOUTUBE_API_KEY) {
    const j = await youtubeApi(`https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${id}&key=${env.YOUTUBE_API_KEY}`, env);
    apiError = j?.error?.message || "";
    if (apiError) console.warn("[youtube] API refusée :", apiError, "— repli sur le lecteur interne.");
    const s = j.items?.[0]?.snippet;
    if (s) { titre = s.title || ""; description = s.description || ""; }
  }
  if (!description) {
    const vd = await youtubePlayerDetails(id);
    if (vd) { titre = titre || vd.title || ""; description = vd.shortDescription || ""; }
  }
  if (!description) {
    const html = await fetchText(`https://www.youtube.com/watch?v=${id}`);
    const d = html.match(/"shortDescription":"((?:[^"\\]|\\.)*)"/);
    if (d) { try { description = JSON.parse(`"${d[1]}"`); } catch { /* description illisible : on garde le titre */ } }
    if (!titre) titre = metaContent(html, "og:title") || "";
  }
  if (!titre) {
    const j = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`)
      .then((r) => (r.ok ? r.json() : null)).catch(() => null);
    titre = j?.title || "";
  }
  return { id, titre, description, apiError };
}

// Extrait les jeux d'UNE vidéo YouTube.
//  · vidéo « Top 10 / sélection »  → tous les jeux listés (titre + description, via LLM) ;
//  · vidéo sur un seul jeu         → le jeu du titre, sans toucher à la description ;
//  · sans clé API ou sans LLM      → repli sur le titre via oEmbed (marche toujours).
export async function youtubeVideoGames(url, env) {
  const meta = await youtubeMeta(url, env);
  if (meta.error) return { games: [], multi: false, error: meta.error };
  const { titre, description } = meta;
  if (!titre && !description) return { games: [], multi: false, error: "Vidéo YouTube illisible (privée, supprimée ou lien invalide)." };

  const multi = looksLikeMultiGameVideo(titre, description);
  const seul = cleanTitle(titre);
  if (!multi) return { games: seul ? [seul] : [], multi: false, titreVideo: titre };

  const games = await llmExtractGamesFromPost(
    { titre, texte: cleanDescription(description), source: "vidéo YouTube" }, env
  );
  if (games.length) return { games, multi: true, titreVideo: titre };
  // repli sans IA (ou IA muette) : les fiches Steam liées dans la description
  const liens = steamAppIdsFrom(description).map((id) => `https://store.steampowered.com/app/${id}`);
  if (liens.length) return { games: liens, multi: true, titreVideo: titre };
  // sur une sélection, surtout PAS de repli sur le titre : « Top 10 des jeux PS5 »
  // deviendrait un faux jeu. On explique plutôt pourquoi la vidéo n'a rien donné.
  return { games: [], multi: true, titreVideo: titre,
    error: `« ${titre.slice(0, 60)} » liste plusieurs jeux, mais sa description ne les nomme pas — les titres ne sont visibles que dans la vidéo. Copie-les à la main (un par ligne).` };
}

// Extrait les jeux d'UN post / reel Instagram.
// Instagram ne sert plus aucune métadonnée (og:*) aux robots non authentifiés : la page
// renvoyée est une coquille JavaScript. Sans jeton oEmbed officiel, il n'y a rien à lire —
// on le dit clairement plutôt que de renvoyer un titre vide ou un jeu au hasard.
export async function instagramGames(url, env) {
  const token = env.INSTAGRAM_OEMBED_TOKEN || (env.META_APP_ID && env.META_CLIENT_TOKEN ? `${env.META_APP_ID}|${env.META_CLIENT_TOKEN}` : "");
  let caption = "";
  if (token) {
    const u = `https://graph.facebook.com/v20.0/instagram_oembed?url=${encodeURIComponent(url)}&fields=title,author_name&access_token=${token}`;
    const j = await fetch(u).then((r) => r.json()).catch(() => null);
    caption = j?.title || "";
  }
  if (!caption) {
    // dernier essai : og:description (fonctionne encore sur de rares posts / miroirs)
    const html = await fetchText(url);
    caption = metaContent(html, "og:description") || metaContent(html, "og:title") || "";
    caption = caption.replace(/^[^:]*\s+on Instagram[:\s]*/i, "").trim();
  }
  if (!caption) {
    return { games: [], error: "Instagram ne laisse plus lire ses publications (légende inaccessible). Colle le TEXTE de la légende dans « Plusieurs » — tous les jeux cités seront détectés." };
  }
  const games = await llmExtractGamesFromPost({ titre: "", texte: caption, source: "publication Instagram" }, env);
  if (games.length) return { games, caption };
  // pas de LLM disponible : on retombe sur l'heuristique « nom du jeu : X »
  const gm = caption.match(/(?:nom du jeu|game name|it['’]s called|jeu\s*)\s*[:\-]\s*([^\n.#]{2,60})/i);
  const guess = gm ? gm[1].trim() : cleanTitle(caption.split(/[\n#]/)[0] || "");
  return { games: guess ? [guess] : [], caption };
}

// Détection « légère » pour la preview : résout le titre canonique (via Steam) sans tout enrichir.
export async function detectLight(input, env) {
  const det = await detectTitle(input, env);
  let titre = det.titre, appid = det.steamAppId || "", name = titre, image = "";
  if (titre && !appid) { const s = await steamSearch(titre); if (s) { appid = s.appid; name = s.name; } }
  if (appid) { const d = await steamDetails(appid); if (d) { name = d.steamName || name; image = d.header || ""; } }
  return {
    input, source: det.source,
    titre: (name || titre || "").trim(),
    steamAppId: appid, image, psnUrl: det.psnUrl || "",
  };
}

// Nom officiel à retenir pour un jeu enrichi : Steam puis IGDB, à condition qu'il
// corresponde vraiment à ce qui a été demandé (sinon on conserve le titre saisi).
function canonique(g, demande) {
  if (!g) return demande;
  const cands = [g.steamName, g.igdbName].filter(Boolean);
  cands.sort((a, b) => dice(demande, b) - dice(demande, a));
  const best = cands[0];
  return best && dice(demande, best) >= 0.5 ? best : (g.titre || demande);
}

// Analyse un lot d'entrées (texte multi-lignes + playlist) → jeux ENRICHIS complets (preview).
// Chaque jeu non-doublon est entièrement enrichi (genre, joueurs, note, prix, date, screenshots…).
export async function detectMany({ text = "", playlist = "", extract = false }, env, existingTitles = []) {
  // chaque entrée = { q: titre à résoudre, reel?: lien d'origine à conserver sur la fiche }
  const inputs = [];
  const notes = []; // messages à remonter quand une source n'a rien donné
  if (playlist) {
    const r = await youtubePlaylistTitles(playlist, env);
    if (r.error) return { error: r.error };
    inputs.push(...r.titles.map((q) => ({ q })));
  }
  if (text) {
    // extract = texte libre / document → on demande au LLM d'en extraire les titres
    if (extract) inputs.push(...(await llmExtractTitles(text, env)).map((q) => ({ q })));
    else {
      const prose = []; // lignes sans lien : regroupées pour une seule passe d'extraction
      let tronques = 0; // liens copiés depuis l'interface YouTube, coupés par « … »
      for (const line of text.split(/\r?\n/).map(s => s.trim()).filter(Boolean)) {
        // playlist YouTube (/playlist?list=…) → tous les titres de la playlist
        if (/youtube\.com\/playlist/.test(line) || (/[?&]list=/.test(line) && !/[?&]v=/.test(line) && /youtube\.com/.test(line))) {
          const r = await youtubePlaylistTitles(line, env);
          if (r.error) notes.push(r.error);
          inputs.push(...(r.titles ?? []).map((q) => ({ q, reel: line })));
        // vidéo YouTube → un seul jeu si c'est un trailer, tous les jeux si c'est une sélection
        } else if (/youtube\.com\/watch|youtu\.be\/|youtube\.com\/shorts|youtube\.com\/live\//.test(line)) {
          const r = await youtubeVideoGames(line, env).catch(() => ({ games: [] }));
          if (r.error) notes.push(r.error);
          if (/[?&]list=/.test(line)) notes.push("Ce lien appartient aussi à une playlist — pour importer TOUTE la playlist, colle son URL « /playlist?list=… ».");
          inputs.push(...r.games.map((q) => ({ q, reel: line })));
        } else if (/instagram\.com\//.test(line)) {
          const r = await instagramGames(line, env).catch(() => ({ games: [] }));
          if (r.error) notes.push(r.error);
          inputs.push(...r.games.map((q) => ({ q, reel: line })));
        } else if (isUrl(line)) {
          // « https://store.steampowered.com/app/43... » : lien tronqué à la copie, illisible.
          // Le titre est de toute façon sur la ligne d'à côté — on l'ignore en silence.
          if (/(?:\.{3}|…)\s*$/.test(line)) tronques++;
          else inputs.push({ q: line }); // lien Steam / PS Store / boutique
        } else prose.push(line);
      }
      // Lignes sans lien. Si ce sont TOUTES des titres propres, on les résout directement
      // (rapide, déterministe). Dès qu'une ligne est du texte, un horodatage ou une
      // annotation, c'est l'IA qui extrait les titres du bloc entier — sinon « 0:51 Rhythm
      // Heaven Groover » partait tel quel au moteur de recherche et ne matchait rien.
      if (prose.length) {
        if (prose.every(looksLikeCleanTitle)) inputs.push(...prose.map((q) => ({ q })));
        else if (hasLLM(env)) {
          const titres = await llmExtractTitles(prose.join("\n"), env);
          if (titres.length) inputs.push(...titres.map((q) => ({ q })));
          else notes.push("Aucun jeu reconnu dans le texte collé.");
        } else {
          inputs.push(...prose.filter(looksLikeCleanTitle).map((q) => ({ q })));
          notes.push("Sans clé IA (ANTHROPIC_API_KEY / OPENAI_API_KEY), seules les lignes qui sont déjà des titres exacts sont reconnues.");
        }
      }
      if (tronques && !inputs.length) notes.push(`${tronques} lien(s) tronqué(s) par la copie (« …app/43... ») : colle plutôt le lien de la vidéo, ou les titres.`);
    }
  }
  if (!inputs.length) return { error: notes[0] || "Aucun jeu trouvé (vérifie le lien / la vidéo)." };
  if (inputs.length > 40) inputs.length = 40; // garde-fou

  const seen = new Set(existingTitles.map(t => t.toLowerCase()));
  const out = [];
  const skipped = [];
  const CONC = 6; // une sélection « Top 30 » enrichit 30 jeux : sans parallélisme, c'est interminable
  for (let i = 0; i < inputs.length; i += CONC) {
    const batch = await Promise.all(inputs.slice(i, i + CONC).map(async (item) => {
      const inp = item.q;
      // écarte les listicles (Top 10, 15 Best Games…) : ce ne sont pas des jeux
      if (looksLikeListicle(inp)) return { skip: inp };
      const d = await detectLight(inp, env).catch(() => null);
      if (!d || !d.titre) return { skip: inp };
      if (looksLikeListicle(d.titre)) return { skip: inp };
      const key = d.titre.toLowerCase();
      if (seen.has(key)) return { ...d, duplicate: true };
      const reel = item.reel || (d.source === "instagram" || d.source === "youtube" ? d.input : "");
      const enriched = await enrichGame(
        { titre: d.titre, steamAppId: d.steamAppId, psnUrl: d.psnUrl, reel },
        env
      ).catch(() => null);
      // on valide sur le nom OFFICIEL renvoyé par Steam/IGDB, pas sur la saisie :
      // « Hadees II » matche Hades II sur IGDB — il faut l'enregistrer sous son vrai nom,
      // et rejeter le match si les deux noms n'ont rien à voir.
      const canon = canonique(enriched, d.titre);
      const good = enriched && (enriched.steamAppId || enriched.igdbId) && dice(d.titre, canon) >= 0.34;
      if (good) {
        const g = { ...enriched, titre: canon, input: d.input, source: d.source, duplicate: seen.has(canon.toLowerCase()) };
        if (canon.toLowerCase() !== d.titre.toLowerCase() && dice(inp, canon) < 0.98) g.corrected = inp;
        return g;
      }
      // aucun match fiable : dernier recours = correction du titre via LLM, puis nouvelle tentative
      if (d.source === "texte" && hasLLM(env)) {
        const fixed = await llmCorrectTitle(inp, env);
        if (fixed && fixed.toLowerCase() !== inp.toLowerCase()) {
          const e2 = await enrichGame({ titre: fixed, reel }, env).catch(() => null);
          if (e2 && (e2.steamAppId || e2.igdbId)) {
            const c2 = canonique(e2, fixed);
            if (seen.has(c2.toLowerCase())) return { ...e2, titre: c2, duplicate: true };
            return { ...e2, titre: c2, input: d.input, source: d.source, duplicate: false, corrected: inp };
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
  return { games: out, skipped, notes };
}

// Moteur de découverte IGDB : filtre par plateforme / genre / mode / coop local / joueurs / note.
// criteria = { platforms:[ids], genres:[ids], modes:[ids], coopLocal:bool, playersMin:int, noteMin:int, sinceYear:int, sort:"pop"|"note"|"recent" }
export async function igdbDiscover(criteria, env, limit = 30) {
  const c = criteria || {};
  const w = ["game_type = 0", "parent_game = null", "version_parent = null"]; // jeux principaux (pas DLC/éditions)
  const ids = (a) => (Array.isArray(a) ? a.filter((x) => Number.isFinite(+x)).map(Number) : []);
  const plats = ids(c.platforms), genres = ids(c.genres), modes = ids(c.modes), themes = ids(c.themes);
  // plusieurs machines = « l'une OU l'autre » : côté IGDB, « platforms = (167,48) » se
  // lit comme un ET et ne remonterait que les jeux sortis sur les deux à la fois.
  if (plats.length === 1) w.push(`platforms = (${plats[0]})`);
  else if (plats.length) w.push(`(${plats.map((p) => `platforms = (${p})`).join(" | ")})`);
  // une famille de jeux (« Horreur », « Survie ») se lit tantôt dans les genres,
  // tantôt dans les thèmes IGDB : on accepte l'un OU l'autre.
  if (genres.length && themes.length) w.push(`(genres = (${genres.join(",")}) | themes = (${themes.join(",")}))`);
  else if (genres.length) w.push(`genres = (${genres.join(",")})`);
  else if (themes.length) w.push(`themes = (${themes.join(",")})`);
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

// ─── point d'entrée unique ─────────────────────────────────────────────
// Un seul champ pour tout : lien YouTube (trailer ou « Top 10 »), playlist, lien Steam /
// PS Store / Instagram / n'importe quelle boutique, un titre tapé, une liste de titres
// (un par ligne), ou un paragraphe entier. On choisit ici la bonne stratégie :
//  · un titre seul       → plusieurs candidats à cocher (God of War 1 / 2 / 3…) ;
//  · tout le reste       → détection + enrichissement de chaque jeu trouvé.
export async function detectAnything(input, env, existingTitles = []) {
  const raw = String(input || "").trim();
  if (!raw) return { games: [], skipped: [], notes: [], mode: "vide" };

  const lignes = raw.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  // un seul titre tapé (ni lien, ni phrase) → on propose les candidats à choisir
  if (lignes.length === 1 && looksLikeCleanTitle(lignes[0])) {
    const r = await detectCandidates(lignes[0], env, existingTitles);
    if (r.games.length) return { games: r.games, skipped: [], notes: [], mode: "candidats" };
    // aucun candidat : on retente en passant par la détection générale (typos, titres exotiques)
  }
  const res = await detectMany({ text: raw }, env, existingTitles);
  if (res.error) return { games: [], skipped: [], notes: [res.error], mode: "erreur" };
  return { games: res.games, skipped: res.skipped ?? [], notes: res.notes ?? [], mode: "liste" };
}
