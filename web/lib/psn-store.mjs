/**
 * Prix relevé sur la fiche PlayStation Store.
 *
 * Sony ne publie pas d'API de prix, et ITAD — d'où viennent tous les autres prix du
 * catalogue — ne suit que des boutiques PC (33 boutiques, aucune console). Le prix
 * console se lit donc sur la page du store elle-même, qui est rendue côté serveur et
 * embarque ses données dans le HTML.
 *
 * C'est une lecture de page publique, pas un contrat : si Sony change son rendu, la
 * fonction renvoie `null` et le reste de l'enrichissement continue sans le prix PSN.
 * Rien d'autre ne doit en dépendre.
 */

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const MARQUEUR = '{"__typename":"Price"';
const ANTISLASH = String.fromCharCode(92);

/**
 * Lit l'objet JSON qui commence à `html[i]`. Un simple comptage d'accolades suffirait
 * presque, mais les textes du store en contiennent (« {0} jours restants ») : on saute
 * donc les chaînes, et leurs échappements.
 */
function objetA(html, i) {
  let prof = 0, dansStr = false, echap = false;
  for (let k = i; k < html.length; k++) {
    const c = html[k];
    if (dansStr) {
      if (echap) echap = false;
      else if (c === ANTISLASH) echap = true;
      else if (c === '"') dansStr = false;
      continue;
    }
    if (c === '"') dansStr = true;
    else if (c === "{") prof++;
    else if (c === "}" && --prof === 0) { try { return JSON.parse(html.slice(i, k + 1)); } catch { return null; } }
  }
  return null;
}

/** le store donne la devise en clair (« CHF ») dans chaque offre ; le texte n'est qu'un repli */
const deviseDe = (bloc) => bloc?.currencyCode || deviseTexte(bloc?.basePrice);

/** « CHF 19.90 » → CHF ; « €24,99 » → EUR ; « $19.99 » → USD */
function deviseTexte(txt) {
  const s = String(txt || "");
  const code = s.match(/\b([A-Z]{3})\b/);
  if (code) return code[1];
  if (s.includes("€")) return "EUR";
  if (s.includes("$")) return "USD";
  if (s.includes("£")) return "GBP";
  return "";
}

/**
 * Prix d'une fiche concept. Une fiche liste plusieurs éditions (standard, deluxe,
 * bundles) et plusieurs offres par édition : on retient la MOINS CHÈRE, c'est-à-dire
 * l'édition standard, celle dont on parle quand on dit « le prix du jeu ».
 *
 * « Inclus » (PlayStation Plus) n'est pas un prix d'achat : la valeur remisée vaut 0
 * alors que le jeu se vend toujours à son prix. On le retient comme une information à
 * part (`plusInclus`) sans jamais le confondre avec une gratuité.
 */
export function lirePrixPsn(html) {
  const blocs = [];
  for (let i = html.indexOf(MARQUEUR); i >= 0; i = html.indexOf(MARQUEUR, i + 1)) {
    const o = objetA(html, i);
    if (o) blocs.push(o);
  }
  if (!blocs.length) return null;

  const plusInclus = blocs.some((b) => (b.serviceBranding || []).some((s) => /PS_PLUS/i.test(s)) && b.discountedValue === 0);
  const achats = blocs.filter((b) => !/^inclus|^included/i.test(String(b.discountedPrice || "")));
  const bases = achats.map((b) => b.basePriceValue).filter((v) => Number.isFinite(v) && v > 0);
  const remises = achats.map((b) => b.discountedValue).filter((v) => Number.isFinite(v) && v > 0);

  // aucune offre payante : soit un free-to-play, soit une fiche sans prix exploitable
  if (!bases.length) {
    const gratuit = blocs.some((b) => b.basePriceValue === 0);
    return gratuit ? { prix: 0, base: 0, reducPct: 0, devise: deviseDe(blocs[0]), gratuit: true, plusInclus } : null;
  }

  const base = Math.min(...bases) / 100;
  const prix = remises.length ? Math.min(...remises) / 100 : base;
  return {
    prix: +prix.toFixed(2),
    base: +base.toFixed(2),
    reducPct: base > prix ? Math.round((1 - prix / base) * 100) : 0,
    devise: deviseDe(achats.find((b) => b.basePriceValue > 0)),
    gratuit: false,
    plusInclus,
  };
}

/**
 * Va chercher le prix sur le store. `pays` suit la devise du catalogue (CHF), pas la
 * langue de l'URL renvoyée par IGDB, qui pointe toujours sur la boutique américaine.
 */
export async function prixPsn(url, pays = "fr-ch") {
  const u = String(url || "").replace(/store\.playstation\.com\/[a-z]{2}-[a-z]{2}\//i, `store.playstation.com/${pays}/`);
  if (!/^https:\/\/store\.playstation\.com\//i.test(u)) return null;
  try {
    const r = await fetch(u, { headers: { "User-Agent": UA, "Accept-Language": "fr-CH,fr;q=0.9" } });
    if (!r.ok) return null;
    const prix = lirePrixPsn(await r.text());
    return prix ? { ...prix, url: u } : null;
  } catch {
    return null;
  }
}
