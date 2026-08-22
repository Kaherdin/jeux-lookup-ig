import type { CategoryKey } from "./categories";

/**
 * Le questionnaire de « Trouve-moi un jeu ».
 *
 * Il ne pose que des questions qu'on se pose vraiment un soir de semaine — avec qui,
 * pour quoi faire, combien de temps — et jamais le vocabulaire de l'app. Personne ne
 * cherche « un jeu avec coopCouch et une envergure AA » : on cherche « un truc à faire
 * à quatre sur le canapé ce soir ».
 *
 * Les réponses ne produisent pas une requête : elles produisent des CRITÈRES, que
 * `lib/selection.ts` transforme en ordre de pertinence. Séparé de React, donc testable.
 */

/** Ce qu'on a compris de l'envie, une fois les questions passées. */
export type Criteres = {
  /** nombre de joueurs à table, 1 = solo */
  joueurs: number;
  /** ensemble contre le jeu, les uns contre les autres, ou peu importe */
  ensemble: "coop" | "versus" | null;
  /** true = même canapé, false = chacun chez soi, null = peu importe */
  local: boolean | null;
  /** familles de jeux souhaitées (vide = ouvert à tout) */
  familles: CategoryKey[];
  /** fourchette de durée de vie en heures, bornes incluses */
  dureeMax: number | null;
  dureeMin: number | null;
  /** clé de famille de plateformes (« playstation »), null = peu importe */
  plateforme: string | null;
  /** écarter ce qu'on possède déjà : on cherche quoi jouer, pas ce qu'on connaît */
  ecarterPossedes: boolean;
};

export const CRITERES_VIDES: Criteres = {
  joueurs: 1, ensemble: null, local: null, familles: [],
  dureeMax: null, dureeMin: null, plateforme: null, ecarterPossedes: true,
};

export type Choix = {
  id: string;
  label: string;
  emoji: string;
  /** précision affichée sous le libellé, quand le choix mérite un mot */
  aide?: string;
  /** ce que ce choix impose aux critères */
  applique: (c: Criteres) => Criteres;
};

export type Question = {
  id: string;
  titre: string;
  /** plusieurs réponses possibles (les envies), ou une seule (tout le reste) */
  multiple?: boolean;
  /**
   * Une question qui ne changerait plus rien ne doit pas être posée : à quoi bon
   * demander « coop ou chacun pour soi » à quelqu'un qui joue seul.
   */
  pertinente?: (c: Criteres) => boolean;
  choix: Choix[];
};

/** raccourci : un choix qui pose une valeur et n'y touche plus */
const pose = (patch: Partial<Criteres>) => (c: Criteres): Criteres => ({ ...c, ...patch });

export const QUESTIONS: Question[] = [
  {
    id: "joueurs",
    titre: "Vous êtes combien ce soir ?",
    choix: [
      { id: "solo", label: "Juste moi", emoji: "🎯", applique: pose({ joueurs: 1, ensemble: null, local: null }) },
      { id: "duo", label: "À deux", emoji: "👥", applique: pose({ joueurs: 2 }) },
      { id: "groupe", label: "Trois ou quatre", emoji: "👨‍👩‍👧", applique: pose({ joueurs: 4 }) },
      { id: "tablee", label: "Cinq ou plus", emoji: "🎉", aide: "grande tablée", applique: pose({ joueurs: 5 }) },
    ],
  },
  {
    id: "ensemble",
    titre: "Ensemble, ou les uns contre les autres ?",
    pertinente: (c) => c.joueurs > 1,
    choix: [
      { id: "coop", label: "Ensemble", emoji: "🤝", aide: "coopération", applique: pose({ ensemble: "coop" }) },
      { id: "versus", label: "Les uns contre les autres", emoji: "⚔️", applique: pose({ ensemble: "versus" }) },
      { id: "peu-importe", label: "L'un ou l'autre", emoji: "🤷", applique: pose({ ensemble: null }) },
    ],
  },
  {
    id: "local",
    titre: "Dans la même pièce, ou chacun chez soi ?",
    pertinente: (c) => c.joueurs > 1,
    choix: [
      { id: "canape", label: "Même canapé", emoji: "🛋️", aide: "un seul écran", applique: pose({ local: true }) },
      { id: "enligne", label: "Chacun chez soi", emoji: "🌐", aide: "en ligne", applique: pose({ local: false }) },
      { id: "peu-importe", label: "Peu importe", emoji: "🤷", applique: pose({ local: null }) },
    ],
  },
  {
    id: "envie",
    titre: "L'envie du moment ?",
    multiple: true,
    choix: [
      { id: "adrenaline", label: "De l'action", emoji: "💥", applique: (c) => ajoute(c, ["action", "fps"]) },
      { id: "histoire", label: "Une histoire", emoji: "🗺️", aide: "aventure, exploration", applique: (c) => ajoute(c, ["aventure", "rpg"]) },
      { id: "cerveau", label: "Se creuser la tête", emoji: "🧠", applique: (c) => ajoute(c, ["reflexion"]) },
      { id: "rigoler", label: "Rigoler", emoji: "🎉", aide: "party games", applique: (c) => ajoute(c, ["fun"]) },
      { id: "construire", label: "Construire, survivre", emoji: "🏕️", applique: (c) => ajoute(c, ["survie", "simulation"]) },
      { id: "peur", label: "Se faire peur", emoji: "😱", applique: (c) => ajoute(c, ["horreur"]) },
      { id: "sport", label: "Du sport, de la vitesse", emoji: "🏎️", applique: (c) => ajoute(c, ["sport"]) },
    ],
  },
  {
    id: "temps",
    titre: "Tu as combien de temps devant toi ?",
    choix: [
      { id: "soiree", label: "Une soirée", emoji: "🌙", aide: "moins de 10 h", applique: pose({ dureeMin: null, dureeMax: 10 }) },
      { id: "semaine", label: "Quelques soirées", emoji: "📅", aide: "10 à 30 h", applique: pose({ dureeMin: 10, dureeMax: 30 }) },
      { id: "long", label: "De quoi m'occuper", emoji: "⛰️", aide: "plus de 30 h", applique: pose({ dureeMin: 30, dureeMax: null }) },
      { id: "peu-importe", label: "Peu importe", emoji: "🤷", applique: pose({ dureeMin: null, dureeMax: null }) },
    ],
  },
  {
    id: "machine",
    titre: "Sur quelle machine ?",
    choix: [
      { id: "peu-importe", label: "Peu importe", emoji: "🤷", applique: pose({ plateforme: null }) },
      { id: "pc", label: "PC", emoji: "💻", applique: pose({ plateforme: "pc" }) },
      { id: "playstation", label: "PlayStation", emoji: "🎮", applique: pose({ plateforme: "playstation" }) },
      { id: "xbox", label: "Xbox", emoji: "🟩", applique: pose({ plateforme: "xbox" }) },
      { id: "nintendo", label: "Nintendo", emoji: "🍄", applique: pose({ plateforme: "nintendo" }) },
    ],
  },
];

function ajoute(c: Criteres, familles: CategoryKey[]): Criteres {
  const set = new Set(c.familles);
  for (const f of familles) set.add(f);
  return { ...c, familles: [...set] };
}

/** Les questions encore utiles, compte tenu de ce qu'on sait déjà. */
export const questionsPertinentes = (c: Criteres) => QUESTIONS.filter((q) => !q.pertinente || q.pertinente(c));

/**
 * Rejoue les réponses dans l'ordre pour obtenir les critères. On repart toujours de
 * zéro : revenir en arrière pour changer un choix doit effacer ce qu'il impliquait,
 * pas empiler une correction sur l'ancienne réponse.
 */
export function critereDe(reponses: Record<string, string[]>): Criteres {
  let c = { ...CRITERES_VIDES };
  for (const q of QUESTIONS) {
    // une réponse à une question qui n'a plus lieu d'être ne compte pas : revenir en
    // arrière pour dire « finalement je joue seul » doit effacer le « en coopération »
    // répondu juste avant, pas le laisser traîner dans les critères
    if (q.pertinente && !q.pertinente(c)) continue;
    for (const id of reponses[q.id] ?? []) {
      const choix = q.choix.find((x) => x.id === id);
      if (choix) c = choix.applique(c);
    }
  }
  return c;
}

/** Résumé en clair de ce qu'on a compris — affiché avant de lancer le défilé. */
export function resume(c: Criteres): string[] {
  const out: string[] = [];
  out.push(c.joueurs === 1 ? "🎯 Solo" : c.joueurs >= 5 ? "🎉 Cinq joueurs ou plus" : `👥 ${c.joueurs} joueurs`);
  if (c.ensemble === "coop") out.push("🤝 En coopération");
  if (c.ensemble === "versus") out.push("⚔️ Les uns contre les autres");
  if (c.local === true) out.push("🛋️ Sur le même écran");
  if (c.local === false) out.push("🌐 En ligne");
  if (c.dureeMax && !c.dureeMin) out.push(`🌙 Moins de ${c.dureeMax} h`);
  else if (c.dureeMin && c.dureeMax) out.push(`📅 ${c.dureeMin} à ${c.dureeMax} h`);
  else if (c.dureeMin) out.push(`⛰️ Plus de ${c.dureeMin} h`);
  return out;
}
