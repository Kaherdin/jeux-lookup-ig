/**
 * Écriture dans le catalogue depuis les scripts (seed, imports, enrichissements).
 * Même règle que l'app : un jeu = une fiche unique, les listes y font référence.
 */
import { toRow } from "../lib/game-row.mjs";

/** identique à lib/store.ts#cleDe et migrate-catalogue.mjs */
export function cleDe(titre) {
  return (titre || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[™®©]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim() || "sans-titre";
}

/**
 * Verse des jeux dans le catalogue puis les rattache à une liste.
 * Renvoie { fiches, nouvelles } : fiches écrites, appartenances créées.
 */
export async function upsertGames(prisma, listId, games) {
  const parCle = new Map();
  for (const g of games) if (g?.titre) parCle.set(cleDe(g.titre), g);
  const ids = [];
  for (const [cle, g] of parCle) {
    const data = { ...toRow(g), cle };
    const jeu = await prisma.game.upsert({ where: { cle }, create: data, update: data });
    ids.push(jeu.id);
  }
  let nouvelles = 0;
  if (listId && ids.length) {
    const res = await prisma.listItem.createMany({
      data: ids.map((gameId) => ({ listId, gameId })),
      skipDuplicates: true,
    });
    nouvelles = res.count;
  }
  return { fiches: ids.length, nouvelles, ids };
}

/** Les jeux d'une liste, via ses appartenances. */
export function gamesOfList(prisma, listId, select) {
  return prisma.game.findMany({ where: { items: { some: { listId } } }, ...(select ? { select } : {}) });
}
