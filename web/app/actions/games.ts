"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { authActionClient } from "@/lib/safe-action";
import { getListBySlug, gameExists, upsertGame, getTitles, createGames, createList } from "@/lib/store";
import { prisma } from "@/lib/prisma";
import { allow } from "@/lib/ratelimit";
import { fetchPsnLibrary } from "@/lib/psn";
import { fetchSteamLibrary } from "@/lib/steam";
import { detectTitle, enrichGame, detectAnything, igdbDiscover } from "@/lib/enrich.mjs";
import type { PreviewGame } from "@/lib/types";

const env = () => ({
  TWITCH_ID: process.env.TWITCH_ID,
  TWITCH_SECRET: process.env.TWITCH_SECRET,
  ITAD_KEY: process.env.ITAD_KEY,
  ITAD_ID: process.env.ITAD_ID,
  YOUTUBE_API_KEY: process.env.YOUTUBE_API_KEY,
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
  ANTHROPIC_MODEL: process.env.ANTHROPIC_MODEL,
  // secours automatique quand Anthropic est indisponible (quota, panne)
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  OPENAI_MODEL: process.env.OPENAI_MODEL,
  GOOGLE_GENERATIVE_AI_API_KEY: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
  // jeton oEmbed Meta : sans lui, les légendes Instagram sont illisibles
  INSTAGRAM_OEMBED_TOKEN: process.env.INSTAGRAM_OEMBED_TOKEN,
  META_APP_ID: process.env.META_APP_ID,
  META_CLIENT_TOKEN: process.env.META_CLIENT_TOKEN,
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
    const det = await detectTitle(input.trim(), env());
    if (!det.titre) throw new Error(det.error ?? "Impossible de détecter un titre. Tape le nom du jeu directement.");
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

// Champ unique : lien YouTube (trailer ou « Top 10 »), playlist, lien Steam / PS Store /
// Instagram / autre boutique, un titre, une liste de titres, ou un texte libre.
// C'est detectAnything qui choisit la stratégie — l'interface n'a plus rien à deviner.
export const analyzeInput = authActionClient
  .inputSchema(z.object({ slug: z.string(), input: z.string().min(1) }))
  .action(async ({ parsedInput: { slug, input }, ctx }) => {
    if (!(await allow("enrich", `u:${ctx.user.id}`))) throw new Error("Analyse limitée — réessaie dans une minute.");
    const list = await assertCanEdit(slug, ctx.user.id);
    const existing = await getTitles(list.id);
    const res = await detectAnything(input, env(), existing);
    return {
      games: res.games as PreviewGame[],
      skipped: (res.skipped ?? []) as string[],
      notes: (res.notes ?? []) as string[],
      // « candidats » = un titre tapé → on ne préselectionne que le premier
      mode: (res.mode ?? "liste") as string,
    };
  });

// moteur de découverte IGDB (filtres plateforme / genre / mode / coop local / joueurs / note)
export const discoverGames = authActionClient
  .inputSchema(z.object({
    platforms: z.array(z.number()).optional(),
    genres: z.array(z.number()).optional(),
    modes: z.array(z.number()).optional(),
    coopLocal: z.boolean().optional(),
    playersMin: z.number().optional(),
    noteMin: z.number().optional(),
    sinceYear: z.number().optional(),
    sort: z.enum(["pop", "note", "recent"]).optional(),
  }))
  .action(async ({ parsedInput }) => {
    const games = await igdbDiscover(parsedInput, env());
    return { games: games as DiscoverGame[] };
  });

// ajoute un jeu trouvé par la découverte (épinglé par ID IGDB) → enrichit + enregistre
export const addDiscovered = authActionClient
  .inputSchema(z.object({ slug: z.string(), titre: z.string(), igdbId: z.number().optional() }))
  .action(async ({ parsedInput: { slug, titre, igdbId }, ctx }) => {
    if (!(await allow("enrich", `u:${ctx.user.id}`))) throw new Error("Ajout limité — réessaie dans une minute.");
    const list = await assertCanEdit(slug, ctx.user.id);
    if (await gameExists(list.id, titre)) return { titre, duplicate: true };
    const g = await enrichGame({ titre, igdbId, ajouteLe: new Date().toISOString().slice(0, 10) }, env());
    await upsertGame(list.id, g);
    revalidate(slug);
    return { titre: g.titre, duplicate: false };
  });

export type DiscoverGame = {
  igdbId: number;
  titre: string;
  cover: string;
  annee: number | null;
  note: number | null;
  plateformes: string[];
  genres: string;
};

// importe la bibliothèque PSN (jeux joués) via un token NPSSO → liste dédiée « Ma bibliothèque PlayStation ».
export const importPsn = authActionClient
  .inputSchema(z.object({ npsso: z.string().min(32) }))
  .action(async ({ parsedInput: { npsso }, ctx }) => {
    if (!(await allow("heavy", `u:${ctx.user.id}`))) throw new Error("Import limité — réessaie dans quelques minutes.");
    let lib;
    try {
      lib = await fetchPsnLibrary(npsso);
    } catch {
      throw new Error("Token NPSSO invalide ou expiré — récupère-le à nouveau (voir l'aide).");
    }
    if (!lib.length) throw new Error("Aucun jeu trouvé sur ce compte PSN.");
    // liste dédiée par utilisateur (créée au premier import)
    const slug = `ps-${ctx.user.id.slice(0, 8).toLowerCase()}`;
    const existing = await getListBySlug(slug);
    if (existing?.ownerId && existing.ownerId !== ctx.user.id) throw new Error("Conflit de liste PSN.");
    const listId = existing?.id ?? (await createList({
      slug, name: "🎮 Ma bibliothèque PlayStation", isPublic: true, ownerId: ctx.user.id,
      description: "Jeux joués sur PS4/PS5, importés depuis PSN.",
    })).id;
    const today = new Date().toISOString().slice(0, 10);
    const rows = lib.map((g) => ({ titre: g.titre, image: g.image, plateformes: [g.plateforme], ajouteLe: today }));
    const added = await createGames(listId, rows);
    revalidate(slug);
    return { added, total: lib.length, slug };
  });

// rafraîchit la bibliothèque Steam depuis le SteamID déjà mémorisé (via la connexion OpenID).
export const importSteam = authActionClient
  .inputSchema(z.object({}))
  .action(async ({ ctx }) => {
    if (!(await allow("heavy", `u:${ctx.user.id}`))) throw new Error("Import limité — réessaie dans quelques minutes.");
    const apiKey = process.env.STEAM_WEB_API_KEY;
    if (!apiKey) throw new Error("Steam non configuré (clé API manquante).");
    const user = await prisma.user.findUnique({ where: { id: ctx.user.id }, select: { steamId: true } });
    if (!user?.steamId) throw new Error("Compte Steam non lié — clique d'abord « Se connecter avec Steam ».");
    const lib = await fetchSteamLibrary(user.steamId, apiKey);
    if (!lib.length) throw new Error("Aucun jeu trouvé — vérifie que ton profil Steam (détails du jeu) est public.");
    const slug = `steam-${ctx.user.id.slice(0, 8).toLowerCase()}`;
    const existing = await getListBySlug(slug);
    if (existing?.ownerId && existing.ownerId !== ctx.user.id) throw new Error("Conflit de liste Steam.");
    const listId = existing?.id ?? (await createList({
      slug, name: "🎮 Ma bibliothèque Steam", isPublic: true, ownerId: ctx.user.id,
      description: "Jeux possédés sur Steam.",
    })).id;
    const today = new Date().toISOString().slice(0, 10);
    const rows = lib.map((g) => ({ titre: g.titre, image: g.image, plateformes: [g.plateforme], steamAppId: g.steamAppId, ajouteLe: today }));
    const added = await createGames(listId, rows);
    revalidate(slug);
    return { added, total: lib.length, slug };
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
