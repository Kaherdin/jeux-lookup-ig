import { readGames } from "../lib/store.mjs";
import GamesClient from "./GamesClient.jsx";

export const dynamic = "force-dynamic"; // toujours relire le Blob (ajouts visibles direct)

export default async function Page() {
  const games = await readGames();
  const gen = new Date().toISOString().slice(0, 16).replace("T", " ");
  return <GamesClient initial={games} gen={gen} />;
}
