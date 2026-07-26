import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";
import { getListBySlug, createGames, createList } from "@/lib/store";
import { prisma } from "@/lib/prisma";
import { verifySteamOpenId, fetchSteamLibrary } from "@/lib/steam";

// Callback Steam OpenID : vérifie l'assertion, récupère la bibliothèque et remplit une liste dédiée.
export async function GET(req: NextRequest) {
  const origin = process.env.BETTER_AUTH_URL || req.nextUrl.origin;

  const session = await getSession();
  if (!session?.user) return NextResponse.redirect(new URL("/sign-in", req.url));

  const apiKey = process.env.STEAM_WEB_API_KEY;
  if (!apiKey) return NextResponse.redirect(`${origin}/?steam=config`);

  const steamId = await verifySteamOpenId(req.nextUrl.searchParams);
  if (!steamId) return NextResponse.redirect(`${origin}/?steam=error`);

  const userId = session.user.id;
  const lib = await fetchSteamLibrary(steamId, apiKey);

  // liste dédiée par utilisateur (créée au premier import, réutilisée ensuite)
  const slug = `steam-${userId.slice(0, 8).toLowerCase()}`;
  const existing = await getListBySlug(slug);
  if (existing?.ownerId && existing.ownerId !== userId) {
    return NextResponse.redirect(`${origin}/?steam=error`);
  }
  const listId =
    existing?.id ??
    (
      await createList({
        slug,
        name: "🎮 Ma bibliothèque Steam",
        isPublic: true,
        ownerId: userId,
        description: "Jeux possédés sur Steam.",
      })
    ).id;

  // mémorise le SteamID → permet de rafraîchir plus tard sans repasser par OpenID
  await prisma.user.update({ where: { id: userId }, data: { steamId } }).catch(() => {});

  const today = new Date().toISOString().slice(0, 10);
  const rows = lib.map((g) => ({
    titre: g.titre,
    image: g.image,
    plateformes: [g.plateforme],
    steamAppId: g.steamAppId,
    ajouteLe: today,
  }));
  const added = await createGames(listId, rows);

  revalidatePath("/");
  revalidatePath(`/l/${slug}`);
  return NextResponse.redirect(`${origin}/l/${slug}?steam=ok&n=${added}&total=${lib.length}`);
}
