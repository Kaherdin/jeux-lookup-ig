/**
 * Reconstruit `_prisma_migrations` en déclarant les migrations du dossier comme déjà
 * appliquées — l'équivalent de `prisma migrate resolve --applied <nom>` pour chacune.
 *
 * Pourquoi : la reprise après sinistre du 2026-08-21 a recréé le schéma sans cette
 * table. Prisma voyait donc une base pleine sans historique et refusait tout
 * déploiement avec P3005 (« The database schema is not empty »), ce qui faisait
 * échouer le build Vercel — donc plus aucune mise en ligne.
 *
 * Ce script n'écrit QUE dans la table de suivi : aucune table métier, aucune colonne,
 * aucune ligne de données n'est touchée. Il est idempotent.
 *
 * Usage : node prisma/baseline-migrations.mjs [--go]   (sans --go : montre le plan)
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
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

const dossier = new URL("./migrations/", import.meta.url);
const migrations = readdirSync(dossier, { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(new URL(`./${d.name}/migration.sql`, dossier)))
  .map((d) => d.name)
  .sort();

// Prisma identifie une migration par le SHA-256 de son fichier SQL : un checksum inventé
// ferait crier « migration file has been modified » au prochain déploiement.
const checksum = (nom) =>
  createHash("sha256").update(readFileSync(new URL(`./${nom}/migration.sql`, dossier))).digest("hex");

console.log(`${migrations.length} migrations dans le dossier :`);
for (const m of migrations) console.log(`  ${m}  ${checksum(m).slice(0, 12)}…`);

if (!GO) { console.log("\nRien n'a été écrit. Relance avec --go."); await prisma.$disconnect(); process.exit(0); }

await prisma.$executeRawUnsafe(`
  CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
    "id"                  VARCHAR(36)  PRIMARY KEY NOT NULL,
    "checksum"            VARCHAR(64)  NOT NULL,
    "finished_at"         TIMESTAMPTZ,
    "migration_name"      VARCHAR(255) NOT NULL,
    "logs"                TEXT,
    "rolled_back_at"      TIMESTAMPTZ,
    "started_at"          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    "applied_steps_count" INTEGER      NOT NULL DEFAULT 0
  );`);

let ajoutees = 0, deja = 0;
for (const nom of migrations) {
  const [{ n }] = await prisma.$queryRawUnsafe(
    `SELECT count(*)::int AS n FROM "_prisma_migrations" WHERE migration_name = $1;`, nom);
  if (n > 0) { deja++; continue; }
  await prisma.$executeRawUnsafe(
    `INSERT INTO "_prisma_migrations" (id, checksum, finished_at, migration_name, started_at, applied_steps_count)
     VALUES ($1, $2, now(), $3, now(), 1);`,
    randomUUID(), checksum(nom), nom);
  ajoutees++;
}

const etat = await prisma.$queryRawUnsafe(
  `SELECT migration_name, finished_at FROM "_prisma_migrations" ORDER BY started_at;`);
console.log(`\n${ajoutees} déclarée(s) appliquée(s), ${deja} déjà présente(s).`);
for (const m of etat) console.log(`  ✓ ${m.migration_name}`);
await prisma.$disconnect();
