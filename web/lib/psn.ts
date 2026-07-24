import { exchangeNpssoForAccessCode, exchangeAccessCodeForAuthTokens, getUserTitles } from "psn-api";

export type PsnGame = { titre: string; image: string; plateforme: string };

function cleanTitle(s: string): string {
  return (s || "")
    .replace(/[™®©]/g, "")
    .replace(/\s+(Trophies|Trophy Set|Trophy Pack)$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Récupère la bibliothèque PSN (jeux avec trophées = quasi tout ce qui a été lancé) via un token NPSSO.
export async function fetchPsnLibrary(npsso: string, max = 500): Promise<PsnGame[]> {
  const code = await exchangeNpssoForAccessCode(npsso.trim());
  const auth = await exchangeAccessCodeForAuthTokens(code);
  const out: PsnGame[] = [];
  const seen = new Set<string>();
  let offset = 0;
  for (let i = 0; i < 5 && out.length < max; i++) {
    const res = await getUserTitles(auth, "me", { limit: 200, offset });
    for (const t of res.trophyTitles ?? []) {
      const titre = cleanTitle(t.trophyTitleName);
      const key = titre.toLowerCase();
      if (!titre || seen.has(key)) continue;
      seen.add(key);
      const p = String(t.trophyTitlePlatform || "");
      out.push({
        titre,
        image: t.trophyTitleIconUrl || "",
        plateforme: /PS5/i.test(p) ? "PS5" : /PS4/i.test(p) ? "PS4" : (p.split(",")[0] || "PS4"),
      });
    }
    if (res.nextOffset == null || !res.trophyTitles?.length) break;
    offset = res.nextOffset;
  }
  return out.slice(0, max);
}
