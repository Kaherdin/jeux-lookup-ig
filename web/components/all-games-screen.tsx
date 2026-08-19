import Link from "next/link";
import { Plus } from "lucide-react";
import { getSession } from "@/lib/session";
import { getGames, getUserLists, getVisibleLists, getOwnedTitles, DEFAULT_LIST_SLUG } from "@/lib/store";
import { SiteHeader } from "./site-header";
import { GamesView } from "./games-view";
import { AddGamesDialog } from "./add-games-dialog";
import { Button } from "@/components/ui/button";
import type { Game } from "@/lib/types";

/**
 * Vue agrégée : tous les jeux de toutes les listes visibles, dédoublonnés par titre.
 * C'est la page d'accueil — les listes deviennent des regroupements par-dessus, pas des
 * silos. `scope: "mine"` restreint aux listes de l'utilisateur.
 */
export async function AllGamesScreen({ scope = "all" }: { scope?: "all" | "mine" }) {
  const session = await getSession();
  const user = session?.user ?? null;

  if (scope === "mine" && !user) {
    return (
      <>
        <SiteHeader currentSlug="" currentName="Tous mes jeux" />
        <main className="mx-auto max-w-md px-4 py-16 text-center">
          <h1 className="mb-3 text-xl font-bold">🎮 Tous mes jeux</h1>
          <p className="mb-4 text-muted-foreground">Connecte-toi pour voir et filtrer tes propres listes.</p>
          <Link href="/sign-in" className="text-primary underline">Se connecter</Link>
        </main>
      </>
    );
  }

  const sourceLists = scope === "mine" && user ? await getUserLists(user.id) : await getVisibleLists(user?.id);
  const [parListe, ownedTitles] = await Promise.all([
    Promise.all(sourceLists.map(async (l) => ({ slug: l.slug, games: await getGames(l.id) }))),
    user ? getOwnedTitles(user.id) : Promise.resolve([]),
  ]);

  // dédoublonne par titre : un même jeu peut vivre dans plusieurs listes
  const seen = new Set<string>();
  const games: Game[] = [];
  for (const { slug, games: rows } of parListe) {
    for (const g of rows) {
      const k = g.titre.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      games.push({ ...(g as unknown as Game), listSlug: slug });
    }
  }

  const lists = sourceLists.map((l) => ({ slug: l.slug, name: l.name }));
  const titre = scope === "mine" ? "🎮 Tous mes jeux" : "🎮 Tous les jeux";
  const sousTitre = scope === "mine"
    ? `${games.length} jeux · tes listes réunies (${sourceLists.length})`
    : `${games.length} jeux · toutes les listes réunies (${sourceLists.length}) · sélectionne-les pour en faire une liste`;

  return (
    <>
      <SiteHeader currentSlug="" currentName={titre.replace("🎮 ", "")} />
      <main className="mx-auto max-w-6xl px-4 py-6 pb-24">
        <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{titre}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{sousTitre}</p>
          </div>
          <AddGamesDialog slug={DEFAULT_LIST_SLUG} trigger={
            <Button size="lg" className="shrink-0 gap-2 px-6 text-base font-bold shadow-lg shadow-primary/30 transition hover:-translate-y-0.5">
              <Plus className="h-5 w-5" /> Ajouter des jeux
            </Button>
          } />
        </div>
        <GamesView
          games={games}
          list={{ id: "all", slug: "", name: titre }}
          canManage={false}
          lists={lists}
          ownedTitles={ownedTitles}
          showOwned={!!user}
        />
      </main>
      <div className="fixed bottom-5 right-5 z-30 sm:hidden">
        <AddGamesDialog slug={DEFAULT_LIST_SLUG} trigger={
          <Button size="lg" className="h-14 w-14 rounded-full p-0 shadow-xl shadow-primary/40" aria-label="Ajouter des jeux">
            <Plus className="h-6 w-6" />
          </Button>
        } />
      </div>
    </>
  );
}
