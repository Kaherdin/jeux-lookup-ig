import type { Game } from "./types";
import type { Criteres } from "./quiz";
import { categorize, famillesPlateformes } from "./categories";
import { dureeVal, noteVal, md } from "./tri";

/**
 * Le moteur de « Trouve-moi un jeu » : des critères d'un côté, le catalogue de l'autre,
 * et en sortie une file de propositions à trancher une par une.
 *
 * Deux principes, et ils s'opposent volontairement :
 *
 * 1. On n'ÉCARTE que ce qui est impossible — jouer à quatre sur un jeu solo, sur une
 *    machine qu'on n'a pas. Le reste se CLASSE. Une donnée absente n'a jamais écarté
 *    personne ici (c'est déjà la règle des fourchettes du panneau) : le catalogue ne
 *    connaît pas la durée de vie d'un jeu sur quatre.
 *
 * 2. Un ordre parfaitement obéissant est ennuyeux. Quelques jeux hors critères stricts
 *    sont glissés dans la file, marqués comme tels : c'est de là que viennent les
 *    « tiens, je n'y aurais pas pensé », et c'est la raison d'être de ce mode.
 */

export type Proposition = {
  jeu: Game;
  /** 0 à 100 — sert à ordonner, et à expliquer pourquoi ce jeu est là */
  score: number;
  /** pourquoi il est proposé, en clair, pour l'afficher sur la carte */
  raisons: string[];
  /** glissé volontairement hors des critères stricts */
  surprise?: boolean;
};

const cats = (g: Game) => g.cats ?? categorize(g);

/** Le jeu peut-il accueillir N joueurs ? « On ne sait pas » n'est pas « non ». */
function accepteJoueurs(g: Game, n: number): boolean | null {
  if (n <= 1) return true;
  const max = Math.max(g.nbJoueursMax ?? 0, g.joueursLocalMax ?? 0, g.joueursOnlineMax ?? 0);
  if (max > 0) return max >= n;
  const m = md(g);
  if (!m.coop && !m.pvp && !m.multi) return m.solo ? false : null; // solo déclaré = non
  return null; // multijoueur sans compte précis : on ne sait pas, donc on laisse passer
}

/** Jouable sur le même écran ? Le détail vient de Steam, souvent absent ailleurs. */
function surLeMemeEcran(g: Game): boolean | null {
  const d = (g.modesDetail ?? {}) as Record<string, boolean>;
  if (d.coopCouch || d.pvpCouch || d.splitscreen || d.coopLan || d.pvpLan || d.lancoop) return true;
  if ((g.joueursLocalMax ?? 0) >= 2) return true;
  if ((g.joueursOnlineMax ?? 0) >= 2 && (g.joueursLocalMax ?? 0) === 0) return false;
  return null;
}

function enLigne(g: Game): boolean | null {
  const d = (g.modesDetail ?? {}) as Record<string, boolean>;
  if (d.coopOnline || d.pvpOnline) return true;
  if ((g.joueursOnlineMax ?? 0) >= 2) return true;
  return null;
}

/** Ce qui rend un jeu IMPOSSIBLE, par opposition à simplement moins pertinent. */
function impossible(g: Game, c: Criteres, possedes: Set<string>): boolean {
  if (c.ecarterPossedes && possedes.has(g.titre.toLowerCase())) return true;
  if (c.plateforme && !famillesPlateformes(g.plateformes).includes(c.plateforme)) return true;
  if (accepteJoueurs(g, c.joueurs) === false) return true;
  const m = md(g);
  // un jeu qui ne propose QUE du solo ne peut pas servir une soirée à plusieurs
  if (c.joueurs > 1 && m.solo && !m.coop && !m.pvp && !m.multi) return true;
  if (c.ensemble === "coop" && m.pvp && !m.coop && !m.multi) return true;
  if (c.ensemble === "versus" && m.coop && !m.pvp && !m.multi) return true;
  return false;
}

/**
 * Note de pertinence sur 100, et les raisons en clair. Les poids disent ce qui compte :
 * l'envie et le nombre de joueurs pèsent plus que la durée, qu'on connaît mal, et la
 * qualité du jeu ne peut pas à elle seule rattraper un jeu hors sujet.
 */
export function noter(g: Game, c: Criteres): { score: number; raisons: string[] } {
  let score = 0;
  const raisons: string[] = [];

  // ── envie (30) : la part la plus lourde, c'est la question qui compte le plus
  if (c.familles.length) {
    const f = cats(g);
    const touche = c.familles.filter((k) => f.includes(k)).length;
    if (touche) {
      score += Math.min(30, 18 + 6 * touche);
      raisons.push(touche > 1 ? "correspond à plusieurs de tes envies" : "correspond à ton envie");
    }
  } else score += 15; // aucune envie exprimée : personne n'est avantagé

  // ── nombre de joueurs (20)
  const ok = accepteJoueurs(g, c.joueurs);
  if (c.joueurs > 1) {
    if (ok === true) { score += 20; raisons.push(`jouable à ${c.joueurs}`); }
    else if (ok === null) score += 8; // plausible, non confirmé
  } else {
    if (md(g).solo) { score += 20; raisons.push("bon en solo"); }
    else score += 8;
  }

  // ── ensemble ou les uns contre les autres (12)
  const m = md(g);
  if (c.ensemble === "coop" && m.coop) { score += 12; raisons.push("coopératif"); }
  else if (c.ensemble === "versus" && m.pvp) { score += 12; raisons.push("chacun pour soi"); }
  else if (c.ensemble && m.multi) score += 5;

  // ── même canapé ou en ligne (12)
  if (c.local === true) {
    const l = surLeMemeEcran(g);
    if (l === true) { score += 12; raisons.push("sur le même écran"); }
    else if (l === null) score += 5;
  } else if (c.local === false) {
    const o = enLigne(g);
    if (o === true) { score += 12; raisons.push("en ligne"); }
    else if (o === null) score += 5;
  }

  // ── durée de vie (11) : connue une fois sur deux, donc jamais éliminatoire
  const h = dureeVal(g);
  if (c.dureeMin != null || c.dureeMax != null) {
    if (h < 0) score += 5; // inconnue : ni récompensée ni punie
    else {
      const dedans = (c.dureeMin == null || h >= c.dureeMin) && (c.dureeMax == null || h <= c.dureeMax);
      if (dedans) { score += 11; raisons.push(`environ ${h} h`); }
      else {
        // hors fourchette : d'autant moins pénalisé qu'on en est proche
        const ecart = c.dureeMax != null && h > c.dureeMax ? h - c.dureeMax : (c.dureeMin ?? 0) - h;
        score += Math.max(0, 6 - Math.floor(ecart / 10));
      }
    }
  } else score += 6;

  // ── qualité et disponibilité (25) : ce qui départage à envie égale
  const n = noteVal(g);
  if (n != null) {
    score += Math.round((Math.max(0, Math.min(100, n)) / 100) * 18);
    if (n >= 85) raisons.push(`très bien noté (${n})`);
  } else score += 6;
  if (g.dispo) score += 3;
  if (g.gratuit) { score += 4; raisons.push("gratuit"); }
  else if (g.bonPlan) { score += 3; raisons.push("en promotion"); }

  return { score: Math.round(score), raisons: raisons.slice(0, 3) };
}

/** mélange déterministe d'un petit groupe, pour ne pas figer l'ordre à score égal */
function melange<T>(arr: T[], alea: () => number): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(alea() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export type OptionsSelection = {
  /** titres déjà possédés (Steam / PSN), en minuscules */
  possedes?: Set<string>;
  /** combien de cartes préparer */
  taille?: number;
  /** injectable pour que les tests soient reproductibles */
  alea?: () => number;
};

/**
 * La file de propositions. Le tri est global — jamais « les 20 premiers du catalogue
 * dans l'ordre où ils arrivent » — puis on glisse une surprise toutes les cinq cartes.
 */
export function proposer(jeux: Game[], criteres: Criteres, opts: OptionsSelection = {}): Proposition[] {
  const { possedes = new Set<string>(), taille = 30, alea = Math.random } = opts;

  const retenus: Proposition[] = [];
  const ecartes: Proposition[] = []; // impossibles au sens strict : réservoir à surprises
  for (const jeu of jeux) {
    const { score, raisons } = noter(jeu, criteres);
    if (impossible(jeu, criteres, possedes)) {
      // un jeu écarté pour la plateforme ou parce qu'on l'a déjà ne fera jamais une
      // bonne surprise ; un jeu écarté sur un mode de jeu, si.
      if (!criteres.plateforme && !possedes.has(jeu.titre.toLowerCase())) ecartes.push({ jeu, score, raisons });
      continue;
    }
    retenus.push({ jeu, score, raisons });
  }

  const parScore = (a: Proposition, b: Proposition) =>
    b.score - a.score || a.jeu.titre.localeCompare(b.jeu.titre);

  // à score égal, l'ordre alphabétique ferait remonter les mêmes jeux à chaque session
  const groupes = new Map<number, Proposition[]>();
  for (const p of retenus) groupes.set(p.score, [...(groupes.get(p.score) ?? []), p]);
  const tries = [...groupes.entries()]
    .sort((a, b) => b[0] - a[0])
    .flatMap(([, g]) => (g.length > 1 ? melange(g, alea) : g));

  // les surprises : bien notées, hors critères stricts, et jamais en première position
  const surprises = melange(ecartes.filter((p) => (noteVal(p.jeu) ?? 0) >= 75), alea).slice(0, Math.ceil(taille / 6));

  const file: Proposition[] = [];
  let s = 0;
  for (const p of tries) {
    if (file.length >= taille) break;
    file.push(p);
    // une surprise toutes les cinq cartes, à partir de la sixième
    if (file.length % 5 === 0 && s < surprises.length && file.length < taille) {
      file.push({ ...surprises[s++], surprise: true });
    }
  }
  // l'ordre de `file` est délibéré (pertinence + surprises intercalées) : l'appelant
  // le consomme tel quel, le retrier détruirait le seul travail fait ici
  return file.slice(0, taille);
}

/** Y a-t-il de quoi faire une session, ou faut-il aller chercher ailleurs ? */
export const tropPeu = (props: Proposition[]) => props.filter((p) => !p.surprise).length < 5;
