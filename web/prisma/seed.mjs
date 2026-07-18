import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createGames } from "../lib/store.mjs";

const src = fileURLToPath(new URL("../../jeux-enrichi.json", import.meta.url));
const games = JSON.parse(readFileSync(src, "utf8"));
const n = await createGames(games);
console.log(`✅ Seed : ${n} jeux insérés (sur ${games.length}).`);
process.exit(0);
