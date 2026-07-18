#!/usr/bin/env node
/**
 * server.mjs — v1 : sert l'UI + API d'ajout à la volée. Node 18+, zéro dépendance.
 *
 *   node server.mjs           → http://localhost:8787
 *
 * Routes :
 *   GET  /                 UI (données injectées, formulaire actif)
 *   GET  /api/games        liste JSON courante
 *   POST /api/add {input}  détecte le titre, enrichit, persiste, renvoie la liste
 *
 * Persistance : jeux-enrichi.json (+ .csv) et enrich-cache.json.
 */
import { createServer } from "node:http";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { loadEnv, detectTitle, enrichGame, toCSV } from "./lib.mjs";
import { flatten } from "./enrich.mjs";

const PORT = process.env.PORT || 8787;
const TPL = "viewer-template.html";
const JSON_FILE = "jeux-enrichi.json", CSV_FILE = "jeux-enrichi.csv", CACHE = "enrich-cache.json";
const env = loadEnv();

let games = existsSync(JSON_FILE) ? JSON.parse(readFileSync(JSON_FILE, "utf8")) : [];
const cache = existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, "utf8")) : {};

function persist() {
  writeFileSync(JSON_FILE, JSON.stringify(games, null, 2));
  if (games.length) writeFileSync(CSV_FILE, toCSV(flatten(games)));
  writeFileSync(CACHE, JSON.stringify(cache));
}
const send = (res, code, body, type = "application/json") =>
  res.writeHead(code, { "Content-Type": type, "Access-Control-Allow-Origin": "*" }).end(body);

function pageHTML() {
  const gen = new Date().toISOString().slice(0, 16).replace("T", " ");
  return readFileSync(TPL, "utf8")
    .replace("__DATA__", JSON.stringify(games))
    .replace("__GEN__", gen)
    .replace("__API__", "true");
}

async function handleAdd(input) {
  const det = await detectTitle(input);
  if (!det.titre) return { error: "Impossible de détecter un titre. Tape le nom du jeu directement." };

  const exists = games.find(g => g.titre.toLowerCase() === det.titre.toLowerCase());
  if (exists) return { duplicate: true, game: exists, source: det.source, games };

  const g = await enrichGame({
    titre: det.titre, steamAppId: det.steamAppId,
    reel: det.source === "instagram" || det.source === "youtube" ? input : "",
    ajouteLe: new Date().toISOString().slice(0, 10),
  }, env);

  // titre non résolu côté Steam/IGDB → on garde quand même l'entrée manuelle
  games.unshift(g);
  cache[g.titre] = g;
  persist();
  return { game: g, source: det.source, rawTitle: det.rawTitle || "", games };
}

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    if (req.method === "GET" && url.pathname === "/")
      return send(res, 200, pageHTML(), "text/html; charset=utf-8");
    if (req.method === "GET" && url.pathname === "/api/games")
      return send(res, 200, JSON.stringify(games));
    if (req.method === "POST" && url.pathname === "/api/add") {
      let body = ""; for await (const c of req) body += c;
      const { input } = JSON.parse(body || "{}");
      if (!input || !input.trim()) return send(res, 400, JSON.stringify({ error: "Entrée vide" }));
      const result = await handleAdd(input.trim());
      return send(res, result.error ? 422 : 200, JSON.stringify(result));
    }
    send(res, 404, JSON.stringify({ error: "Not found" }));
  } catch (e) {
    send(res, 500, JSON.stringify({ error: String(e.message || e) }));
  }
}).listen(PORT, () => {
  console.log(`🎮 Game Backlog — http://localhost:${PORT}`);
  console.log(`   ${games.length} jeux · IGDB:${env.TWITCH_ID ? "on" : "off"} ITAD:${env.ITAD_KEY ? "on" : "off"}`);
});
