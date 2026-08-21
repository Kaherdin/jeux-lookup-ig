import type { Game } from "./types";
import { CATEGORIES, categorize } from "./categories";

/**
 * Lecture et tri des jeux — sans React, donc testable seul.
 *
 * Le tri s'applique TOUJOURS à la totalité de la liste filtrée : la vue n'en rend
 * qu'une vingtaine de lignes à la fois (virtualisation), mais elle les lit dans un
 * tableau déjà entièrement trié. Il n'existe nulle part de tri « par page ».
 */

export const https = (u?: string | null) => (u ? u.replace(/^http:/, "https:") : "");
/** prix PC seul : ITAD, sinon Steam. C'est celui de la colonne Prix. */
export const prixPcVal = (g: Game) => g.prix?.meilleur ?? g.prixSteam ?? null;
/**
 * Prix retenu pour TRIER : le prix PC, ou à défaut celui du PlayStation Store. Un jeu
 * console qui affiche 24.90 ne doit pas tomber en fin de tri comme s'il n'avait pas de
 * prix. L'affichage, lui, garde les deux séparés — ce ne sont pas les mêmes boutiques.
 */
export const prixVal = (g: Game) => prixPcVal(g) ?? g.prixPsn?.prix ?? null;
export const noteVal = (g: Game) => g.note ?? g.metacritic ?? g.steamPct ?? null;
export const md = (g: Game) => g.modes ?? {};
export const TODAY = new Date().toISOString().slice(0, 10);
/** ajouté il y a moins de 7 jours — étiquette temporaire et remontée en tête de liste */
export const IL_Y_A_7J = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
export const estRecent = (g: Game) => !!g.ajouteLe && g.ajouteLe >= IL_Y_A_7J;
/** pas encore sortie : le drapeau Steam, ou une date de sortie dans le futur */
export const aVenir = (g: Game) => !!g.comingSoon || (!!g.sortieISO && g.sortieISO > TODAY.slice(0, g.sortieISO.length));
/** envergure : « Indé » (LLM/heuristique) vs « AA » / « AAA » */
export const estInde = (g: Game) => /ind/i.test(g.envergure ?? "");
export const estGrosStudio = (g: Game) => /^aa/i.test(g.envergure ?? "");
/**
 * Clé de tri par date de sortie. Une date inconnue ou seulement approximative
 * (« Bientôt », « 2026 ») vaut une date LOINTAINE, pas une date vide : trié du plus
 * récent au plus ancien, ce qui n'est pas encore sorti doit être en HAUT de la liste.
 */
export const sortieVal = (g: Game) => {
  if (g.sortieISO) return g.sortieISO;
  const an = (g.sortiePrec ?? "").match(/\d{4}/);
  return an ? `${an[0]}-12-31` : "9999";
};
/**
 * Popularité : avis Steam cumulés, ou votes IGDB pour les jeux hors Steam.
 * Les joueurs connectés (`joueursSteam`) sont affichés à part — c'est une photo
 * prise au moment du scan, pas une valeur de tri fiable.
 */
export const popuVal = (g: Game) => Math.max(g.steamAvis ?? 0, g.igdbVotes ?? 0);
/** 1 234 → « 1,2k » ; 45 678 → « 46k » */
export const fmtNb = (n: number) =>
  n >= 10000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${(n / 1000).toFixed(1).replace(".", ",")}k` : String(n);
/** « ~12h », « 100h+ » → 12, 100 (pour trier ; -1 quand on ne sait pas) */
export const dureeVal = (g: Game) => { const m = (g.dureeVie ?? "").match(/\d+/); return m ? +m[0] : -1; };
export const SORT_VAL: Record<string, (g: Game) => number | string> = {
  titre: (g) => g.titre.toLowerCase(),
  prix: (g) => prixVal(g) ?? Infinity,
  note: (g) => noteVal(g) ?? -1,
  joueurs: (g) => g.nbJoueursMax ?? -1,
  sortie: sortieVal,
  duree: dureeVal,
  popu: popuVal,
  ajout: (g) => g.ajouteLe ?? "",
  // trie par famille principale, dans l'ordre de CATEGORIES (Aventure, Action, FPS…)
  type: (g) => {
    const k = (g.cats ?? categorize(g))[0];
    const i = CATEGORIES.findIndex((c) => c.key === k);
    return i < 0 ? 99 : i;
  },
};
export const SORT_DEFDIR: Record<string, number> = { titre: 1, prix: 1, note: -1, joueurs: -1, sortie: -1, duree: -1, popu: -1, ajout: -1, type: 1 };
export const SORT_LABEL: Record<string, string> = { note: "Note", prix: "Prix", joueurs: "Joueurs", sortie: "Sortie", duree: "Durée de vie", popu: "Popularité", ajout: "Date d\u2019ajout", type: "Type", titre: "Titre" };


/** ce dont le comparateur a besoin : le jeu, et ses étiquettes brutes (sous-types) */
export type Triable = { g: Game; toks: string[] };

/**
 * Fabrique le comparateur. `parSousType` bascule le tri « Type » sur l'étiquette
 * d'origine du jeu : dès qu'une famille est cochée, la famille ne distingue plus rien.
 * `epingler` fait remonter les ajouts de la semaine, quel que soit le critère.
 */
export function faireComparateur(o: {
  sortKey: string; sortDir: number; epingler: boolean; parSousType: boolean;
}) {
  const base = SORT_VAL[o.sortKey] ?? SORT_VAL.note;
  const val = o.parSousType
    ? (it: Triable) => (it.toks[0] ?? "").toLowerCase()
    : (it: Triable) => base(it.g);
  return (a: Triable, b: Triable) => {
    if (o.epingler) {
      const ra = estRecent(a.g) ? 1 : 0, rb = estRecent(b.g) ? 1 : 0;
      if (ra !== rb) return rb - ra;
    }
    const va = val(a), vb = val(b);
    const r = va < vb ? -1 : va > vb ? 1 : 0;
    // départage par titre : deux jeux de même note gardent un ordre stable
    return r * o.sortDir || a.g.titre.localeCompare(b.g.titre);
  };
}
