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

export const DEFAULT_LIST_SLUG = "decouvertes";

export type GameInput = Record<string, unknown> & { titre: string };

// ─── listes ────────────────────────────────────────────────────────────
export const getPublicLists = () =>
  unstable_cache(publicListsQuery, ["publicLists"], { tags: [TAGS.lists, TAGS.games], revalidate: 300 })();

async function publicListsQuery() {
  return prisma.list.findMany({
    where: { isPublic: true },
    orderBy: { createdAt: "asc" },
    include: { _count: { select: { games: true } }, owner: { select: { name: true } } },
  });
}

export const getUserLists = (ownerId: string) =>
  unstable_cache(() => userListsQuery(ownerId), ["userLists", ownerId], { tags: [TAGS.lists, TAGS.games], revalidate: 300 })();

async function userListsQuery(ownerId: string) {
  return prisma.list.findMany({
    where: { ownerId },
    orderBy: { createdAt: "asc" },
    include: { _count: { select: { games: true } } },
  });
}

export async function getListBySlug(slug: string) {
  return prisma.list.findUnique({
    where: { slug },
    include: { owner: { select: { id: true, name: true } } },
  });
}

export async function getDefaultList() {
  return prisma.list.findUnique({ where: { slug: DEFAULT_LIST_SLUG } });
}

/** Slugs des listes-bibliothèques générées pour un utilisateur (import PSN / Steam). */
export function libSlugs(userId: string) {
  const k = userId.slice(0, 8).toLowerCase();
  return { psn: `ps-${k}`, steam: `steam-${k}` };
}

/**
 * Titres que l'utilisateur POSSÈDE déjà : ceux venant de ses bibliothèques PSN / Steam
 * importées. Sert à distinguer « je l'ai » de « je le veux » dans les listes.
 */
export const getOwnedTitles = (userId: string) =>
  unstable_cache(() => ownedTitlesQuery(userId), ["ownedTitles", userId], { tags: [TAGS.games], revalidate: 300 })();

async function ownedTitlesQuery(userId: string): Promise<string[]> {
  const { psn, steam } = libSlugs(userId);
  const lists = await prisma.list.findMany({
    where: { ownerId: userId, slug: { in: [psn, steam] } },
    select: { id: true },
  });
  if (!lists.length) return [];
  const rows = await prisma.game.findMany({
    where: { listId: { in: lists.map((l) => l.id) } },
    select: { titre: true },
  });
  return rows.map((r) => r.titre);
}

/** Toutes les listes visibles par quelqu'un : les publiques + les siennes. */
export const getVisibleLists = (userId?: string | null) =>
  unstable_cache(() => visibleListsQuery(userId), ["visibleLists", userId ?? "anon"],
    { tags: [TAGS.lists, TAGS.games], revalidate: 300 })();

async function visibleListsQuery(userId?: string | null) {
  return prisma.list.findMany({
    where: userId ? { OR: [{ isPublic: true }, { ownerId: userId }] } : { isPublic: true },
    orderBy: { createdAt: "asc" },
    include: { _count: { select: { games: true } } },
  });
}

export async function createList(data: {
  name: string;
  slug: string;
  description?: string | null;
  isPublic?: boolean;
  ownerId?: string | null;
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
  prix: true, prixSteam: true, reducPct: true, note: true, noteSource: true, metacritic: true,
  steamPct: true, steamAvis: true, joueursSteam: true, igdbVotes: true,
  modes: true, modesDetail: true, nbJoueurs: true, nbJoueursMax: true, joueursLocalMax: true,
  joueursOnlineMax: true, envergure: true, dureeVie: true,
  urlSteam: true, urlPsn: true, urlStore: true, ajouteLe: true, createdAt: true,
} as const;

async function gamesQuery(listId: string) {
  const rows = await prisma.game.findMany({
    where: { listId },
    select: LIST_SELECT,
    orderBy: [{ bienNote: "desc" }, { note: "desc" }, { titre: "asc" }],
  });
  // les familles sont calculées une fois ici, plus à chaque rendu chez le client
  return rows.map(({ description, createdAt, ...g }) => ({
    ...g,
    cats: categorize({ genre: g.genre, themes: g.themes, univers: g.univers, description }),
    ajouteLe: g.ajouteLe || createdAt.toISOString().slice(0, 10),
  }));
}

export function getGames(listId: string) {
  // 5 min de filet : les scripts (reenrich.mjs, seed) écrivent en base sans passer par
  // l'app et ne peuvent donc pas invalider les étiquettes.
  return unstable_cache(() => gamesQuery(listId), ["games", listId], { tags: [TAGS.games], revalidate: 300 })();
}

/** la fiche complète d'un jeu — captures, description, crédits : chargée à la demande */
export async function getGameFull(id: string) {
  return prisma.game.findUnique({ where: { id } });
}

export async function getTitles(listId: string) {
  const rows = await prisma.game.findMany({ where: { listId }, select: { titre: true } });
  return rows.map((r) => r.titre);
}

export async function gameExists(listId: string, titre: string) {
  const n = await prisma.game.count({
    where: { listId, titre: { equals: titre, mode: "insensitive" } },
  });
  return n > 0;
}

export async function upsertGame(listId: string, g: GameInput) {
  const data = { ...toRow(g), listId };
  return prisma.game.upsert({
    where: { listId_titre: { listId, titre: data.titre } },
    create: data,
    update: data,
  });
}

export async function deleteGame(listId: string, id: string) {
  const res = await prisma.game.deleteMany({ where: { id, listId } });
  return res.count > 0;
}

export async function createGames(listId: string, list: GameInput[]) {
  const rows = list.map((g) => ({ ...toRow(g), listId })).filter((r: { titre?: string }) => r.titre);
  const res = await prisma.game.createMany({ data: rows, skipDuplicates: true });
  return res.count;
}
