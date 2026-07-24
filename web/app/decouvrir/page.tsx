import Link from "next/link";
import { getSession } from "@/lib/session";
import { getUserLists, getDefaultList } from "@/lib/store";
import { DiscoverView } from "@/components/discover-view";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export default async function Page() {
  const session = await getSession();
  if (!session?.user) {
    return (
      <main className="mx-auto max-w-md px-4 py-16 text-center">
        <h1 className="mb-3 text-xl font-bold">🔍 Trouver un jeu</h1>
        <p className="mb-4 text-muted-foreground">Connecte-toi pour rechercher des jeux et les ajouter à tes listes.</p>
        <Link href="/sign-in" className="text-primary underline">Se connecter</Link>
      </main>
    );
  }
  const [userLists, def] = await Promise.all([getUserLists(session.user.id), getDefaultList()]);
  const lists = userLists.map((l) => ({ slug: l.slug, name: l.name }));
  if (def && !lists.some((l) => l.slug === def.slug)) lists.push({ slug: def.slug, name: def.name });
  return <DiscoverView lists={lists} />;
}
