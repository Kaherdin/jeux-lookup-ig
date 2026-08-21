import { unstable_cache, revalidateTag } from "next/cache";
import { prisma } from "./prisma";
import { toRow } from "./game-row.mjs";
import { categorize } from "./categories";

/**
 * Cache de données partagé entre requêtes. Les listes ne changent qu'à un ajout, un
 * rescan ou une suppression : inutile de rejouer les requêtes Postgres à chaque
 * affichage. Un seul jeu d'étiquettes, invalidé en bloc à la moindre écriture —
 * à l'échelle de l'app (quelques utilisateurs, des écritures rares) c'est le bon
 * compromis entre fraîcheur et simplicité.
 */
export const TAGS = { games: "games", lists: "lists" };
export function invalidateCaches() {
  revalidateTag(TAGS.games);
  revalidateTag(TAGS.lists);
}

/**
 * Il n'y a plus de « liste par défaut » : un jeu ajouté entre au CATALOGUE, point.
 * Les listes ne sont que des vues posées dessus.
 */

export type GameInput = Record<string, unknown> & { titre: string };

/**
 * Clé d'identité d'un jeu dans le catalogue. Deux écritures d'un même titre
 * (« Halo: Campaign Evolved », « HALO CAMPAIGN EVOLVED ») pointent la même fiche.
 * Doit rester identique à celle de prisma/migrate-catalogue.mjs.
 */
export function cleDe(titre: string): string {
  return (
    (titre || "")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[™®©]/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim() || "sans-titre"
  );
}

// ─── listes ────────────────────────────────────────────────────────────
// le compteur porte désormais sur les APPARTENANCES, pas sur des jeux possédés
const LIST_COUNT = { _count: { select: { items: true } } } as const;

export const getPublicLists = () =>
  unstable_cache(publicListsQuery, ["publicLists"], { tags: [TAGS.lists, TAGS.games], revalidate: 300 })();

async function publicListsQuery() {
  return prisma.list.findMany({
    where: { isPublic: true },
    orderBy: { createdAt: "asc" },
    include: { ...LIST_COUNT, owner: { select: { name: true } } },
  });
}

export const getUserLists = (ownerId: string) =>
  unstable_cache(() => userListsQuery(ownerId), ["userLists", ownerId], { tags: [TAGS.lists, TAGS.games], revalidate: 300 })();

async function userListsQuery(ownerId: string) {
  return prisma.list.findMany({ where: { ownerId }, orderBy: { createdAt: "asc" }, include: LIST_COUNT });
}

export async function getListBySlug(slug: string) {
  return prisma.list.findUnique({
    where: { slug },
    include: { owner: { select: { id: true, name: true } } },
  });
}

/** Slugs des listes-bibliothèques générées pour un utilisateur (import PSN / Steam). */
export function libSlugs(userId: string) {
  const k = userId.slice(0, 8).toLowerCase();
  return { psn: `ps-${k}`, steam: `steam-${k}` };
}

/**
 * Titres que l'utilisateur POSSÈDE déjà : ceux de ses bibliothèques PSN / Steam
 * importées. Sert à distinguer « je l'ai » de « je le veux » partout dans l'app.
 */
export const getOwnedTitles = (userId: string) =>
  unstable_cache(() => ownedTitlesQuery(userId), ["ownedTitles", userId], { tags: [TAGS.games], revalidate: 300 })();

async function ownedTitlesQuery(userId: string): Promise<string[]> {
  const rows = await prisma.ownership.findMany({
    where: { userId },
    select: { game: { select: { titre: true } } },
  });
  return rows.map((r) => r.game.titre);
}

/** Marque des jeux comme possédés par un utilisateur, sans écraser les autres sources. */
export async function marquerPossedes(userId: string, gameIds: string[], source: "psn" | "steam") {
  let n = 0;
  for (const gameId of gameIds) {
    const actuel = await prisma.ownership.findUnique({ where: { userId_gameId: { userId, gameId } } });
    const sources = [...new Set([...(actuel?.sources ?? []), source])];
    await prisma.ownership.upsert({
      where: { userId_gameId: { userId, gameId } },
      create: { userId, gameId, sources },
      update: { sources },
    });
    if (!actuel) n++;
  }
  return n;
}

export async function compterPossessions(userId: string, source?: "psn" | "steam") {
  return prisma.ownership.count({ where: { userId, ...(source ? { sources: { has: source } } : {}) } });
}

/** Toutes les listes visibles par quelqu'un : les publiques + les siennes. */
export const getVisibleLists = (userId?: string | null) =>
  unstable_cache(() => visibleListsQuery(userId), ["visibleLists", userId ?? "anon"],
    { tags: [TAGS.lists, TAGS.games], revalidate: 300 })();

async function visibleListsQuery(userId?: string | null) {
  return prisma.list.findMany({
    where: userId ? { OR: [{ isPublic: true }, { ownerId: userId }] } : { isPublic: true },
    orderBy: { createdAt: "asc" },
    include: LIST_COUNT,
  });
}

export async function createList(data: {
  name: string;
  slug: string;
  description?: string | null;
  isPublic?: boolean;
  ownerId?: string | null;
  filtre?: string | null;
}) {
  return prisma.list.create({ data });
}

// ─── jeux ──────────────────────────────────────────────────────────────
/**
 * Colonnes servies au TABLEAU. Les captures (10 URLs par jeu), la description et
 * les champs qui ne vivent que dans la fiche restent en base : sur 500 jeux ils
 * pesaient l'essentiel de la charge utile envoyée au navigateur à chaque affichage.
 * La description est bien lue ici, mais pour classer le jeu — elle n'est pas renvoyée.
 */
const LIST_SELECT = {
  id: true, titre: true, image: true, genre: true, univers: true, themes: true, description: true,
  plateformes: true, trailer: true, trailerYoutube: true, sortieISO: true, sortiePrec: true,
  dispo: true, gratuit: true, gratuitMention: true, bonPlan: true, bienNote: true, comingSoon: true,
  prix: true, prixSteam: true, prixPsn: true, reducPct: true, note: true, noteSource: true, metacritic: true,
  steamPct: true, steamAvis: true, joueursSteam: true, igdbVotes: true,
  modes: true, modesDetail: true, nbJoueurs: true, nbJoueursMax: true, joueursLocalMax: true,
  joueursOnlineMax: true, envergure: true, dureeVie: true,
  urlSteam: true, urlPsn: true, urlStore: true, ajouteLe: true, createdAt: true,
} as const;

const ORDRE = [{ bienNote: "desc" as const }, { note: "desc" as const }, { titre: "asc" as const }];

type Brut = { description: string | null; createdAt: Date; ajouteLe: string | null;
  genre: string | null; themes: string | null; univers: string | null };

/** met en forme une ligne du catalogue : familles calculées ici, pas à chaque rendu client */
function habiller<T extends Brut>({ description, createdAt, ...g }: T) {
  return {
    ...g,
    cats: categorize({ genre: g.genre, themes: g.themes, univers: g.univers, description }),
    ajouteLe: g.ajouteLe || createdAt.toISOString().slice(0, 10),
  };
}

/** Le CATALOGUE entier — c'est la vue « tous les jeux », sans passer par les listes. */
async function catalogueQuery() {
  const rows = await prisma.game.findMany({ select: LIST_SELECT, orderBy: ORDRE });
  return rows.map(habiller);
}

export function getCatalogue() {
  return unstable_cache(catalogueQuery, ["catalogue"], { tags: [TAGS.games], revalidate: 300 })();
}

/** Les jeux d'UNE liste, via ses appartenances. */
async function gamesQuery(listId: string) {
  const rows = await prisma.game.findMany({
    where: { items: { some: { listId } } },
    select: LIST_SELECT,
    orderBy: ORDRE,
  });
  return rows.map(habiller);
}

export function getGames(listId: string) {
  // 5 min de filet : les scripts (reenrich.mjs, seed) écrivent en base sans passer par
  // l'app et ne peuvent donc pas invalider les étiquettes.
  return unstable_cache(() => gamesQuery(listId), ["games", listId], { tags: [TAGS.games], revalidate: 300 })();
}

/** Les jeux appartenant à AU MOINS UNE des listes données, dédoublonnés par construction. */
async function gamesMultiQuery(listIds: string[]) {
  const rows = await prisma.game.findMany({
    where: { items: { some: { listId: { in: listIds } } } },
    select: LIST_SELECT,
    orderBy: ORDRE,
  });
  return rows.map(habiller);
}

export function getGamesByLists(listIds: string[]) {
  const cle = [...listIds].sort().join(",");
  return unstable_cache(() => gamesMultiQuery(listIds), ["gamesMulti", cle],
    { tags: [TAGS.games], revalidate: 300 })();
}

/** Les listes visibles qui contiennent déjà ce jeu. */
export async function getListsContaining(gameId: string, userId?: string | null) {
  const rows = await prisma.listItem.findMany({
    where: {
      gameId,
      list: userId ? { OR: [{ isPublic: true }, { ownerId: userId }] } : { isPublic: true },
    },
    select: { list: { select: { slug: true, name: true } } },
    orderBy: { list: { createdAt: "asc" } },
  });
  return rows.map((r) => r.list);
}

/** la fiche complète d'un jeu — captures, description, crédits : chargée à la demande */
export async function getGameFull(id: string) {
  return prisma.game.findUnique({ where: { id } });
}

/** un jeu du catalogue par son titre (insensible à la casse et aux accents) */
export async function getGameByTitre(titre: string) {
  return prisma.game.findUnique({ where: { cle: cleDe(titre) } });
}

/** tous les titres du catalogue — sert à marquer les doublons quand on ajoute sans liste */
export async function getTitresCatalogue() {
  const rows = await prisma.game.findMany({ select: { titre: true } });
  return rows.map((r) => r.titre);
}

/** titres déjà présents dans une liste — sert à marquer les doublons dans la preview */
export async function getTitles(listId: string) {
  const rows = await prisma.listItem.findMany({
    where: { listId },
    select: { game: { select: { titre: true } } },
  });
  return rows.map((r) => r.game.titre);
}

export async function gameExists(listId: string, titre: string) {
  const n = await prisma.listItem.count({ where: { listId, game: { cle: cleDe(titre) } } });
  return n > 0;
}

/**
 * Écrit un jeu dans le CATALOGUE (création ou mise à jour de la fiche existante) et,
 * si une liste est fournie, l'y rattache. Un rescan met donc à jour la fiche vue par
 * toutes les listes — c'est tout l'intérêt du catalogue.
 */
export async function upsertGame(listId: string | null, g: GameInput) {
  const data = { ...toRow(g), cle: cleDe(g.titre) };
  const jeu = await prisma.game.upsert({
    where: { cle: data.cle },
    create: data,
    update: data,
  });
  if (listId) {
    await prisma.listItem.upsert({
      where: { listId_gameId: { listId, gameId: jeu.id } },
      create: { listId, gameId: jeu.id },
      update: {},
    });
  }
  return jeu;
}

/** Retire un jeu d'une liste. La fiche reste au catalogue (les autres listes la gardent). */
export async function removeFromList(listId: string, gameId: string) {
  const res = await prisma.listItem.deleteMany({ where: { listId, gameId } });
  return res.count > 0;
}

/** Supprime un jeu du catalogue, donc de toutes les listes (cascade). */
export async function deleteGameEverywhere(gameId: string) {
  const res = await prisma.game.deleteMany({ where: { id: gameId } });
  return res.count > 0;
}

/** Rattache des jeux du catalogue à une liste. Renvoie le nombre de NOUVELLES entrées. */
export async function linkGames(listId: string, gameIds: string[]) {
  if (!gameIds.length) return 0;
  const res = await prisma.listItem.createMany({
    data: gameIds.map((gameId) => ({ listId, gameId })),
    skipDuplicates: true,
  });
  return res.count;
}

/**
 * Ajoute des jeux enrichis : chacun entre au catalogue (ou y met à jour sa fiche),
 * puis est rattaché à la liste. Renvoie le nombre de jeux NOUVEAUX dans cette liste.
 */
/** Verse des jeux au catalogue (création ou mise à jour) et renvoie leurs identifiants. */
export async function upsertCatalogue(list: GameInput[]): Promise<string[]> {
  const parCle = new Map(list.filter((g) => g.titre).map((g) => [cleDe(g.titre), g]));
  const ids: string[] = [];
  for (const [cle, g] of parCle) {
    const data = { ...toRow(g), cle };
    const jeu = await prisma.game.upsert({ where: { cle }, create: data, update: data });
    ids.push(jeu.id);
  }
  return ids;
}

export async function createGames(listId: string | null, list: GameInput[]) {
  const valides = list.filter((g) => g.titre);
  if (!valides.length) return 0;
  // dédoublonne l'entrée elle-même : deux lignes du même jeu dans un même lot
  const parCle = new Map(valides.map((g) => [cleDe(g.titre), g]));
  const ids: string[] = [];
  for (const [cle, g] of parCle) {
    const data = { ...toRow(g), cle };
    const jeu = await prisma.game.upsert({ where: { cle }, create: data, update: data });
    ids.push(jeu.id);
  }
  // sans liste cible, les jeux entrent au catalogue et c'est tout
  return listId ? linkGames(listId, ids) : ids.length;
}
