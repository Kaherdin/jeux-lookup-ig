// One-off : importe la bibliothèque PSN (via NPSSO) dans la liste dédiée de l'utilisateur.
import { PrismaClient } from "@prisma/client";
import { exchangeNpssoForAccessCode, exchangeAccessCodeForAuthTokens, getUserTitles } from "psn-api";
import { toRow } from "../lib/game-row.mjs";

const prisma = new PrismaClient({ datasources: { db: { url: process.env.POSTGRES_URL } } });
const clean = (s) => (s || "").replace(/[™®©]/g, "").replace(/\s+(Trophies|Trophy Set|Trophy Pack)$/i, "").replace(/\s+/g, " ").trim();

async function fetchLib(npsso, max = 500) {
  const code = await exchangeNpssoForAccessCode(npsso.trim());
  const auth = await exchangeAccessCodeForAuthTokens(code);
  const out = [], seen = new Set(); let offset = 0;
  for (let i = 0; i < 5 && out.length < max; i++) {
    const res = await getUserTitles(auth, "me", { limit: 200, offset });
    for (const t of res.trophyTitles ?? []) {
      const titre = clean(t.trophyTitleName); const key = titre.toLowerCase();
      if (!titre || seen.has(key)) continue; seen.add(key);
      const p = String(t.trophyTitlePlatform || "");
      out.push({ titre, image: t.trophyTitleIconUrl || "", plateforme: /PS5/i.test(p) ? "PS5" : /PS4/i.test(p) ? "PS4" : (p.split(",")[0] || "PS4") });
    }
    if (res.nextOffset == null || !res.trophyTitles?.length) break; offset = res.nextOffset;
  }
  return out.slice(0, max);
}

async function main() {
  const user = await prisma.user.findFirst({ orderBy: { createdAt: "asc" } });
  const slug = `ps-${user.id.slice(0, 8).toLowerCase()}`;
  const lib = await fetchLib(process.env.NPSSO);
  const list = await prisma.list.upsert({
    where: { slug }, update: {},
    create: { slug, name: "🎮 Ma bibliothèque PlayStation", description: "Jeux joués sur PS4/PS5, importés depuis PSN.", isPublic: true, ownerId: user.id },
  });
  const rows = lib.map((g) => ({ ...toRow({ titre: g.titre, image: g.image, plateformes: [g.plateforme], ajouteLe: "2026-07-19" }), listId: list.id }));
  const res = await prisma.game.createMany({ data: rows, skipDuplicates: true });
  console.log(`${res.count}/${lib.length} jeux importés (${user.email}) → https://jeux-lookup-ig.vercel.app/l/${slug}`);
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
