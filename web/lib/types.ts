export type Prix = {
  meilleur?: number | null;
  devise?: string;
  store?: string;
  plusBasHisto?: number | null;
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
  screenshots: string[];
  trailer: string | null;
  trailerThumb: string | null;
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
  reducPct: number;
  note: number | null;
  noteSource: string | null;
  metacritic: number | null;
  steamPct: number | null;
  modes: Modes;
  modesDetail: ModesDetail;
  nbJoueurs: string | null;
  nbJoueursMax: number | null;
  themes: string | null;
  developpeur: string | null;
  editeur: string | null;
  description: string | null;
  envergure: string | null;
  dureeVie: string | null;
  tailleEquipe: string | null;
  urlSteam: string | null;
  urlStore: string | null;
  urlPsn: string | null;
  reel: string | null;
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
