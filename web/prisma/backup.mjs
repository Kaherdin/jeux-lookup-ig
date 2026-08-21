/**
 * Sauvegarde complète de la base applicative dans un fichier JSON.
 * À lancer AVANT toute opération qui écrit en masse (migration, ménage, import).
 *
 * Capture le catalogue, les listes, LES APPARTENANCES (sans elles une restauration
 * rendrait des jeux orphelins), les possessions et les comptes.
 * La table `account` (mots de passe) n'est PAS incluse : voir prisma/set-password.mjs
 * pour rendre l'accès à un compte après restauration.
 *
 * Usage : node prisma/backup.mjs [fichier.json]
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { PrismaClient } from "@prisma/client";

for (const f of [".env.local", ".env"]) {
  try {
    for (const line of readFileSync(new URL(`../${f}`, import.meta.url), "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z_0-9]+)\s*=\s*(.*)\s*$/);
      if (m) process.env[m[1]] ??= m[2].trim().replace(/^["']|["']$/g, "");
    }
  } catch { /* absent */ }
}

const prisma = new PrismaClient({ datasources: { db: { url: process.env.POSTGRES_URL } } });

const horodatage = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const sortie = process.argv[2] || new URL(`../../backups/backup-${horodatage}.json`, import.meta.url).pathname.replace(/^\//, "");

const lireOptionnel = async (fn) => { try { return await fn(); } catch { return []; } };

const [lists, games, listItems, users, ownerships] = await Promise.all([
  prisma.list.findMany(),
  prisma.game.findMany(),
  lireOptionnel(() => prisma.listItem.findMany()),
  prisma.user.findMany({ select: { id: true, email: true, name: true, steamId: true } }),
  lireOptionnel(() => prisma.ownership.findMany()),
]);

try { mkdirSync(new URL("../../backups/", import.meta.url), { recursive: true }); } catch { /* existe déjà */ }
writeFileSync(sortie, JSON.stringify({ pris: new Date().toISOString(), lists, games, listItems, users, ownerships }, null, 1), "utf8");

console.log(`✅ ${lists.length} listes · ${games.length} jeux · ${listItems.length} appartenances · ${ownerships.length} possessions · ${users.length} compte(s)`);
console.log(`   → ${sortie}`);
await prisma.$disconnect();
