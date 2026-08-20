/**
 * Catégories de jeux — une poignée de familles lisibles, au lieu des ~80 genres
 * bruts hétérogènes (Steam en français, IGDB en anglais, LLM en texte libre :
 * « Action-RPG open world », « Survie (Palworld-like) », « Hack and slash/Beat 'em up »…).
 *
 * Un jeu peut appartenir à PLUSIEURS familles — « Action-RPG » = Action + RPG.
 * Le filtre est donc un OU : on garde le jeu s'il touche une des familles cochées.
 *
 * Chaque famille porte aussi ses ids IGDB (genres + thèmes) pour que la page
 * « Trouver un jeu » propose exactement les mêmes cases que la page des listes.
 */

export type CategoryKey =
  | "action" | "aventure" | "fps" | "rpg" | "reflexion"
  | "fun" | "survie" | "horreur" | "sport" | "simulation" | "autre";

export type Category = {
  key: CategoryKey;
  label: string;
  emoji: string;
  /** aide affichée en survol : ce que la famille regroupe */
  hint: string;
  /** motifs reconnus dans le champ genre libre (texte normalisé sans accent) */
  re: RegExp | null;
  igdbGenres: number[];
  igdbThemes: number[];
};

// ids IGDB — genres : 2 point&click, 4 combat, 5 tir, 7 musique, 8 plateforme, 9 puzzle,
// 10 course, 11 RTS, 12 RPG, 13 simulation, 14 sport, 15 stratégie, 16 tour par tour,
// 24 tactique, 25 hack&slash, 26 quiz, 30 flipper, 31 aventure, 32 indé, 33 arcade,
// 34 visual novel, 35 cartes/plateau, 36 MOBA.
// thèmes : 1 action, 19 horreur, 20 thriller, 21 survie, 23 infiltration, 27 comédie,
// 28 business, 31 drame, 33 bac à sable, 34 éducatif, 35 enfants, 38 open world,
// 39 guerre, 40 party, 41 4X, 43 mystère.
export const CATEGORIES: Category[] = [
  {
    key: "aventure", label: "Aventure", emoji: "🗺️",
    hint: "Aventure, action-aventure, exploration, narratif, monde ouvert",
    re: /aventure|adventur|exploration|explorer|narrat|histoire|story|open.?world|monde ouvert|point.?(and|&|-)?.?click|visual novel|episodique|metroidvania|plateforme|platform/,
    igdbGenres: [31, 8, 2, 34], igdbThemes: [38, 31],
  },
  {
    key: "action", label: "Action", emoji: "💥",
    hint: "Action, hack & slash, beat'em up, combat, arcade, roguelite, infiltration",
    re: /\baction|hack.?.?slash|beat.?.?em.?.?up|baston|combat|fighting|fight|arcade|musou|roguel(ite|ike)|bullet|survivor|infiltration|stealth|souls|ninja|parkour/,
    igdbGenres: [25, 4, 33], igdbThemes: [1, 23],
  },
  {
    key: "fps", label: "FPS / Tir", emoji: "🔫",
    hint: "FPS, TPS, shooters, extraction, battle royale, guerre",
    re: /fps|tps\b|shooter|shoot|\btir\b|tireur|battle.?royale|extraction|guerre|warfare|militaire|\bgun|sniper/,
    igdbGenres: [5], igdbThemes: [39],
  },
  {
    key: "rpg", label: "RPG", emoji: "⚔️",
    hint: "RPG, action-RPG, JRPG, MMO, souls-like, dungeon crawler",
    re: /\brpg\b|arpg|jrpg|mmo|jeu de role|role.?playing|souls.?like|soulslike|dungeon.?crawler|donjon|looter/,
    igdbGenres: [12], igdbThemes: [],
  },
  {
    key: "reflexion", label: "Réflexion", emoji: "🧠",
    hint: "Puzzle, stratégie, tactique, tour par tour, enquête, cartes & plateau",
    re: /puzzle|reflexion|casse.?tete|strateg|strategy|tactiq|tactical|tour par tour|turn.?based|tower.?defense|deduction|enquete|investigation|detective|mystere|quiz|trivia|cartes|\bcards?\b|plateau|\bboard\b|echecs|logique|\b4x\b|\brts\b|point.?(and|&|-)?.?click/,
    igdbGenres: [9, 15, 16, 24, 11, 26, 35, 2], igdbThemes: [41, 43],
  },
  {
    key: "fun", label: "Fun / Party", emoji: "🎉",
    hint: "Party games, casual, cozy, musique/rythme, jeux à faire à plusieurs sur le canapé",
    re: /party|\bfun\b|casual|cozy|\bcoz|quiz|trivia|musique|music|rythme|rhythm|danse|dance|karaoke|chant|humour|comedie|delire|social|mini.?jeux/,
    igdbGenres: [7, 26, 30], igdbThemes: [40, 27, 35],
  },
  {
    key: "survie", label: "Survie & Craft", emoji: "🏕️",
    hint: "Survie, craft, construction, base building, bac à sable",
    re: /survie|surviv|\bcraft|construction|building|builder|batir|sandbox|bac a sable|farming|ferme|agricult|colonie|colony|base.?build|minecraft/,
    igdbGenres: [], igdbThemes: [21, 33],
  },
  {
    key: "horreur", label: "Horreur", emoji: "😱",
    hint: "Horreur, survival-horror, thriller, zombies",
    re: /horreur|horror|epouvante|thriller|zombie|effroi|angoiss/,
    igdbGenres: [], igdbThemes: [19, 20],
  },
  {
    key: "sport", label: "Sport & Course", emoji: "🏎️",
    hint: "Sport, course, foot, conduite, glisse",
    re: /sport|course|racing|rally|\bf1\b|conduite|driving|pilotage|foot|basket|tennis|golf|hockey|\bski\b|snowboard|skate|surf|velo|boxe|combat sport|catch|peche|fishing/,
    igdbGenres: [14, 10], igdbThemes: [],
  },
  {
    key: "simulation", label: "Simulation & Gestion", emoji: "🌱",
    hint: "Simulation, gestion, tycoon, city builder, vie quotidienne",
    re: /simul|\bsim\b|gestion|manage|tycoon|city.?build|entreprise|business|elevage|restaurant|cuisine|vie quotidienne|dating/,
    igdbGenres: [13], igdbThemes: [28],
  },
  {
    key: "autre", label: "Autre", emoji: "🎲",
    hint: "Tout ce qui ne rentre dans aucune famille (ou genre inconnu)",
    re: null, igdbGenres: [], igdbThemes: [],
  },
];

export const CATEGORY_BY_KEY: Record<string, Category> = Object.fromEntries(
  CATEGORIES.map((c) => [c.key, c])
);

/**
 * Implications : une famille en entraîne une autre. Mieux vaut un jeu dans trop de
 * familles que pas assez — un extraction-RPG doit ressortir sur Action, FPS, RPG ET
 * Aventure, pas seulement sur l'étiquette exacte que le genre porte.
 */
const IMPLIES: Partial<Record<CategoryKey, CategoryKey[]>> = {
  rpg: ["aventure"],
  fps: ["action"],
};
// Mesuré sur la collection : 2,2 familles par jeu en moyenne, la plus large (Aventure)
// à 50 %. Ajouter « survie ⇒ aventure » et « horreur ⇒ aventure » montait Aventure à
// 71 % — une famille qui garde 3 jeux sur 4 ne filtre plus rien.

/** minuscules + sans accent : « Réflexion » et « reflexion » doivent matcher pareil */
function normalize(s: string) {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

/** ce qu'on lit pour classer un jeu — tout est optionnel */
export type Categorisable = {
  genre?: string | null;
  themes?: string | null;
  univers?: string | null;
  description?: string | null;
};

/**
 * Range un jeu dans ses familles. On ratisse large exprès : le genre seul est souvent
 * une étiquette unique et étroite (« Extraction »), alors qu'un même jeu est à la fois
 * aventure, action et RPG. On lit donc le genre, les thèmes, l'univers et le début de
 * la description, puis on applique les implications ci-dessus.
 *
 * Renvoie toujours au moins une clé (« autre » si vraiment rien ne matche).
 */
export function categorize(input?: Categorisable | string | null): CategoryKey[] {
  const g = typeof input === "string" ? { genre: input } : input ?? {};
  const hay = normalize(
    [g.genre, g.themes, g.univers, (g.description ?? "").slice(0, 400)].filter(Boolean).join(" ")
  );
  if (!hay.trim() || hay.trim() === "?") return ["autre"];
  const hit = new Set<CategoryKey>();
  for (const c of CATEGORIES) if (c.re && c.re.test(hay)) hit.add(c.key);
  for (const k of [...hit]) for (const extra of IMPLIES[k] ?? []) hit.add(extra);
  // ordre stable : celui de CATEGORIES, pas celui des correspondances
  const out = CATEGORIES.filter((c) => hit.has(c.key)).map((c) => c.key);
  return out.length ? out : ["autre"];
}
