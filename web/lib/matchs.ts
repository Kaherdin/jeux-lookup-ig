import type { Game } from "./types";

/**
 * « Mes matchs » : les jeux gardés pendant les sessions de « Trouve-moi un jeu ».
 *
 * Ils vivent dans le navigateur, pas en base. C'est délibéré : le mode fonctionne sans
 * compte — c'est la première chose qu'un visiteur essaiera — et une liste enregistrée
 * demande justement un geste explicite (« en faire une liste »). Entre les deux, il
 * fallait bien un endroit pour ce qu'on vient de garder, qui survive à un rechargement
 * et reste consultable depuis n'importe quelle page.
 *
 * On ne stocke que de quoi afficher une ligne et recréer une liste : mettre l'objet
 * Game entier gonflerait le stockage pour rien.
 */

export type Match = {
  id: string;
  titre: string;
  image: string | null;
  note: number | null;
  /** date d'ajout, pour montrer les derniers d'abord */
  le: string;
};

const CLE = "jeux-lookup:matchs";
const EVENEMENT = "matchs-modifies";
const MAX = 200;

/** Le stockage local jette dans plusieurs cas réels (navigation privée, quota, iframe) :
 *  aucune de ces situations ne doit casser la page, on retombe sur « pas de matchs ». */
function lire(): Match[] {
  if (typeof window === "undefined") return [];
  try {
    const brut = window.localStorage.getItem(CLE);
    const arr = brut ? JSON.parse(brut) : [];
    return Array.isArray(arr) ? arr.filter((m) => m && typeof m.id === "string") : [];
  } catch {
    return [];
  }
}

function ecrire(m: Match[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CLE, JSON.stringify(m.slice(0, MAX)));
  } catch { /* quota ou stockage refusé : tant pis, la session continue */ }
  // les autres composants de la page (barre du haut, bandeau du défilé) se resynchronisent
  window.dispatchEvent(new CustomEvent(EVENEMENT));
}

export const lireMatchs = lire;

export function ajouterMatch(g: Game): Match[] {
  const m = lire();
  if (m.some((x) => x.id === g.id)) return m;
  const suivant = [
    { id: g.id, titre: g.titre, image: g.image ?? null, note: g.note ?? g.metacritic ?? g.steamPct ?? null, le: new Date().toISOString() },
    ...m,
  ];
  ecrire(suivant);
  return suivant;
}

export function retirerMatch(id: string): Match[] {
  const suivant = lire().filter((x) => x.id !== id);
  ecrire(suivant);
  return suivant;
}

export function viderMatchs(): Match[] {
  ecrire([]);
  return [];
}

/**
 * S'abonner aux changements. `storage` couvre les AUTRES onglets, l'événement maison
 * couvre celui-ci — le navigateur n'émet pas `storage` pour l'onglet qui écrit.
 */
export function surMatchs(cb: (m: Match[]) => void): () => void {
  const relire = () => cb(lire());
  window.addEventListener(EVENEMENT, relire);
  window.addEventListener("storage", relire);
  return () => {
    window.removeEventListener(EVENEMENT, relire);
    window.removeEventListener("storage", relire);
  };
}

/** ouvre la fenêtre des matchs depuis n'importe où (le menu du compte, par exemple) */
export const OUVRIR_MATCHS = "ouvrir-matchs";
export const ouvrirMatchs = () => window.dispatchEvent(new CustomEvent(OUVRIR_MATCHS));
