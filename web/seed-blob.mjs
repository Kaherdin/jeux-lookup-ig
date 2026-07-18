#!/usr/bin/env node
/**
 * seed-blob.mjs — pousse la collection locale dans Vercel Blob (une fois).
 *
 *   1) crée un Blob store sur Vercel + connecte-le au projet (dashboard),
 *      ou récupère un token : `vercel blob store add` / Storage → Blob.
 *   2) mets BLOB_READ_WRITE_TOKEN dans web/.env.local
 *   3) node seed-blob.mjs
 *
 * Lit web/data/games.json (ou ../jeux-enrichi.json) et écrit la clé "games.json".
 */
import { readFileSync, existsSync } from "node:fs";

// charge .env.local
for (const f of [".env.local", ".env"]) {
  if (existsSync(f)) for (const line of readFileSync(f, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
    if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, "");
  }
}
// token Blob (préfixé par le nom du store : BLOB_/BLOG_/…_READ_WRITE_TOKEN)
const token = process.env.BLOB_READ_WRITE_TOKEN
  || Object.entries(process.env).find(([k, v]) => /READ_WRITE_TOKEN$/.test(k) && v)?.[1];
if (!token) {
  console.error("✗ Aucun token *_READ_WRITE_TOKEN. Ajoute-le dans web/.env.local (Vercel → Storage → ton Blob → tokens).");
  process.exit(1);
}
const src = existsSync("data/games.json") ? "data/games.json" : "../jeux-enrichi.json";
const games = JSON.parse(readFileSync(src, "utf8"));
const { put } = await import("@vercel/blob");
const res = await put("games.json", JSON.stringify(games), {
  access: "public", allowOverwrite: true, addRandomSuffix: false,
  contentType: "application/json", cacheControlMaxAge: 0, token,
});
console.log(`✅ ${games.length} jeux poussés dans le Blob → ${res.url}`);
