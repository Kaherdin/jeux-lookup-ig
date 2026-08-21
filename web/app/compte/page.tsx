import Link from "next/link";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { compterPossessions } from "@/lib/store";
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
  const [compte, nPsn, nSteam] = await Promise.all([
    prisma.user.findUnique({ where: { id: user.id }, select: { steamId: true } }),
    compterPossessions(user.id, "psn"),
    compterPossessions(user.id, "steam"),
  ]);

  return (
    <>
      <SiteHeader currentSlug="" currentName="Mon compte" />
      <main className="mx-auto max-w-3xl px-4 py-6">
        <h1 className="text-2xl font-bold tracking-tight">Mon compte</h1>
        <p className="mt-1 text-sm text-muted-foreground">{user.name || user.email}</p>

        <h2 className="mt-8 text-lg font-semibold">Mes bibliothèques</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Les jeux importés ici entrent dans le catalogue et sont marqués <strong>« J&apos;ai »</strong> partout
          dans l&apos;app — pratique pour repérer ce qu&apos;il te reste vraiment à acheter. Ce ne sont pas des
          listes : c&apos;est un fait attaché à ton compte, filtrable comme n&apos;importe quel critère.
        </p>

        <AccountSync
          steam={{ lie: !!compte?.steamId, jeux: nSteam }}
          psn={{ jeux: nPsn }}
        />
      </main>
    </>
  );
}
