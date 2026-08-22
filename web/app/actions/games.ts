"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { authActionClient, openActionClient } from "@/lib/safe-action";
import { getListBySlug, gameExists, upsertGame, getTitles, getTitresCatalogue, createGames, upsertCatalogue, marquerPossedes, createList, removeFromList, deleteGameEverywhere, linkGames, invalidateCaches, getGameFull, getListsContaining } from "@/lib/store";
import { prisma } from "@/lib/prisma";
import { allow } from "@/lib/ratelimit";
import { fetchPsnLibrary } from "@/lib/psn";
import { fetchSteamLibrary } from "@/lib/steam";
import { enrichGame, detectAnything, igdbDiscover } from "@/lib/enrich.mjs";
import { getCatalogue, getOwnedTitles } from "@/lib/store";
import { proposer, tropPeu } from "@/lib/selection";
import { CATEGORIES, PLATEFORME_BY_KEY } from "@/lib/categories";
import type { PreviewGame, Game } from "@/lib/types";
import type { Criteres } from "@/lib/quiz";

const env = () => ({
  TWITCH_ID: process.env.TWITCH_ID,
  TWITCH_SECRET: process.env.TWITCH_SECRET,
  ITAD_KEY: process.env.ITAD_KEY,
  ITAD_ID: process.env.ITAD_ID,
  YOUTUBE_API_KEY: process.env.YOUTUBE_API_KEY,
  // URL publique du site : envoyée en Referer à l'API YouTube, dont la clé est restreinte
  // par référent (sinon Google refuse tout appel serveur).
  APP_URL: process.env.BETTER_AUTH_URL
    || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "")
    || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "")
    || "http://localhost:3000",
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

type Actor = { id: string } | null;

/**
 * Droit d'AJOUTER dans une liste. Une liste sans propriétaire (« Découvertes ») est
 * collaborative : tout le monde y ajoute, même sans compte. Une liste possédée reste
 * privée à son auteur.
 */
async function assertCanAdd(slug: string, user: Actor) {
  const list = await getListBySlug(slug);
  if (!list) throw new Error("Liste introuvable.");
  if (!list.ownerId) return list;
  if (!user) throw new Error("Connecte-toi pour ajouter dans cette liste.");
  if (list.ownerId !== user.id) throw new Error("Cette liste ne t'appartient pas.");
  return list;
}

/**
 * Droit de MODIFIER l'existant (supprimer, rescanner). Plus strict que l'ajout : sur la
 * liste collaborative il faut au moins un compte, sinon n'importe quel visiteur pourrait
 * effacer le travail des autres.
 */
async function assertCanManage(slug: string, user: Actor) {
  const list = await getListBySlug(slug);
  if (!list) throw new Error("Liste introuvable.");
  if (!user) throw new Error("Connecte-toi pour modifier cette liste.");
  if (list.ownerId && list.ownerId !== user.id) throw new Error("Cette liste ne t'appartient pas.");
  return list;
}

function revalidate(slug: string) {
  // le cache de données doit tomber en même temps que les pages, sinon les listes
  // continueraient d'être servies depuis l'instantané précédent
  invalidateCaches();
  revalidatePath("/");
  revalidatePath(`/l/${slug}`);
}

// Champ unique : lien YouTube (trailer ou « Top 10 »), playlist, lien Steam / PS Store /
// Instagram / autre boutique, un titre, une liste de titres, ou un texte libre.
// C'est detectAnything qui choisit la stratégie — l'interface n'a plus rien à deviner.
// Ouvert aux visiteurs sans compte sur les listes collaboratives.
export const analyzeInput = openActionClient
  .inputSchema(z.object({ slug: z.string().optional(), input: z.string().min(1) }))
  .action(async ({ parsedInput: { slug, input }, ctx }) => {
    const anon = !ctx.user;
    if (!(await allow(anon ? "anon" : "enrich", ctx.key))) {
      throw new Error(anon
        ? "Limite atteinte pour les visiteurs (5 analyses / 10 min). Crée un compte pour continuer."
        : "Analyse limitée — réessaie dans une minute.");
    }
    // sans liste cible, on ajoute au catalogue : rien à vérifier côté appartenance
    const list = slug ? await assertCanAdd(slug, ctx.user) : null;
    // une playlist = jusqu'à 250 vidéos à enrichir : réservé aux comptes
    if (anon && /youtube\.com\/playlist|[?&]list=/i.test(input)) {
      throw new Error("L'import d'une playlist YouTube demande un compte (c'est très gourmand). Colle une vidéo, un titre ou une liste de titres.");
    }
    const existing = list ? await getTitles(list.id) : await getTitresCatalogue();
    const res = await detectAnything(input, env(), existing);
    return {
      games: res.games as PreviewGame[],
      skipped: (res.skipped ?? []) as string[],
      notes: (res.notes ?? []) as string[],
      // « candidats » = un titre tapé → on ne préselectionne que le premier
      mode: (res.mode ?? "liste") as string,
    };
  });

/**
 * Rattache des jeux du catalogue à une liste (sélection multiple).
 * Rien n'est recopié : on ajoute une référence. La fiche reste unique, donc un rescan
 * profite à toutes les listes qui la citent.
 */
export const copyToList = openActionClient
  .inputSchema(z.object({ ids: z.array(z.string()).min(1).max(300), toSlug: z.string() }))
  .action(async ({ parsedInput: { ids, toSlug }, ctx }) => {
    const target = await assertCanAdd(toSlug, ctx.user);
    const rows = await prisma.game.findMany({ where: { id: { in: ids } }, select: { id: true } });
    if (!rows.length) throw new Error("Aucun jeu à ajouter.");
    const added = await linkGames(target.id, rows.map((r) => r.id));
    revalidate(toSlug);
    return { added, total: rows.length, slug: target.slug, name: target.name };
  });

/**
 * Retire un jeu d'une liste (défaut) — la fiche reste au catalogue et dans les autres
 * listes. `partout: true` la supprime du catalogue, donc de toutes les listes.
 */
export const deleteGameAction = openActionClient
  .inputSchema(z.object({ slug: z.string(), id: z.string(), partout: z.boolean().optional() }))
  .action(async ({ parsedInput: { slug, id, partout }, ctx }) => {
    const list = await assertCanManage(slug, ctx.user);
    const ok = partout ? await deleteGameEverywhere(id) : await removeFromList(list.id, id);
    if (!ok) throw new Error("Jeu introuvable dans cette liste.");
    revalidate(slug);
    return { deleted: true, partout: !!partout };
  });

// moteur de découverte IGDB (filtres plateforme / genre / mode / coop local / joueurs / note)
export const discoverGames = openActionClient
  .inputSchema(z.object({
    platforms: z.array(z.number()).optional(),
    genres: z.array(z.number()).optional(),
    themes: z.array(z.number()).optional(),
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

/**
 * « Trouve-moi un jeu » : les critères du questionnaire, une file de propositions.
 *
 * Le tri se fait ICI et pas dans le navigateur : la page d'accueil envoie déjà tout le
 * catalogue au client, ce qui n'a aucun sens pour un écran conçu pour le pouce. Le
 * catalogue est de toute façon en cache côté serveur — on ne paie donc rien de plus.
 */
const CRITERES = z.object({
  joueurs: z.number().int().min(1).max(8),
  ensemble: z.enum(["coop", "versus"]).nullable(),
  local: z.boolean().nullable(),
  familles: z.array(z.string()).max(12),
  dureeMin: z.number().nullable(),
  dureeMax: z.number().nullable(),
  plateforme: z.string().nullable(),
  ecarterPossedes: z.boolean(),
});

export const proposerJeux = openActionClient
  .inputSchema(z.object({ criteres: CRITERES }))
  .action(async ({ parsedInput: { criteres }, ctx }) => {
    if (!(await allow(ctx.user ? "general" : "anon", ctx.key))) {
      throw new Error("Trop de recherches d'affilée — laisse passer une minute.");
    }
    const jeux = (await getCatalogue()) as unknown as Game[];
    const possedes = new Set(
      ctx.user ? (await getOwnedTitles(ctx.user.id)).map((t) => t.toLowerCase()) : []
    );
    const props = proposer(jeux, criteres as Criteres, { possedes, taille: 30 });

    // Cul-de-sac : 576 jeux ne couvrent pas toutes les envies, et une combinaison un peu
    // pointue peut ne rien donner. Plutôt qu'un écran vide, on repose exactement les
    // mêmes critères à IGDB — les jeux qui en viennent sont signalés comme extérieurs.
    let ailleurs: unknown[] = [];
    if (tropPeu(props)) {
      const fam = CATEGORIES.filter((c) => criteres.familles.includes(c.key));
      ailleurs = await igdbDiscover({
        platforms: (criteres.plateforme && PLATEFORME_BY_KEY[criteres.plateforme]?.igdb) || [],
        genres: [...new Set(fam.flatMap((c) => c.igdbGenres))],
        themes: [...new Set(fam.flatMap((c) => c.igdbThemes))],
        modes: criteres.ensemble === "coop" ? [3] : criteres.ensemble === "versus" ? [2] : [],
        coopLocal: criteres.local === true,
        playersMin: criteres.joueurs > 1 ? criteres.joueurs : 0,
        sort: "pop",
      }, env(), 20);
    }
    return { props, ailleurs };
  });

// ajoute un jeu trouvé par la découverte (épinglé par ID IGDB) → enrichit + enregistre
export const addDiscovered = openActionClient
  .inputSchema(z.object({ slug: z.string(), titre: z.string(), igdbId: z.number().optional() }))
  .action(async ({ parsedInput: { slug, titre, igdbId }, ctx }) => {
    if (!(await allow(ctx.user ? "enrich" : "anon", ctx.key))) throw new Error("Ajout limité — réessaie dans quelques minutes.");
    const list = await assertCanAdd(slug, ctx.user);
    if (await gameExists(list.id, titre)) return { titre, duplicate: true };
    const g = await enrichGame({ titre, igdbId, ajouteLe: new Date().toISOString().slice(0, 10) }, env());
    await upsertGame(list.id, g);
    revalidate(slug);
    return { titre: g.titre, duplicate: false };
  });

// la fiche complète d'un jeu (captures, description, crédits) — le tableau ne les
// transporte plus, on va les chercher à l'ouverture de la modale
export const gameDetail = openActionClient
  .inputSchema(z.object({ id: z.string() }))
  .action(async ({ parsedInput: { id }, ctx }) => {
    const g = await getGameFull(id);
    if (!g) throw new Error("Jeu introuvable.");
    const listes = await getListsContaining(g.id, ctx.user?.id);
    return { game: g, listes };
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

/**
 * Importe la bibliothèque PSN via un token NPSSO. Les jeux entrent au CATALOGUE et sont
 * marqués POSSÉDÉS — plus de liste dédiée : posséder n'est pas une liste, c'est un fait.
 */
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
    const today = new Date().toISOString().slice(0, 10);
    const rows = lib.map((g) => ({ titre: g.titre, image: g.image, plateformes: [g.plateforme], ajouteLe: today }));
    const ids = await upsertCatalogue(rows);
    const added = await marquerPossedes(ctx.user.id, ids, "psn");
    revalidate("");
    return { added, total: lib.length };
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
    const today = new Date().toISOString().slice(0, 10);
    const rows = lib.map((g) => ({ titre: g.titre, image: g.image, plateformes: [g.plateforme], steamAppId: g.steamAppId, ajouteLe: today }));
    const ids = await upsertCatalogue(rows);
    const added = await marquerPossedes(ctx.user.id, ids, "steam");
    revalidate("");
    return { added, total: lib.length };
  });

// reçoit les jeux DÉJÀ enrichis (depuis la preview) → enregistre directement
export const addBatch = openActionClient
  .inputSchema(
    z.object({
      slug: z.string().optional(),
      items: z.array(z.object({ titre: z.string() }).passthrough()),
    })
  )
  .action(async ({ parsedInput: { slug, items }, ctx }) => {
    if (!(await allow(ctx.user ? "enrich" : "anon", ctx.key))) throw new Error("Ajout limité — réessaie dans quelques minutes.");
    const list = slug ? await assertCanAdd(slug, ctx.user) : null;
    const added = await createGames(list?.id ?? null, items as Array<Record<string, unknown> & { titre: string }>);
    revalidate(slug ?? "");
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
    const list = await assertCanManage(slug, ctx.user);
    const existing = await prisma.game.findFirst({ where: { titre, items: { some: { listId: list.id } } } });
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
    const list = await assertCanManage(slug, ctx.user);
    const games = await prisma.game.findMany({ where: { items: { some: { listId: list.id } } } });
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
