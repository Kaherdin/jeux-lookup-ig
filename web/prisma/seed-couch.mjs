// Crée une liste « Canapé — 4 joueurs » et y ajoute une sélection de jeux
// excellents à jouer à 4 en local (couch) sur PS5/PC, enrichis via Steam/IGDB/Haiku.
import { PrismaClient } from "@prisma/client";
import { enrichGame } from "../lib/enrich.mjs";
import { toRow } from "../lib/game-row.mjs";

const prisma = new PrismaClient({ datasources: { db: { url: process.env.POSTGRES_URL } } });
const env = {
  TWITCH_ID: process.env.TWITCH_ID, TWITCH_SECRET: process.env.TWITCH_SECRET,
  ITAD_KEY: process.env.ITAD_KEY, ITAD_ID: process.env.ITAD_ID,
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
};

// Sélection : tous jouables à 4 en écran partagé / canapé, dispo sur PS5.
const TITRES = [
  "Overcooked! 2",
  "Moving Out 2",
  "Gang Beasts",
  "Ultimate Chicken Horse",
  "Streets of Rage 4",
  "TowerFall Ascension",
  "Broforce",
  "Rocket League",
  "Minecraft Dungeons",
  "PlateUp!",
  "Human: Fall Flat",
  "Diablo IV",
];

const SLUG = "canape-4-joueurs";

async function main() {
  const user = await prisma.user.findFirst({ orderBy: { createdAt: "asc" } });
  const list = await prisma.list.upsert({
    where: { slug: SLUG },
    update: {},
    create: {
      slug: SLUG,
      name: "🛋️ Canapé — 4 joueurs (PS5/PC)",
      description: "Des jeux stylés à jouer à 4 en local, manette en main, pour une soirée entre potes.",
      isPublic: true,
      ownerId: user?.id ?? null,
    },
  });
  console.log("Liste:", list.slug, "· owner:", user?.email ?? "communautaire");

  let ok = 0;
  const CONC = 3;
  for (let i = 0; i < TITRES.length; i += CONC) {
    await Promise.all(TITRES.slice(i, i + CONC).map(async (t) => {
      const g = await enrichGame({ titre: t, ajouteLe: "2026-07-19" }, env).catch(() => null);
      if (!g || !g.titre) { console.log("  ✗", t); return; }
      await prisma.game.upsert({
        where: { listId_titre: { listId: list.id, titre: g.titre } },
        create: { ...toRow(g), listId: list.id },
        update: { ...toRow(g), listId: list.id },
      });
      ok++;
      console.log(`  ✓ ${g.titre} · ${g.nbJoueurs || "?"} j · ${g.plateformes.join("/")} · ${g.envergure || ""} ${g.dureeVie || ""}`);
    }));
  }
  console.log(`\n${ok}/${TITRES.length} jeux ajoutés → https://jeux-lookup-ig.vercel.app/l/${SLUG}`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
