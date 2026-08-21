/**
 * Crée une COPIE en mode filtre de chaque liste triée à la main.
 * Les originales ne sont pas touchées : on compare, puis on décide.
 *
 * Usage : node prisma/copies-filtres.mjs [--go]
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

// critères déduits du contenu réel de chaque liste (voir l'analyse : ce que le filtre
// retrouve de tes choix, et ce qu'il ramène en plus)
const COPIES = [
  {
    source: "adventure-coop", slug: "aventure-coop-filtre", name: "🗺️ Aventure coop (filtre)",
    filtre: "f=coop&c=aventure",
    description: "Vue enregistrée : tous les jeux coop de la famille Aventure. Se met à jour toute seule.",
  },
  {
    source: "fun-coop", slug: "fun-coop-filtre", name: "🎉 Fun coop (filtre)",
    filtre: "f=coop&c=fun",
    description: "Vue enregistrée : tous les jeux coop de la famille Fun / Party. Se met à jour toute seule.",
  },
  {
    source: "solo-short", slug: "solo-court-filtre", name: "🎯 Solo court (filtre)",
    filtre: "f=solo&d=0-6",
    description: "Vue enregistrée : jeux solo qui se terminent en 6 heures ou moins.",
  },
];

for (const c of COPIES) {
  const src = await prisma.list.findUnique({ where: { slug: c.source } });
  const deja = await prisma.list.findUnique({ where: { slug: c.slug } });
  console.log(`${c.source} → ${c.slug}  (${c.filtre})${deja ? "  [existe déjà]" : ""}${src ? "" : "  [source absente]"}`);
}

if (!GO) {
  console.log("\n(simulation — relance avec --go pour créer)");
  await prisma.$disconnect();
  process.exit(0);
}

console.log("");
for (const c of COPIES) {
  const src = await prisma.list.findUnique({ where: { slug: c.source } });
  const list = await prisma.list.upsert({
    where: { slug: c.slug },
    create: {
      slug: c.slug, name: c.name, description: c.description,
      filtre: c.filtre, isPublic: true, ownerId: src?.ownerId ?? null,
    },
    update: { name: c.name, description: c.description, filtre: c.filtre },
  });
  console.log(`  ✔ ${list.slug} créée — /l/${list.slug}`);
}

const toutes = await prisma.list.findMany({ include: { _count: { select: { items: true } } }, orderBy: { createdAt: "asc" } });
console.log("\nListes :");
for (const l of toutes) {
  console.log(`  ${l.slug.padEnd(22)} ${l.filtre ? `filtre → ${l.filtre}` : `${l._count.items} jeux épinglés`}`);
}
await prisma.$disconnect();
