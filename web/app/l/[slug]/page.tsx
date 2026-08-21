import { Suspense } from "react";
import { redirect } from "next/navigation";
import { ListScreen } from "@/components/list-screen";
import { SteamReturnToast } from "@/components/steam-return-toast";
import { getListBySlug } from "@/lib/store";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export default async function Page({
  params, searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { slug } = await params;
  const sp = await searchParams;
  // Liste-FILTRE : ses critères vivent dans l'URL comme n'importe quel filtre. À
  // l'arrivée « nue » on les y installe — ensuite l'utilisateur les modifie librement,
  // et la liste reste ce qu'elle est : une vue enregistrée sur le catalogue.
  const list = await getListBySlug(slug);
  if (list?.filtre && !Object.keys(sp).length) redirect(`/l/${slug}?${list.filtre}`);
  return (
    <>
      <Suspense>
        <SteamReturnToast />
      </Suspense>
      <ListScreen slug={slug} />
    </>
  );
}
