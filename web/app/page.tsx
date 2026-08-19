import { AllGamesScreen } from "@/components/all-games-screen";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export default function Page() {
  return <AllGamesScreen scope="all" />;
}
