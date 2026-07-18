"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { authActionClient } from "@/lib/safe-action";
import { getListBySlug, gameExists, upsertGame, getTitles, createGames } from "@/lib/store";
import { prisma } from "@/lib/prisma";
import { allow } from "@/lib/ratelimit";
import { detectTitle, enrichGame, detectMany } from "@/lib/enrich.mjs";
import type { PreviewGame } from "@/lib/types";

const env = () => ({
  TWITCH_ID: process.env.TWITCH_ID,
  TWITCH_SECRET: process.env.TWITCH_SECRET,
  ITAD_KEY: process.env.ITAD_KEY,
  YOUTUBE_API_KEY: process.env.YOUTUBE_API_KEY,
});

async function assertCanEdit(slug: string, userId: string) {
  const list = await getListBySlug(slug);
  if (!list) throw new Error("Liste introuvable.");
  if (list.ownerId && list.ownerId !== userId) throw new Error("Cette liste ne t'appartient pas.");
  return list;
}

function revalidate(slug: string) {
  revalidatePath("/");
  revalidatePath(`/l/${slug}`);
}

export const addGame = authActionClient
  .inputSchema(z.object({ slug: z.string(), input: z.string().min(1) }))
  .action(async ({ parsedInput: { slug, input }, ctx }) => {
    const list = await assertCanEdit(slug, ctx.user.id);
    const det = await detectTitle(input.trim());
    if (!det.titre) throw new Error("Impossible de détecter un titre. Tape le nom du jeu directement.");
    if (await gameExists(list.id, det.titre)) return { duplicate: true, titre: det.titre };
    const g = await enrichGame(
      {
        titre: det.titre,
        steamAppId: det.steamAppId,
        psnUrl: det.psnUrl,
        reel: det.source === "instagram" || det.source === "youtube" ? input : "",
        ajouteLe: new Date().toISOString().slice(0, 10),
      },
      env()
    );
    await upsertGame(list.id, g);
    revalidate(slug);
    return { added: true, titre: g.titre, source: det.source };
  });

export const detectGames = authActionClient
  .inputSchema(z.object({ slug: z.string(), text: z.string().optional(), playlist: z.string().optional() }))
  .action(async ({ parsedInput: { slug, text, playlist }, ctx }) => {
    if (!(await allow("enrich", `u:${ctx.user.id}`))) throw new Error("Analyse limitée — réessaie dans une minute.");
    const list = await assertCanEdit(slug, ctx.user.id);
    const existing = await getTitles(list.id);
    const res = await detectMany({ text: text || "", playlist: playlist || "" }, env(), existing);
    if (res.error) throw new Error(res.error);
    return { games: res.games as PreviewGame[], skipped: (res.skipped ?? []) as string[] };
  });

// reçoit les jeux DÉJÀ enrichis (depuis la preview) → enregistre directement
export const addBatch = authActionClient
  .inputSchema(
    z.object({
      slug: z.string(),
      items: z.array(z.object({ titre: z.string() }).passthrough()),
    })
  )
  .action(async ({ parsedInput: { slug, items }, ctx }) => {
    if (!(await allow("enrich", `u:${ctx.user.id}`))) throw new Error("Ajout limité — réessaie dans une minute.");
    const list = await assertCanEdit(slug, ctx.user.id);
    const added = await createGames(list.id, items as Array<Record<string, unknown> & { titre: string }>);
    revalidate(slug);
    return { added, titres: items.map((it) => it.titre) };
  });

// re-enrichit un jeu existant (comble les infos manquantes)
function rescanRec(g: { titre: string; steamAppId: string | null; genre: string | null; univers: string | null; nbJoueurs: string | null; reel: string | null; createur: string | null; ajouteLe: string | null }) {
  return { titre: g.titre, steamAppId: g.steamAppId, genre: g.genre, univers: g.univers, nbJoueurs: g.nbJoueurs, reel: g.reel, createur: g.createur, ajouteLe: g.ajouteLe };
}

export const rescanGame = authActionClient
  .inputSchema(z.object({ slug: z.string(), titre: z.string() }))
  .action(async ({ parsedInput: { slug, titre }, ctx }) => {
    if (!(await allow("enrich", `u:${ctx.user.id}`))) throw new Error("Rescan limité — réessaie dans une minute.");
    const list = await assertCanEdit(slug, ctx.user.id);
    const existing = await prisma.game.findFirst({ where: { listId: list.id, titre } });
    if (!existing) throw new Error("Jeu introuvable.");
    const enriched = await enrichGame(rescanRec(existing), env());
    await upsertGame(list.id, enriched);
    revalidate(slug);
    return { titre: enriched.titre };
  });

export const rescanList = authActionClient
  .inputSchema(z.object({ slug: z.string() }))
  .action(async ({ parsedInput: { slug }, ctx }) => {
    if (!(await allow("heavy", `u:${ctx.user.id}`))) throw new Error("Rescan de liste limité — réessaie dans quelques minutes.");
    const list = await assertCanEdit(slug, ctx.user.id);
    const games = await prisma.game.findMany({ where: { listId: list.id } });
    let n = 0;
    const CONC = 4;
    for (let i = 0; i < games.length; i += CONC) {
      await Promise.all(games.slice(i, i + CONC).map(async (g) => {
        const e = await enrichGame(rescanRec(g), env()).catch(() => null);
        if (e) { await upsertGame(list.id, e); n++; }
      }));
    }
    revalidate(slug);
    return { count: n };
  });
