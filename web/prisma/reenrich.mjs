import { PrismaClient } from "@prisma/client";
import { enrichGame } from "../lib/enrich.mjs";
import { toRow } from "../lib/game-row.mjs";

const env = {
  TWITCH_ID: process.env.TWITCH_ID,
  TWITCH_SECRET: process.env.TWITCH_SECRET,
  ITAD_KEY: process.env.ITAD_KEY,
};
const prisma = new PrismaClient({ datasources: { db: { url: process.env.POSTGRES_URL } } });

const games = await prisma.game.findMany();
console.log(`Ré-enrichissement de ${games.length} jeux…`);
let ok = 0, media = 0;
const CONC = 4;
for (let i = 0; i < games.length; i += CONC) {
  await Promise.all(games.slice(i, i + CONC).map(async (g) => {
    const enriched = await enrichGame(
      { titre: g.titre, steamAppId: g.steamAppId, genre: g.genre, univers: g.univers,
        nbJoueurs: g.nbJoueurs, reel: g.reel, createur: g.createur, ajouteLe: g.ajouteLe },
      env
    ).catch(() => null);
    if (!enriched) return;
    const row = toRow(enriched);
    await prisma.game.update({ where: { id: g.id }, data: row });
    ok++;
    if (row.screenshots.length || row.trailer) media++;
  }));
  process.stdout.write(`\r${Math.min(i + CONC, games.length)}/${games.length}`);
}
console.log(`\n✅ ${ok} mis à jour · ${media} avec screenshots/trailer.`);
await prisma.$disconnect();
process.exit(0);
