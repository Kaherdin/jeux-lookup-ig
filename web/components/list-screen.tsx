import { notFound } from "next/navigation";
import { getListBySlug, getGames } from "@/lib/store";
import { getSession } from "@/lib/session";
import { SiteHeader } from "./site-header";
import { GamesView } from "./games-view";
import type { Game } from "@/lib/types";

export async function ListScreen({ slug }: { slug: string }) {
  const list = await getListBySlug(slug);
  if (!list) notFound();
  const [games, session] = await Promise.all([getGames(list.id), getSession()]);
  const canEdit = !!session?.user && (list.ownerId === null || list.ownerId === session.user.id);

  return (
    <>
      <SiteHeader currentSlug={list.slug} currentName={list.name} />
      <main className="mx-auto max-w-6xl px-4 py-6">
        <div className="mb-5">
          <h1 className="text-2xl font-bold tracking-tight">{list.name}</h1>
          {list.description && <p className="mt-1 text-sm text-muted-foreground">{list.description}</p>}
        </div>
        <GamesView
          games={games as unknown as Game[]}
          list={{ id: list.id, slug: list.slug, name: list.name, ownerId: list.ownerId }}
          canEdit={canEdit}
        />
      </main>
    </>
  );
}
