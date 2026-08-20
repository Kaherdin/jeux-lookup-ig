import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { getListBySlug, getGames, getVisibleLists } from "@/lib/store";
import { getSession } from "@/lib/session";
import { slugifyTitle } from "@/lib/utils";
import { SiteHeader } from "@/components/site-header";
import { GameDetail } from "@/components/game-detail";
import type { Game } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ slug: string; jeu: string }> }) {
  const { slug, jeu } = await params;
  const list = await getListBySlug(slug);
  if (!list) notFound();

  const [games, session] = await Promise.all([getGames(list.id), getSession()]);
  const lists = await getVisibleLists(session?.user?.id);
  // les jeux n'ont pas de slug en base : on retrouve celui dont le titre donne la même URL
  const game = games.find((g) => slugifyTitle(g.titre) === jeu);
  if (!game) notFound();

  const canManage = !!session?.user && (list.ownerId === null || list.ownerId === session.user.id);

  return (
    <>
      <SiteHeader currentSlug={list.slug} currentName={list.name} canEdit={canManage} />
      <main className="mx-auto max-w-4xl px-4 py-6">
        <Link href={`/l/${list.slug}`}
          className="mb-4 inline-flex items-center text-sm text-muted-foreground transition hover:text-foreground">
          <ChevronLeft className="mr-1 h-4 w-4" /> {list.name}
        </Link>
        <GameDetail g={game as unknown as Game} slug={list.slug} canManage={canManage}
          lists={lists.map((l) => ({ slug: l.slug, name: l.name }))} />
      </main>
    </>
  );
}
