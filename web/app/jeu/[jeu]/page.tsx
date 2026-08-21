import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { getVisibleLists, getListsContaining, cleDe } from "@/lib/store";
import { getSession } from "@/lib/session";
import { slugifyTitle } from "@/lib/utils";
import { SiteHeader } from "@/components/site-header";
import { GameDetail } from "@/components/game-detail";
import type { Game } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * Fiche d'un jeu du CATALOGUE, hors contexte de liste. Le jeu n'appartenant plus à
 * une liste en particulier, c'est l'URL canonique — les fiches ouvertes depuis une
 * liste gardent la leur (/l/[slug]/[jeu]) pour proposer « retirer de cette liste ».
 */
export default async function Page({ params }: { params: Promise<{ jeu: string }> }) {
  const { jeu } = await params;
  const session = await getSession();

  // le slug d'URL vient du titre : on retrouve le jeu par sa clé de catalogue, et à
  // défaut (titres exotiques) en comparant les slugs sur les titres proches
  let game = await prisma.game.findUnique({ where: { cle: cleDe(jeu.replace(/-/g, " ")) } });
  if (!game) {
    const proches = await prisma.game.findMany({ select: { id: true, titre: true } });
    const trouve = proches.find((g) => slugifyTitle(g.titre) === jeu);
    game = trouve ? await prisma.game.findUnique({ where: { id: trouve.id } }) : null;
  }
  if (!game) notFound();

  const [lists, dansListes] = await Promise.all([
    getVisibleLists(session?.user?.id),
    getListsContaining(game.id, session?.user?.id),
  ]);

  return (
    <>
      <SiteHeader currentSlug="" currentName="Tous les jeux" canEdit={!!session?.user} />
      <main className="mx-auto max-w-4xl px-4 py-6">
        <Link href="/" className="mb-4 inline-flex items-center text-sm text-muted-foreground transition hover:text-foreground">
          <ChevronLeft className="mr-1 h-4 w-4" /> Tous les jeux
        </Link>
        <GameDetail g={game as unknown as Game} slug="" canManage={!!session?.user}
          lists={lists.map((l) => ({ slug: l.slug, name: l.name }))} dansListes={dansListes} />
      </main>
    </>
  );
}
