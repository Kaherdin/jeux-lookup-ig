#!/usr/bin/env node
/**
 * Construit index.html AUTONOME (données embarquées) depuis jeux-enrichi.json.
 *   node build-viewer.mjs
 * Ouvrable au double-clic. Le formulaire d'ajout y est présent mais nécessite
 * le serveur (node server.mjs) pour enrichir en direct.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const SRC = "jeux-enrichi.json", TPL = "viewer-template.html";
if (!existsSync(SRC)) { console.error(`✗ ${SRC} introuvable — lance d'abord: node enrich.mjs`); process.exit(1); }
const data = JSON.parse(readFileSync(SRC, "utf8"));
const gen = new Date().toISOString().slice(0, 16).replace("T", " ");
const html = readFileSync(TPL, "utf8")
  .replace("__DATA__", JSON.stringify(data))
  .replace("__GEN__", gen)
  .replace("__API__", "false");
writeFileSync("index.html", html);
console.log(`✅ index.html généré (${data.length} jeux) — ouvrable au double-clic.`);
