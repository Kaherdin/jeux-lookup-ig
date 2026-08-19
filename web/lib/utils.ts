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
