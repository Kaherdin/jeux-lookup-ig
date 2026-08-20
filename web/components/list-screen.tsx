import { notFound } from "next/navigation";
import { Plus } from "lucide-react";
import { getListBySlug, getGames, getVisibleLists, getOwnedTitles } from "@/lib/store";
import { getSession } from "@/lib/session";
import { SiteHeader } from "./site-header";
import { GamesView } from "./games-view";
import { AddGamesDialog } from "./add-games-dialog";
import { Button } from "@/components/ui/button";
import type { Game } from "@/lib/types";

export async function ListScreen({ slug }: { slug: string }) {
  const list = await getListBySlug(slug);
  if (!list) notFound();
  const session = await getSession();
  const user = session?.user ?? null;

  const [games, allLists, ownedTitles] = await Promise.all([
    getGames(list.id),
    getVisibleLists(user?.id),
    user ? getOwnedTitles(user.id) : Promise.resolve([]),
  ]);

  // liste sans propriétaire = collaborative : tout le monde peut y ajouter, même sans compte.
  const canAdd = list.ownerId === null || list.ownerId === user?.id;
  // modifier l'existant (rescan, suppression) demande au moins un compte.
  const canManage = !!user && (list.ownerId === null || list.ownerId === user.id);

  return (
    <>
      <SiteHeader currentSlug={list.slug} currentName={list.name} canEdit={canManage} />
      <main className="mx-auto max-w-[1500px] px-4 py-6 pb-24">
        <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{list.name}</h1>
            {list.description && <p className="mt-1 text-sm text-muted-foreground">{list.description}</p>}
            {list.ownerId === null && (
              <p className="mt-1 text-xs text-muted-foreground">Liste collaborative — ouverte à tous, même sans compte.</p>
            )}
          </div>
          {canAdd && (
            <AddGamesDialog slug={list.slug} trigger={
              <Button size="lg" className="shrink-0 gap-2 px-6 text-base font-bold shadow-lg shadow-primary/30 transition hover:-translate-y-0.5">
                <Plus className="h-5 w-5" /> Ajouter des jeux
              </Button>
            } />
          )}
        </div>
        <GamesView
          games={games as unknown as Game[]}
          list={{ id: list.id, slug: list.slug, name: list.name, ownerId: list.ownerId }}
          canManage={canManage}
          lists={allLists.map((l) => ({ slug: l.slug, name: l.name }))}
          ownedTitles={ownedTitles}
          showOwned={!!user}
        />
      </main>
      {/* mobile : le bouton du haut sort de l'écran dès qu'on descend dans la liste */}
      {canAdd && (
        <div className="fixed bottom-5 right-5 z-30 sm:hidden">
          <AddGamesDialog slug={list.slug} trigger={
            <Button size="lg" className="h-14 w-14 rounded-full p-0 shadow-xl shadow-primary/40" aria-label="Ajouter des jeux">
              <Plus className="h-6 w-6" />
            </Button>
          } />
        </div>
      )}
    </>
  );
}
