"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { authActionClient } from "@/lib/safe-action";
import { getListBySlug, gameExists, upsertGame, getTitles, createGames } from "@/lib/store";
import { detectTitle, enrichGame, detectMany } from "@/lib/enrich.mjs";

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
    return { games: res.games as DetectedGame[] };
  });

export const addBatch = authActionClient
  .inputSchema(
    z.object({
      slug: z.string(),
      items: z.array(
        z.object({
          titre: z.string(),
          steamAppId: z.string().optional(),
          source: z.string().optional(),
          input: z.string().optional(),
          psnUrl: z.string().optional(),
        })
      ),
    })
  )
  .action(async ({ parsedInput: { slug, items }, ctx }) => {
    const list = await assertCanEdit(slug, ctx.user.id);
    const existing = new Set((await getTitles(list.id)).map((t) => t.toLowerCase()));
    const todo = items.filter((it) => it.titre && !existing.has(it.titre.toLowerCase()));
    const enriched: Array<Record<string, unknown> & { titre: string }> = [];
    const CONC = 4;
    for (let i = 0; i < todo.length; i += CONC) {
      const r = await Promise.all(
        todo.slice(i, i + CONC).map((it) =>
          enrichGame(
            {
              titre: it.titre,
              steamAppId: it.steamAppId,
              psnUrl: it.psnUrl,
              reel: it.source === "instagram" || it.source === "youtube" ? it.input : "",
              ajouteLe: new Date().toISOString().slice(0, 10),
            },
            env()
          ).catch(() => null)
        )
      );
      for (const g of r) if (g && g.titre) enriched.push(g);
    }
    const added = await createGames(list.id, enriched);
    revalidate(slug);
    return { added, titres: enriched.map((g) => g.titre) };
  });

export type DetectedGame = {
  input: string;
  source: string;
  titre: string;
  steamAppId: string;
  image: string;
  psnUrl: string;
  duplicate?: boolean;
};
