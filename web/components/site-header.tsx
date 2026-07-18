import Link from "next/link";
import { Plus } from "lucide-react";
import { getSession } from "@/lib/session";
import { getPublicLists, getUserLists } from "@/lib/store";
import { ThemeToggle } from "./theme-toggle";
import { ListSwitcher } from "./list-switcher";
import { UserMenu } from "./user-menu";
import { CreateListDialog } from "./create-list-dialog";
import { Button } from "@/components/ui/button";

export async function SiteHeader({ currentSlug, currentName }: { currentSlug: string; currentName: string }) {
  const session = await getSession();
  const [publicRaw, userRaw] = await Promise.all([
    getPublicLists(),
    session?.user ? getUserLists(session.user.id) : Promise.resolve([]),
  ]);
  const publicLists = publicRaw.map((l) => ({ slug: l.slug, name: l.name, count: l._count.games }));
  const userLists = userRaw.map((l) => ({ slug: l.slug, name: l.name, count: l._count.games }));

  return (
    <header className="sticky top-0 z-30 border-b bg-background/80 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center gap-2 px-4 py-3">
        <Link href="/" className="mr-1 text-lg font-bold tracking-tight">🎮</Link>
        <ListSwitcher currentName={currentName} publicLists={publicLists} userLists={userLists} />
        {session?.user && (
          <CreateListDialog trigger={
            <Button variant="ghost" size="icon" aria-label="Nouvelle liste"><Plus className="h-5 w-5" /></Button>
          } />
        )}
        <div className="ml-auto flex items-center gap-1.5">
          <ThemeToggle />
          <UserMenu user={session?.user ?? null} />
        </div>
      </div>
    </header>
  );
}
