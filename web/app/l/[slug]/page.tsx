import { Suspense } from "react";
import { ListScreen } from "@/components/list-screen";
import { SteamReturnToast } from "@/components/steam-return-toast";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return (
    <>
      <Suspense>
        <SteamReturnToast />
      </Suspense>
      <ListScreen slug={slug} />
    </>
  );
}
