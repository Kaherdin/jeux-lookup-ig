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
export async function steamSearch(title) {
  const u = `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(title)}&l=${LANG}&cc=${COUNTRY}`;
  const j = await fetch(u).then(r => r.json()).catch(() => ({}));
  const it = j.items?.[0];
  return it ? { appid: String(it.id), name: it.name } : null;
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
    header: d.header_image || "",
    solo: H(2),
    coop, pvp,
    multi: H(1) || H(20) || coop || pvp,
    detail,
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
export async function igdbLookup(title, env) {
  const tok = await igdbAuth(env); if (!tok) return null;
  const body = `search "${title.replace(/"/g, '')}"; fields name,first_release_date,aggregated_rating,total_rating,total_rating_count,platforms.abbreviation,genres.name,url,game_modes.slug; limit 1;`;
  const j = await fetch("https://api.igdb.com/v4/games", {
    method: "POST",
    headers: { "Client-ID": env.TWITCH_ID, Authorization: `Bearer ${tok}`, "Content-Type": "text/plain" },
    body,
  }).then(r => r.json()).catch(() => []);
  const g = Array.isArray(j) ? j[0] : null; if (!g) return null;
  const modes = (g.game_modes || []).map(m => m.slug);
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
    url: g.url,
  };
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
  const igdbP = igdbLookup(title, env);
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

  // nb de joueurs max (pour le tri)
  const nbJoueurs = parseJoueurs(rec.legende) || rec.nbJoueurs || "";
  const mJ = nbJoueurs.match(/(\d+)\s*$/) || nbJoueurs.match(/(\d+)/);
  const nbJoueursMax = mJ ? +mJ[1] : null;

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
    univers: rec.univers || "",
    plateformes: igdb?.plateformes?.length ? igdb.plateformes : (rec.plateforme ? [rec.plateforme] : []),
    gratuitCsv: (rec.gratuitCsv || "").trim(),
    image: steam?.header || "",
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

// Analyse un lot d'entrées (texte multi-lignes + playlist) → liste de détections légères.
export async function detectMany({ text = "", playlist = "" }, env, existingTitles = []) {
  const inputs = [];
  if (playlist) {
    const r = await youtubePlaylistTitles(playlist, env);
    if (r.error) return { error: r.error };
    inputs.push(...r.titles);
  }
  if (text) inputs.push(...text.split(/\r?\n/).map(s => s.trim()).filter(Boolean));
  if (!inputs.length) return { error: "Rien à analyser." };

  const seen = new Set(existingTitles.map(t => t.toLowerCase()));
  const out = [];
  // concurrence limitée pour ne pas se faire rate-limiter
  const CONC = 4;
  for (let i = 0; i < inputs.length; i += CONC) {
    const batch = await Promise.all(inputs.slice(i, i + CONC).map(inp => detectLight(inp, env).catch(() => null)));
    for (const d of batch) {
      if (!d || !d.titre) continue;
      const key = d.titre.toLowerCase();
      d.duplicate = seen.has(key);
      if (!d.duplicate) seen.add(key);
      out.push(d);
    }
  }
  return { games: out };
}
