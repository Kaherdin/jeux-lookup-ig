import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import { toRow } from "../lib/game-row.mjs";

const prisma = new PrismaClient({ datasources: { db: { url: process.env.POSTGRES_URL } } });

const src = fileURLToPath(new URL("../../jeux-enrichi.json", import.meta.url));
const games = JSON.parse(readFileSync(src, "utf8"));

const list = await prisma.list.upsert({
  where: { slug: "decouvertes" },
  update: {},
  create: {
    name: "Découvertes Instagram",
    slug: "decouvertes",
    description: "Jeux repérés sur Instagram, enrichis via Steam / IGDB / ITAD.",
    isPublic: true,
  },
});

const rows = games.map((g) => ({ ...toRow(g), listId: list.id })).filter((r) => r.titre);
const res = await prisma.game.createMany({ data: rows, skipDuplicates: true });

console.log(`✅ Liste "${list.name}" (${list.slug}) · ${res.count} jeux insérés.`);
await prisma.$disconnect();
process.exit(0);
