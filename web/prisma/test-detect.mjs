// Test manuel de la détection de jeux depuis des liens.
// node --env-file=.env.local prisma/test-detect.mjs [url…]
import { youtubeVideoGames, instagramGames, detectTitle, looksLikeMultiGameVideo, cleanDescription, hasLLM } from "../lib/enrich.mjs";

const env = {
  TWITCH_ID: process.env.TWITCH_ID, TWITCH_SECRET: process.env.TWITCH_SECRET,
  YOUTUBE_API_KEY: process.env.YOUTUBE_API_KEY,
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY, OPENAI_MODEL: process.env.OPENAI_MODEL,
  INSTAGRAM_OEMBED_TOKEN: process.env.INSTAGRAM_OEMBED_TOKEN,
};
console.log("LLM dispo :", hasLLM(env), "· Anthropic:", !!env.ANTHROPIC_API_KEY, "· OpenAI:", !!env.OPENAI_API_KEY);

const URLS = process.argv.slice(2).length ? process.argv.slice(2) : [
  "https://www.youtube.com/watch?v=1O6Qstncpnc",            // trailer d'un seul jeu (Hogwarts Legacy)
  "https://www.youtube.com/watch?v=lWJ8pOB0P4c",            // sélection multi-jeux
  "https://www.youtube.com/watch?v=8X2kIfS6fb8",            // autre trailer
  "https://www.instagram.com/p/C8QltyDIGVi/",               // post Instagram
];

for (const u of URLS) {
  console.log("\n═══", u);
  if (/instagram/.test(u)) {
    const r = await instagramGames(u, env);
    console.log("  jeux  :", r.games);
    if (r.error) console.log("  info  :", r.error);
    if (r.caption) console.log("  légende:", r.caption.slice(0, 160));
    continue;
  }
  const r = await youtubeVideoGames(u, env);
  console.log("  titre vidéo :", r.titreVideo);
  console.log("  type        :", r.multi ? "SÉLECTION (multi-jeux)" : "un seul jeu");
  console.log("  jeux        :", r.games);
  if (r.error) console.log("  erreur      :", r.error);
}
