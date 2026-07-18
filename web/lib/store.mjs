/**
 * store.mjs — persistance dual-mode.
 *  - En prod Vercel : lit/écrit Vercel Blob (token auto-détecté).
 *  - En local (pas de token) : lit/écrit data/games.json.
 * data/games.json (commité) sert de « seed » : le site fonctionne même sans Blob.
 *
 * Le token Blob est préfixé par le nom du store (ex. store « blog » → BLOG_READ_WRITE_TOKEN).
 * On détecte donc automatiquement toute variable finissant par READ_WRITE_TOKEN.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const SEED = path.join(process.cwd(), "data", "games.json");
const BLOB_KEY = "games.json";

export function blobToken() {
  if (process.env.BLOB_READ_WRITE_TOKEN) return process.env.BLOB_READ_WRITE_TOKEN;
  const found = Object.entries(process.env).find(([k, v]) => /READ_WRITE_TOKEN$/.test(k) && v);
  return found ? found[1] : null;
}

export function readSeed() {
  try { return JSON.parse(readFileSync(SEED, "utf8")); } catch { return []; }
}

export async function readGames() {
  const token = blobToken();
  if (token) {
    try {
      const { list } = await import("@vercel/blob");
      const { blobs } = await list({ prefix: BLOB_KEY, limit: 1, token });
      if (blobs?.[0]?.url) {
        const r = await fetch(blobs[0].url, { cache: "no-store" });
        if (r.ok) return await r.json();
      }
    } catch (e) { console.error("[store] blob read:", e?.message || e); }
    // Blob vide (avant 1re écriture) → seed commité
    return readSeed();
  }
  return readSeed();
}

export async function writeGames(games) {
  const token = blobToken();
  if (token) {
    const { put } = await import("@vercel/blob");
    await put(BLOB_KEY, JSON.stringify(games), {
      access: "public", allowOverwrite: true, addRandomSuffix: false,
      contentType: "application/json", cacheControlMaxAge: 0, token,
    });
    return { store: "blob", count: games.length };
  }
  writeFileSync(SEED, JSON.stringify(games, null, 2));
  return { store: "file", count: games.length };
}
