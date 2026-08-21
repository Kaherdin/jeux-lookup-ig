import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import { toRow } from "../lib/game-row.mjs";
import { upsertGames } from "./catalogue.mjs";

const prisma = new PrismaClient({ datasources: { db: { url: process.env.POSTGRES_URL } } });

const src = fileURLToPath(new URL("../../jeux-enrichi.json", import.meta.url));
const games = JSON.parse(readFileSync(src, "utf8"));

const list = await prisma.list.upsert({
  where: { slug: "decouvertes" },
  update: {},
  create: {
    name: "Découvertes",
    slug: "decouvertes",
    description: "Jeux repérés au fil de l'eau, enrichis via Steam / IGDB / ITAD.",
    isPublic: true,
  },
});

const { fiches, nouvelles } = await upsertGames(prisma, list.id, games);
const res = { count: nouvelles };
console.log(`   ${fiches} fiches au catalogue, ${nouvelles} nouvelles dans la liste.`);

console.log(`✅ Liste "${list.name}" (${list.slug}) · ${res.count} jeux insérés.`);
await prisma.$disconnect();
process.exit(0);
