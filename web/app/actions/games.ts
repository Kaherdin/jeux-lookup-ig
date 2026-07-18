"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { authActionClient } from "@/lib/safe-action";
import { getListBySlug, gameExists, upsertGame, getTitles, createGames } from "@/lib/store";
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
    const list = await assertCanEdit(slug, ctx.user.id);
    const existing = await getTitles(list.id);
    const res = await detectMany({ text: text || "", playlist: playlist || "" }, env(), existing);
    if (res.error) throw new Error(res.error);
    return { games: res.games as PreviewGame[] };
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
    const list = await assertCanEdit(slug, ctx.user.id);
    const added = await createGames(list.id, items as Array<Record<string, unknown> & { titre: string }>);
    revalidate(slug);
    return { added, titres: items.map((it) => it.titre) };
  });
