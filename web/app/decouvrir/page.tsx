import { getSession } from "@/lib/session";
import { getUserLists, getDefaultList } from "@/lib/store";
import { DiscoverView } from "@/components/discover-view";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export default async function Page() {
  const session = await getSession();
  // sans compte, on propose quand même la découverte : la cible est la liste collaborative
  const [userLists, def] = await Promise.all([
    session?.user ? getUserLists(session.user.id) : Promise.resolve([]),
    getDefaultList(),
  ]);
  const lists = userLists.map((l) => ({ slug: l.slug, name: l.name }));
  if (def && !lists.some((l) => l.slug === def.slug)) lists.push({ slug: def.slug, name: def.name });
  return <DiscoverView lists={lists} />;
}
