/**
 * Ménage : on ne garde que les listes voulues, et on transforme les anciennes
 * listes-bibliothèques (PSN / Steam) en POSSESSIONS.
 *
 * Posséder un jeu n'est pas une liste : c'est un fait, attaché à un utilisateur.
 * Supprimer la liste sans convertir ferait perdre le marqueur « je l'ai déjà ».
 *
 * Supprimer une liste ne supprime QUE ses appartenances (cascade sur list_item) :
 * les fiches du catalogue restent, elles n'ont jamais appartenu à personne.
 *
 * Usage : node prisma/menage-listes.mjs [--go]
 */
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";

for (const f of [".env.local", ".env"]) {
  try {
    for (const line of readFileSync(new URL(`../${f}`, import.meta.url), "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z_0-9]+)\s*=\s*(.*)\s*$/);
      if (m) process.env[m[1]] ??= m[2].trim().replace(/^["']|["']$/g, "");
    }
  } catch { /* absent */ }
}

const GO = process.argv.includes("--go");
const prisma = new PrismaClient({ datasources: { db: { url: process.env.POSTGRES_URL } } });

const A_GARDER = ["adventure-coop", "fun-coop", "solo-short"];

const lists = await prisma.list.findMany({ include: { _count: { select: { items: true } } }, orderBy: { createdAt: "asc" } });
// Une bibliothèque est une liste GÉNÉRÉE par un import : son slug est exactement
// `ps-<8 premiers caractères de l'id du propriétaire>` (idem `steam-`). Un simple
// préfixe ne suffit pas — « ps-4-joueurs-local » est une liste thématique, pas une
// bibliothèque, et la convertir marquerait 271 jeux comme possédés à tort.
const slugBiblio = (l) => {
  if (!l.ownerId) return null;
  const k = l.ownerId.slice(0, 8).toLowerCase();
  if (l.slug === `ps-${k}`) return "psn";
  if (l.slug === `steam-${k}`) return "steam";
  return null;
};
const bibliotheques = lists.filter((l) => slugBiblio(l));
const aSupprimer = lists.filter((l) => !A_GARDER.includes(l.slug));

console.log("À GARDER :");
for (const l of lists.filter((l) => A_GARDER.includes(l.slug))) console.log(`  ✔ ${l.slug.padEnd(20)} ${l._count.items} jeux`);

console.log("\nÀ CONVERTIR EN POSSESSIONS (avant suppression) :");
for (const l of bibliotheques) {
  console.log(`  → ${l.slug.padEnd(20)} ${l._count.items} jeux · source ${slugBiblio(l)}`);
}
if (!bibliotheques.length) console.log("  (aucune)");

console.log("\nÀ SUPPRIMER :");
for (const l of aSupprimer) console.log(`  ✘ ${l.slug.padEnd(20)} ${l._count.items} appartenances (les fiches restent au catalogue)`);

const jeuxAvant = await prisma.game.count();
console.log(`\nCatalogue : ${jeuxAvant} jeux — inchangé par l'opération.`);

if (!GO) {
  console.log("\n(simulation — relance avec --go pour appliquer)");
  await prisma.$disconnect();
  process.exit(0);
}

console.log("\n1/3 · conversion des bibliothèques en possessions…");
let n = 0;
for (const l of bibliotheques) {
  const source = slugBiblio(l);
  const items = await prisma.listItem.findMany({ where: { listId: l.id }, select: { gameId: true } });
  for (const it of items) {
    const existant = await prisma.ownership.findUnique({
      where: { userId_gameId: { userId: l.ownerId, gameId: it.gameId } },
    });
    const sources = [...new Set([...(existant?.sources ?? []), source])];
    await prisma.ownership.upsert({
      where: { userId_gameId: { userId: l.ownerId, gameId: it.gameId } },
      create: { userId: l.ownerId, gameId: it.gameId, sources },
      update: { sources },
    });
    n++;
  }
  console.log(`   ${l.slug} → ${items.length} possessions`);
}
console.log(`   ${n} au total`);

console.log("2/3 · suppression des listes…");
for (const l of aSupprimer) {
  await prisma.list.delete({ where: { id: l.id } });
  console.log(`   ✘ ${l.slug}`);
}

console.log("3/3 · vérification…");
const jeuxApres = await prisma.game.count();
const restantes = await prisma.list.findMany({ include: { _count: { select: { items: true } } } });
console.log(`   catalogue : ${jeuxAvant} → ${jeuxApres} ${jeuxAvant === jeuxApres ? "✓ intact" : "❌ ÉCART"}`);
console.log(`   possessions : ${await prisma.ownership.count()}`);
console.log(`   listes restantes : ${restantes.map((l) => `${l.slug} (${l._count.items})`).join(", ")}`);

await prisma.$disconnect();
