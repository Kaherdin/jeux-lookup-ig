import Link from "next/link";
import { getSession } from "@/lib/session";
import { getUserLists, getGames } from "@/lib/store";
import { SiteHeader } from "@/components/site-header";
import { GamesView } from "@/components/games-view";
import type { Game } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export default async function Page() {
  const session = await getSession();
  if (!session?.user) {
    return (
      <main className="mx-auto max-w-md px-4 py-16 text-center">
        <h1 className="mb-3 text-xl font-bold">🎮 Tous mes jeux</h1>
        <p className="mb-4 text-muted-foreground">Connecte-toi pour voir et filtrer tous tes jeux.</p>
        <Link href="/sign-in" className="text-primary underline">Se connecter</Link>
      </main>
    );
  }
  const lists = await getUserLists(session.user.id);
  const all = (await Promise.all(lists.map((l) => getGames(l.id)))).flat();
  // dédoublonne par titre (un même jeu peut être dans plusieurs listes)
  const seen = new Set<string>();
  const games = all.filter((g) => {
    const k = g.titre.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  return (
    <>
      <SiteHeader currentSlug="" currentName="Tous mes jeux" />
      <main className="mx-auto max-w-6xl px-4 py-6">
        <div className="mb-5">
          <h1 className="text-2xl font-bold tracking-tight">🎮 Tous mes jeux</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {games.length} jeux · toutes tes listes réunies ({lists.length}) · filtre par console, coop, canapé, joueurs…
          </p>
        </div>
        <GamesView games={games as unknown as Game[]} list={{ id: "all", slug: "", name: "Tous mes jeux" }} canEdit={false} />
      </main>
    </>
  );
}
