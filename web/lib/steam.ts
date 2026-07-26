export type SteamGame = { titre: string; image: string; steamAppId: string; plateforme: string };

const OPENID_ENDPOINT = "https://steamcommunity.com/openid/login";
const OPENID_NS = "http://specs.openid.net/auth/2.0";
const OPENID_IDENTIFIER_SELECT = "http://specs.openid.net/auth/2.0/identifier_select";

// Construit l'URL de redirection Steam OpenID 2.0 (login web, sans clé API).
export function steamOpenIdUrl(returnTo: string, realm: string): string {
  const p = new URLSearchParams({
    "openid.ns": OPENID_NS,
    "openid.mode": "checkid_setup",
    "openid.return_to": returnTo,
    "openid.realm": realm,
    "openid.identity": OPENID_IDENTIFIER_SELECT,
    "openid.claimed_id": OPENID_IDENTIFIER_SELECT,
  });
  return `${OPENID_ENDPOINT}?${p.toString()}`;
}

// Vérifie l'assertion OpenID renvoyée par Steam (ne JAMAIS faire confiance à claimed_id brut) :
// re-POST des paramètres avec mode=check_authentication. Retourne le SteamID64 si valide, sinon null.
export async function verifySteamOpenId(params: URLSearchParams): Promise<string | null> {
  if (params.get("openid.mode") !== "id_res") return null;
  const claimedId = params.get("openid.claimed_id") || "";
  const m = claimedId.match(/\/openid\/id\/(\d{17})$/);
  if (!m) return null;

  const body = new URLSearchParams();
  for (const [k, v] of params) body.set(k, v);
  body.set("openid.mode", "check_authentication");

  const txt = await fetch(OPENID_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  })
    .then((r) => r.text())
    .catch(() => "");

  return /is_valid\s*:\s*true/i.test(txt) ? m[1] : null;
}

type OwnedGame = { appid: number; name?: string; playtime_forever?: number };

// Récupère la bibliothèque Steam (jeux possédés) via la Web API + SteamID64.
// Profil « Détails du jeu » public requis, sinon la liste renvoyée est vide.
export async function fetchSteamLibrary(steamId: string, apiKey: string, max = 1000): Promise<SteamGame[]> {
  const u = new URL("https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/");
  u.searchParams.set("key", apiKey);
  u.searchParams.set("steamid", steamId);
  u.searchParams.set("include_appinfo", "1");
  u.searchParams.set("include_played_free_games", "1");
  u.searchParams.set("format", "json");

  const j = await fetch(u).then((r) => r.json()).catch(() => null);
  const games: OwnedGame[] = j?.response?.games ?? [];

  games.sort((a, b) => (b.playtime_forever ?? 0) - (a.playtime_forever ?? 0));

  const out: SteamGame[] = [];
  const seen = new Set<string>();
  for (const g of games) {
    const titre = (g.name || "").replace(/[™®©]/g, "").replace(/\s+/g, " ").trim();
    const key = titre.toLowerCase();
    if (!titre || seen.has(key)) continue;
    seen.add(key);
    out.push({
      titre,
      image: `https://cdn.cloudflare.steamstatic.com/steam/apps/${g.appid}/header.jpg`,
      steamAppId: String(g.appid),
      plateforme: "PC (Steam)",
    });
    if (out.length >= max) break;
  }
  return out;
}
