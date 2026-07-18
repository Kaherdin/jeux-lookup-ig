/**
 * store.mjs — couche data sur Prisma Postgres.
 * Remplace l'ancien stockage Vercel Blob.
 */
import { prisma } from "./prisma.mjs";

// champs de la table game (mapping depuis l'objet enrichi)
function toRow(g) {
  const num = (v) => (v == null || v === "" ? null : Number(v));
  const str = (v) => (v == null || v === "" ? null : String(v));
  return {
    titre: g.titre,
    igdbId: str(g.igdbId),
    steamAppId: str(g.steamAppId),
    image: str(g.image),
    genre: str(g.genre),
    univers: str(g.univers),
    plateformes: Array.isArray(g.plateformes) ? g.plateformes : [],
    sortieISO: str(g.sortieISO),
    sortiePrec: str(g.sortiePrec),
    dispo: !!g.dispo,
    gratuit: !!g.gratuit,
    gratuitMention: str(g.gratuitMention),
    bonPlan: !!g.bonPlan,
    bienNote: !!g.bienNote,
    comingSoon: g.comingSoon == null ? null : !!g.comingSoon,
    prix: g.prix ?? null,
    prixSteam: g.prixSteam == null ? null : Number(g.prixSteam),
    reducPct: Number(g.reducPct || 0),
    note: num(g.note),
    noteSource: str(g.noteSource),
    metacritic: num(g.metacritic),
    steamPct: num(g.steamPct),
    modes: g.modes ?? null,
    modesDetail: g.modesDetail ?? null,
    nbJoueurs: str(g.nbJoueurs),
    nbJoueursMax: num(g.nbJoueursMax),
    urlSteam: str(g.urlSteam),
    urlStore: str(g.urlStore),
    urlPsn: str(g.urlPsn),
    reel: str(g.reel),
    createur: str(g.createur),
    ajouteLe: str(g.ajouteLe),
  };
}

export async function getGames() {
  return prisma.game.findMany({ orderBy: [{ bienNote: "desc" }, { note: "desc" }, { titre: "asc" }] });
}

export async function getTitles() {
  const rows = await prisma.game.findMany({ select: { titre: true } });
  return rows.map((r) => r.titre);
}

export async function gameExists(titre) {
  const n = await prisma.game.count({ where: { titre: { equals: titre, mode: "insensitive" } } });
  return n > 0;
}

/** Upsert par titre. Renvoie le jeu. */
export async function upsertGame(g) {
  const data = toRow(g);
  return prisma.game.upsert({ where: { titre: data.titre }, create: data, update: data });
}

/** Crée une liste de jeux en ignorant les doublons. Renvoie le nb ajoutés. */
export async function createGames(list) {
  const rows = list.map(toRow).filter((r) => r.titre);
  const res = await prisma.game.createMany({ data: rows, skipDuplicates: true });
  return res.count;
}
