import Link from "next/link";
import { Plus, Search, Library, Sparkles } from "lucide-react";
import { getSession } from "@/lib/session";
import { getPublicLists, getUserLists } from "@/lib/store";
import { ThemeToggle } from "./theme-toggle";
import { ListSwitcher } from "./list-switcher";
import { UserMenu } from "./user-menu";
import { CreateListDialog } from "./create-list-dialog";
import { Button } from "@/components/ui/button";

export async function SiteHeader({
  currentSlug, currentName, canEdit = false,
}: { currentSlug: string; currentName: string; canEdit?: boolean }) {
  const session = await getSession();
  const [publicRaw, userRaw] = await Promise.all([
    getPublicLists(),
    session?.user ? getUserLists(session.user.id) : Promise.resolve([]),
  ]);
  const publicLists = publicRaw.map((l) => ({ slug: l.slug, name: l.name, count: l._count.items }));
  const userLists = userRaw.map((l) => ({ slug: l.slug, name: l.name, count: l._count.items }));

  return (
    <header className="sticky top-0 z-30 border-b bg-background/80 backdrop-blur">
      <div className="mx-auto flex max-w-[1500px] items-center gap-2 px-4 py-3">
        <Link href="/" className="mr-1 text-lg font-bold tracking-tight">🎮</Link>
        <ListSwitcher currentName={currentName} publicLists={publicLists} userLists={userLists} />
        {session?.user && (
          <CreateListDialog trigger={
            <Button variant="ghost" size="icon" aria-label="Nouvelle liste"><Plus className="h-5 w-5" /></Button>
          } />
        )}
        <div className="ml-auto flex items-center gap-1">
          {session?.user && (
            <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex">
              <Link href="/mes-jeux"><Library className="mr-1 h-4 w-4" /> Tous mes jeux</Link>
            </Button>
          )}
          {/* « Trouver » désignait la recherche IGDB par critères : le mot revient
              maintenant au questionnaire, et l'autre devient « Explorer », ce qu'il est */}
          <Button asChild variant="ghost" size="sm">
            <Link href="/trouver"><Sparkles className="mr-1 h-4 w-4" /> <span className="hidden sm:inline">Trouve-moi un jeu</span></Link>
          </Button>
          <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex">
            <Link href="/?vue=decouvrir"><Search className="mr-1 h-4 w-4" /> Explorer</Link>
          </Button>
          <ThemeToggle />
          <UserMenu
            user={session?.user ?? null}
            rescanSlug={canEdit && currentSlug ? currentSlug : undefined}
            rescanName={currentName}
          />
        </div>
      </div>
    </header>
  );
}
