// Enrichit tous les jeux d'une liste (par slug) : node prisma/enrich-list.mjs <slug>
import { PrismaClient } from "@prisma/client";
import { enrichGame } from "../lib/enrich.mjs";
import { toRow } from "../lib/game-row.mjs";

const prisma = new PrismaClient({ datasources: { db: { url: process.env.POSTGRES_URL } } });
const env = {
  TWITCH_ID: process.env.TWITCH_ID, TWITCH_SECRET: process.env.TWITCH_SECRET,
  ITAD_KEY: process.env.ITAD_KEY, ITAD_ID: process.env.ITAD_ID,
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
};
const slug = process.argv[2];

async function main() {
  const list = await prisma.list.findUnique({ where: { slug } });
  if (!list) { console.log("Liste introuvable:", slug); return; }
  const games = await prisma.game.findMany({ where: { listId: list.id } });
  let ok = 0, fail = 0, matched = 0;
  const CONC = 4;
  for (let i = 0; i < games.length; i += CONC) {
    await Promise.all(games.slice(i, i + CONC).map(async (g) => {
      const e = await enrichGame({
        titre: g.titre, steamAppId: g.steamAppId, plateforme: g.plateformes?.[0] || "",
        image: g.image, genre: g.genre, univers: g.univers, nbJoueurs: g.nbJoueurs, reel: g.reel,
        createur: g.createur, ajouteLe: g.ajouteLe,
      }, env).catch(() => null);
      if (e && e.titre) {
        if (e.steamAppId || e.igdbId) matched++;
        await prisma.game.update({ where: { id: g.id }, data: toRow(e) });
        ok++;
      } else fail++;
    }));
    process.stdout.write(`\r  ${ok + fail}/${games.length} (${matched} matchés)`);
  }
  console.log(`\n${ok} enrichis · ${matched} matchés Steam/IGDB · ${fail} échecs`);
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
