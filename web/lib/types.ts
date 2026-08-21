import type { CategoryKey } from "./categories";

export type Prix = {
  meilleur?: number | null;
  devise?: string;
  store?: string;
  plusBasHisto?: number | null;
} | null;

/**
 * Prix PlayStation Store. Séparé de `Prix` (ITAD, boutiques PC) : ce n'est ni la même
 * source ni la même machine, et les deux doivent pouvoir s'afficher côte à côte.
 * `plusInclus` = compris dans l'abonnement PlayStation Plus, ce qui n'est pas un prix.
 */
export type PrixPsn = {
  prix: number;
  base: number;
  reducPct: number;
  devise: string;
  plusInclus?: boolean;
} | null;

export type Modes = {
  solo?: boolean;
  coop?: boolean;
  pvp?: boolean;
  multi?: boolean;
} | null;

export type ModesDetail = {
  coopOnline?: boolean;
  coopCouch?: boolean;
  coopLan?: boolean;
  pvpOnline?: boolean;
  pvpCouch?: boolean;
  pvpLan?: boolean;
  remotePlay?: boolean;
  crossPlatform?: boolean;
} | null;

export type Game = {
  id: string;
  titre: string;
  image: string | null;
  genre: string | null;
  univers: string | null;
  plateformes: string[];
  screenshots?: string[];
  trailer: string | null;
  trailerThumb?: string | null;
  trailerYoutube: string | null;
  sortieISO: string | null;
  sortiePrec: string | null;
  dispo: boolean;
  gratuit: boolean;
  gratuitMention: string | null;
  bonPlan: boolean;
  bienNote: boolean;
  comingSoon: boolean | null;
  prix: Prix;
  prixSteam: number | null;
  prixPsn: PrixPsn;
  reducPct: number;
  note: number | null;
  noteSource: string | null;
  metacritic: number | null;
  steamPct: number | null;
  steamAvis: number | null;
  joueursSteam: number | null;
  igdbVotes: number | null;
  modes: Modes;
  modesDetail: ModesDetail;
  nbJoueurs: string | null;
  nbJoueursMax: number | null;
  joueursLocalMax: number | null;
  joueursOnlineMax: number | null;
  themes: string | null;
  developpeur?: string | null;
  editeur?: string | null;
  description?: string | null;
  envergure: string | null;
  dureeVie: string | null;
  tailleEquipe?: string | null;
  urlSteam: string | null;
  urlStore: string | null;
  urlPsn: string | null;
  reel?: string | null;
  /** date d'ajout (à défaut, la date de création en base) */
  ajouteLe?: string | null;
  /** familles de jeux, calculées côté serveur pour ne pas les recalculer à chaque rendu */
  cats?: CategoryKey[];
  /** liste d'origine — renseigné uniquement dans les vues qui agrègent plusieurs listes */
  listSlug?: string;
};

export type PreviewGame = Partial<Game> & {
  titre: string;
  input?: string;
  source?: string;
  duplicate?: boolean;
  steamAppId?: string | null;
  corrected?: string;
};

export type ListMeta = {
  id: string;
  slug: string;
  name: string;
  description?: string | null;
  ownerId?: string | null;
};
