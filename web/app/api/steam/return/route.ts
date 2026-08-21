import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";
import { upsertCatalogue, marquerPossedes, invalidateCaches } from "@/lib/store";
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

  // mémorise le SteamID → permet de rafraîchir plus tard sans repasser par OpenID
  await prisma.user.update({ where: { id: userId }, data: { steamId } }).catch(() => {});

  // les jeux entrent au catalogue et sont marqués POSSÉDÉS : pas de liste dédiée
  const today = new Date().toISOString().slice(0, 10);
  const rows = lib.map((g) => ({
    titre: g.titre,
    image: g.image,
    plateformes: [g.plateforme],
    steamAppId: g.steamAppId,
    ajouteLe: today,
  }));
  const ids = await upsertCatalogue(rows);
  const added = await marquerPossedes(userId, ids, "steam");

  invalidateCaches();
  revalidatePath("/");
  return NextResponse.redirect(`${origin}/?steam=ok&n=${added}&total=${lib.length}`);
}
