/**
 * Restauration depuis une sauvegarde JSON prise AVANT le passage au catalogue.
 *
 * La sauvegarde contient les lignes de l'ancien modèle (un jeu PAR liste, colonne listId).
 * Ce script les verse directement dans le NOUVEAU modèle : catalogue dédoublonné (game.cle)
 * + appartenances (list_item). Même règle de fusion que migrate-catalogue.mjs — on garde
 * la fiche la plus complète de chaque groupe de doublons.
 *
 * Usage : node prisma/restore-backup.mjs <fichier.json> [--go]   (sans --go : simulation)
 */
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";

for (const f of [".env.local", ".env"]) {
  try {
    for (const line of readFileSync(new URL(`../${f}`, import.meta.url), "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z_0-9]+)\s*=\s*(.*)\s*$/);
      if (m) process.env[m[1]] ??= m[2].trim().replace(/^["']|["']$/g, "");
    }
  } catch { /* absent : variables déjà dans l'environnement */ }
}

const fichier = process.argv[2];
const GO = process.argv.includes("--go");
if (!fichier) { console.error("Usage : node prisma/restore-backup.mjs <fichier.json> [--go]"); process.exit(1); }

const prisma = new PrismaClient({ datasources: { db: { url: process.env.POSTGRES_URL } } });

function cleDe(titre) {
  return (titre || "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[™®©]/g, "")
    .replace(/[^a-z0-9]+/g, " ").trim() || "sans-titre";
}
function score(g) {
  const champs = [g.igdbId, g.steamAppId, g.image, g.genre, g.univers, g.sortieISO, g.note, g.metacritic,
    g.prix, g.prixSteam, g.modes, g.modesDetail, g.nbJoueurs, g.developpeur, g.editeur, g.description,
    g.dureeVie, g.envergure, g.urlSteam, g.urlPsn, g.trailer, g.trailerYoutube, g.reel];
  let n = champs.filter((v) => v != null && v !== "").length;
  n += (g.screenshots?.length ?? 0) > 0 ? 2 : 0;
  n += (g.plateformes?.length ?? 0) > 0 ? 1 : 0;
  return n;
}

const sauvegarde = JSON.parse(readFileSync(fichier, "utf8"));
const { lists = [], games = [], users = [] } = sauvegarde;

// regroupe les lignes par identité de jeu
const groupes = new Map();
for (const g of games) {
  const k = cleDe(g.titre);
  if (!groupes.has(k)) groupes.set(k, []);
  groupes.get(k).push(g);
}
const fiches = [];
const appartenances = [];
for (const [cle, grp] of groupes) {
  const garde = grp.slice().sort((a, b) => score(b) - score(a))[0];
  fiches.push({ cle, row: garde });
  for (const g of grp) appartenances.push({ listId: g.listId, gameId: garde.id });
}
const uniques = [...new Map(appartenances.map((a) => [`${a.listId}|${a.gameId}`, a])).values()];

console.log(`Sauvegarde du ${sauvegarde.pris}`);
console.log(`  ${users.length} compte(s) · ${lists.length} listes · ${games.length} lignes de jeux`);
console.log(`  → ${fiches.length} fiches au catalogue · ${uniques.length} appartenances`);

const etat = async () => ({
  jeux: await prisma.game.count(), listes: await prisma.list.count(),
  items: await prisma.listItem.count(), users: await prisma.user.count(),
});

if (!GO) {
  console.log("\nBase actuellement :", await etat());
  console.log("(simulation — relance avec --go pour écrire)");
  await prisma.$disconnect();
  process.exit(0);
}

const avant = await etat();
if (avant.jeux || avant.listes) {
  console.error(`\n❌ La base n'est pas vide (${avant.jeux} jeux, ${avant.listes} listes).`);
  console.error("   Refus d'écrire par-dessus des données existantes — vide-la d'abord si c'est voulu.");
  await prisma.$disconnect();
  process.exit(1);
}

console.log("\n1/4 · comptes…");
for (const u of users) {
  await prisma.user.upsert({
    where: { id: u.id },
    create: { id: u.id, name: u.name || u.email, email: u.email, steamId: u.steamId ?? null },
    update: {},
  });
}

console.log("2/4 · listes…");
for (const l of lists) {
  await prisma.list.upsert({
    where: { id: l.id },
    create: {
      id: l.id, name: l.name, slug: l.slug, description: l.description ?? null,
      isPublic: l.isPublic ?? true, ownerId: l.ownerId ?? null,
      filtre: l.filtre ?? null, createdAt: l.createdAt ? new Date(l.createdAt) : undefined,
    },
    update: {},
  });
}

console.log("3/4 · fiches de jeux…");
let n = 0;
for (const { cle, row } of fiches) {
  // on écarte ce qui n'existe plus dans le nouveau modèle, ou que Prisma gère seul
  const { listId, createdAt, updatedAt, ...champs } = row;
  await prisma.game.upsert({
    where: { cle },
    create: { ...champs, cle, createdAt: createdAt ? new Date(createdAt) : undefined },
    update: {},
  });
  if (++n % 100 === 0) console.log(`   ${n}/${fiches.length}`);
}

console.log("4/4 · appartenances…");
for (let i = 0; i < uniques.length; i += 200) {
  await prisma.listItem.createMany({ data: uniques.slice(i, i + 200), skipDuplicates: true });
}

console.log("\n✅ Restauré :", await etat());
await prisma.$disconnect();
