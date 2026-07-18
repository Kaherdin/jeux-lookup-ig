import { prisma } from "./prisma";
import { toRow } from "./game-row.mjs";

export const DEFAULT_LIST_SLUG = "decouvertes";

export type GameInput = Record<string, unknown> & { titre: string };

// ─── listes ────────────────────────────────────────────────────────────
export async function getPublicLists() {
  return prisma.list.findMany({
    where: { isPublic: true },
    orderBy: { createdAt: "asc" },
    include: { _count: { select: { games: true } }, owner: { select: { name: true } } },
  });
}

export async function getUserLists(ownerId: string) {
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
export async function getGames(listId: string) {
  return prisma.game.findMany({
    where: { listId },
    orderBy: [{ bienNote: "desc" }, { note: "desc" }, { titre: "asc" }],
  });
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

export async function createGames(listId: string, list: GameInput[]) {
  const rows = list.map((g) => ({ ...toRow(g), listId })).filter((r: { titre?: string }) => r.titre);
  const res = await prisma.game.createMany({ data: rows, skipDuplicates: true });
  return res.count;
}
