import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Identifiant d'un jeu dans une URL : « Halo: Campaign Evolved » → « halo-campaign-evolved ».
 * Les jeux n'ont pas de slug en base — on le calcule des deux côtés (lien et recherche),
 * ce qui évite une migration et reste stable tant que le titre ne change pas.
 */
/**
 * URL de la fiche d'un jeu. Dans une liste on garde son contexte (« retirer de cette
 * liste », fil d'Ariane) ; hors liste — la vue « tous les jeux » — la fiche est servie
 * par sa route globale, puisque le jeu n'appartient plus à une liste en particulier.
 */
export function gameHref(listSlug: string | null | undefined, titre: string): string {
  const j = slugifyTitle(titre);
  return listSlug ? `/l/${listSlug}/${j}` : `/jeu/${j}`;
}

export function slugifyTitle(titre: string): string {
  return (
    (titre || "")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "") // marques diacritiques : é → e
      .toLowerCase()
      .replace(/['’]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 90) || "jeu"
  );
}
