import Link from "next/link";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { getListBySlug, libSlugs } from "@/lib/store";
import { SiteHeader } from "@/components/site-header";
import { AccountSync } from "@/components/account-sync";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export default async function Page() {
  const session = await getSession();
  if (!session?.user) {
    return (
      <>
        <SiteHeader currentSlug="" currentName="Mon compte" />
        <main className="mx-auto max-w-md px-4 py-16 text-center">
          <h1 className="mb-3 text-xl font-bold">Mon compte</h1>
          <p className="mb-4 text-muted-foreground">Connecte-toi pour lier tes bibliothèques Steam et PlayStation.</p>
          <Link href="/sign-in" className="text-primary underline">Se connecter</Link>
        </main>
      </>
    );
  }

  const user = session.user;
  const { psn, steam } = libSlugs(user.id);
  const [compte, listePsn, listeSteam] = await Promise.all([
    prisma.user.findUnique({ where: { id: user.id }, select: { steamId: true } }),
    getListBySlug(psn),
    getListBySlug(steam),
  ]);
  const compter = async (id?: string) => (id ? prisma.game.count({ where: { listId: id } }) : 0);
  const [nPsn, nSteam] = await Promise.all([compter(listePsn?.id), compter(listeSteam?.id)]);

  return (
    <>
      <SiteHeader currentSlug="" currentName="Mon compte" />
      <main className="mx-auto max-w-3xl px-4 py-6">
        <h1 className="text-2xl font-bold tracking-tight">Mon compte</h1>
        <p className="mt-1 text-sm text-muted-foreground">{user.name || user.email}</p>

        <h2 className="mt-8 text-lg font-semibold">Mes bibliothèques</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Les jeux importés ici sont marqués <strong>« J&apos;ai »</strong> partout dans l&apos;app — pratique pour
          repérer ce qu&apos;il te reste vraiment à acheter.
        </p>

        <AccountSync
          steam={{ lie: !!compte?.steamId, jeux: nSteam, slug: listeSteam ? steam : null }}
          psn={{ jeux: nPsn, slug: listePsn ? psn : null }}
        />
      </main>
    </>
  );
}
