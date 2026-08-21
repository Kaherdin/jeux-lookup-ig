"use client";
import { useState, useMemo, useEffect, useCallback, useRef, useDeferredValue, memo } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import { Search, SlidersHorizontal, X, Check } from "lucide-react";
import type { Game, ListMeta } from "@/lib/types";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn, slugifyTitle } from "@/lib/utils";
import { useAction } from "next-safe-action/hooks";
import { gameDetail } from "@/app/actions/games";
import { SelectionBar } from "@/components/selection-bar";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { CATEGORIES, CATEGORY_BY_KEY, categorize, type CategoryKey } from "@/lib/categories";

// la fiche (et sa lightbox) ne sont chargées qu'à la première ouverture de la modale :
// inutile de les faire porter à la page de liste, qui doit rester légère.
const GameDetail = dynamic(() => import("@/components/game-detail").then((m) => m.GameDetail), {
  loading: () => <div className="py-16 text-center text-sm text-muted-foreground">Chargement…</div>,
});

// même traitement que la fiche : l'onglet Découvrir n'est chargé qu'au moment où on l'ouvre
const DiscoverView = dynamic(() => import("@/components/discover-view").then((m) => m.DiscoverView), {
  loading: () => <div className="py-16 text-center text-sm text-muted-foreground">Chargement…</div>,
});

/** clic « normal » : sans modificateur ni clic du milieu — sinon on laisse le lien faire */
const clicSimple = (e: React.MouseEvent) => !(e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0);

const https = (u?: string | null) => (u ? u.replace(/^http:/, "https:") : "");
const prixVal = (g: Game) => g.prix?.meilleur ?? g.prixSteam ?? null;
const noteVal = (g: Game) => g.note ?? g.metacritic ?? g.steamPct ?? null;
const md = (g: Game) => g.modes ?? {};
const TODAY = new Date().toISOString().slice(0, 10);
/** ajouté il y a moins de 7 jours — étiquette temporaire et remontée en tête de liste */
const IL_Y_A_7J = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
const estRecent = (g: Game) => !!g.ajouteLe && g.ajouteLe >= IL_Y_A_7J;
/** pas encore sortie : le drapeau Steam, ou une date de sortie dans le futur */
const aVenir = (g: Game) => !!g.comingSoon || (!!g.sortieISO && g.sortieISO > TODAY.slice(0, g.sortieISO.length));
/** envergure : « Indé » (LLM/heuristique) vs « AA » / « AAA » */
const estInde = (g: Game) => /ind/i.test(g.envergure ?? "");
const estGrosStudio = (g: Game) => /^aa/i.test(g.envergure ?? "");
/**
 * Clé de tri par date de sortie. Une date inconnue ou seulement approximative
 * (« Bientôt », « 2026 ») vaut une date LOINTAINE, pas une date vide : trié du plus
 * récent au plus ancien, ce qui n'est pas encore sorti doit être en HAUT de la liste.
 */
const sortieVal = (g: Game) => {
  if (g.sortieISO) return g.sortieISO;
  const an = (g.sortiePrec ?? "").match(/\d{4}/);
  return an ? `${an[0]}-12-31` : "9999";
};
/**
 * Popularité : avis Steam cumulés, ou votes IGDB pour les jeux hors Steam.
 * Les joueurs connectés (`joueursSteam`) sont affichés à part — c'est une photo
 * prise au moment du scan, pas une valeur de tri fiable.
 */
const popuVal = (g: Game) => Math.max(g.steamAvis ?? 0, g.igdbVotes ?? 0);
/** 1 234 → « 1,2k » ; 45 678 → « 46k » */
const fmtNb = (n: number) =>
  n >= 10000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${(n / 1000).toFixed(1).replace(".", ",")}k` : String(n);
/** « ~12h », « 100h+ » → 12, 100 (pour trier ; -1 quand on ne sait pas) */
const dureeVal = (g: Game) => { const m = (g.dureeVie ?? "").match(/\d+/); return m ? +m[0] : -1; };
const noteColor = (n: number) => (n >= 85 ? "#3fb950" : n >= 75 ? "#f5c518" : n >= 60 ? "#ff8c42" : "#f85149");
const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];

/**
 * Une ligne = une grille, pas un <tr>. Le tableau HTML rendait la virtualisation
 * pénible (largeurs recalculées au fil du défilement) ; en grille, les colonnes sont
 * déclarées une fois pour toutes et on peut positionner les lignes librement.
 * Les colonnes tombent avec la largeur d'écran : 3 sur mobile, 5 dès md, 7 dès lg.
 */
const GRILLE =
  "grid grid-cols-[32px_minmax(0,1fr)_88px] gap-2 md:grid-cols-[36px_minmax(0,2fr)_minmax(150px,1fr)_120px_100px] lg:grid-cols-[36px_minmax(0,2fr)_minmax(170px,1fr)_130px_110px_90px_140px]";
/** hauteur approximative d'une ligne, affinée à la mesure */
const HAUTEUR_LIGNE = 116;

function fmtDate(iso: string | null) {
  if (!iso) return { txt: "", released: false };
  const p = iso.split("-");
  const txt = p.length >= 3 ? `${+p[2]} ${MOIS[+p[1] - 1]} ${p[0]}` : p.length === 2 ? `${MOIS[+p[1] - 1]} ${p[0]}` : p[0];
  const today = new Date().toISOString().slice(0, 10);
  return { txt, released: iso <= today.slice(0, iso.length) };
}
/** « 2026-08-14 » → « 14 août » (l'année n'apparaît que si ce n'est pas cette année) */
function fmtJour(iso: string) {
  const p = iso.split("-");
  if (p.length < 3) return iso;
  return `${+p[2]} ${MOIS[+p[1] - 1].slice(0, 4)}${p[0] === TODAY.slice(0, 4) ? "" : " " + p[0]}`;
}
function modesDetailText(g: Game) {
  const d = g.modesDetail ?? {};
  const out: string[] = [];
  const c: string[] = [];
  if (d.coopOnline) c.push("en ligne");
  if (d.coopCouch) c.push("écran partagé");
  if (d.coopLan) c.push("LAN");
  if (c.length) out.push("Coop " + c.join("/"));
  const p: string[] = [];
  if (d.pvpOnline) p.push("en ligne");
  if (d.pvpCouch) p.push("écran partagé");
  if (d.pvpLan) p.push("LAN");
  if (p.length) out.push("PvP " + p.join("/"));
  if (d.remotePlay) out.push("Remote Play");
  if (d.crossPlatform) out.push("cross-play");
  return out.join(" · ");
}

function Tag({ children, className, title }: { children: React.ReactNode; className?: string; title?: string }) {
  return <span title={title} className={cn("inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-semibold whitespace-nowrap", className)}>{children}</span>;
}

const SORT_VAL: Record<string, (g: Game) => number | string> = {
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
const SORT_DEFDIR: Record<string, number> = { titre: 1, prix: 1, note: -1, joueurs: -1, sortie: -1, duree: -1, popu: -1, ajout: -1, type: 1 };
const SORT_LABEL: Record<string, string> = { note: "Note", prix: "Prix", joueurs: "Joueurs", sortie: "Sortie", duree: "Durée de vie", popu: "Popularité", ajout: "Date d\u2019ajout", type: "Type", titre: "Titre" };

// filtres à cocher, regroupés par thème pour que le panneau reste lisible
type FilterDef = { key: string; label: string; test: (g: Game, owned: Set<string>) => boolean };
const GROUPS: { titre: string; items: FilterDef[] }[] = [
  {
    titre: "Statut",
    items: [
      { key: "dispo", label: "✅ Dispo", test: (g) => !!g.dispo },
      { key: "gratuit", label: "🆓 Gratuit", test: (g) => !!g.gratuit },
      { key: "bonPlan", label: "💸 Bon plan", test: (g) => !!g.bonPlan },
      { key: "bienNote", label: "⭐ Bien noté", test: (g) => !!g.bienNote },
      { key: "aVenir", label: "🔜 À venir", test: aVenir },
      { key: "sorti", label: "📅 Déjà sorti", test: (g) => !aVenir(g) },
    ],
  },
  {
    titre: "Studio",
    items: [
      { key: "inde", label: "🎨 Indé", test: estInde },
      { key: "gros", label: "🏢 Gros studio (AA/AAA)", test: estGrosStudio },
    ],
  },
  {
    titre: "Comment y jouer",
    items: [
      { key: "solo", label: "🎯 Solo", test: (g) => !!md(g).solo },
      { key: "coop", label: "👥 Coop", test: (g) => !!md(g).coop },
      { key: "pvp", label: "⚔️ PvP", test: (g) => !!md(g).pvp },
      {
        key: "canape", label: "🛋️ Canapé",
        test: (g) => {
          const d = (g.modesDetail ?? {}) as Record<string, boolean>;
          return !!(d.coopCouch || d.pvpCouch || d.coopLan || d.pvpLan || d.splitscreen || d.lancoop) || (g.joueursLocalMax ?? 0) >= 2;
        },
      },
      { key: "j4", label: "👨‍👩‍👧‍👦 4+ joueurs", test: (g) => (g.nbJoueursMax ?? 0) >= 4 },
    ],
  },
  {
    titre: "Ma bibliothèque",
    items: [
      { key: "possede", label: "✔ Je l'ai déjà", test: (g, owned) => owned.has(g.titre.toLowerCase()) },
      { key: "manque", label: "🎁 Pas encore", test: (g, owned) => !owned.has(g.titre.toLowerCase()) },
    ],
  },
];
const ALL_FILTERS = GROUPS.flatMap((g) => g.items);
const findFilter = (k: string) => ALL_FILTERS.find((f) => f.key === k);

/**
 * Filtres chiffrés : note, durée de vie, nombre de joueurs.
 * Chaque critère est une fourchette [min, max] ; aux bornes extrêmes il est inactif.
 * Un jeu dont l'info manque est GARDÉ par défaut — mieux vaut un résultat en trop
 * qu'un jeu écarté parce qu'on ne connaît pas sa durée de vie.
 */
type Bornes = [number, number];
const ANNEE = new Date().getFullYear();
const PLAGES: Record<string, { label: string; unite: string; opts: number[]; param: string }> = {
  note: { label: "Note", unite: "", opts: [0, 50, 60, 70, 80, 90, 100], param: "n" },
  duree: { label: "Durée de vie", unite: "h", opts: [0, 5, 10, 20, 40, 60, 100], param: "d" },
  joueurs: { label: "Joueurs", unite: "", opts: [1, 2, 3, 4, 6, 8], param: "j" },
  // la borne haute dépasse l'année en cours : les jeux à venir doivent rester dedans
  annee: { label: "Année de sortie", unite: "", opts: [1990, 2000, 2010, 2015, 2020, ANNEE - 2, ANNEE, ANNEE + 2], param: "a" },
};
const bornesPleines = (k: string): Bornes => {
  const o = PLAGES[k].opts;
  return [o[0], o[o.length - 1]];
};
const estPleine = (k: string, b: Bornes) => { const p = bornesPleines(k); return b[0] <= p[0] && b[1] >= p[1]; };
const litBornes = (k: string, v: string | null): Bornes => {
  const p = bornesPleines(k);
  const m = (v ?? "").match(/^(\d+)-(\d+)$/);
  return m ? [Math.max(+m[1], p[0]), Math.min(+m[2], p[1])] : p;
};
/** valeur du jeu pour un critère chiffré — null quand l'info manque */
const valeurPlage = (k: string, g: Game): number | null => {
  if (k === "note") return noteVal(g);
  if (k === "joueurs") return g.nbJoueursMax ?? null;
  if (k === "annee") {
    // sortieVal renvoie « 9999 » quand on ne sait pas : c'est une info manquante,
    // pas une sortie dans un futur lointain — le filtre doit la traiter comme telle.
    const an = +sortieVal(g).slice(0, 4);
    return an >= 9999 ? null : an;
  }
  const d = dureeVal(g);
  return d < 0 ? null : d;
};

/**
 * Sous-tags : les étiquettes brutes du jeu (« Extraction », « Roguelite », « Dark
 * fantasy »…) qu'on affiche SOUS la famille sélectionnée. La famille range, le
 * sous-tag précise — sans jamais rendre au filtre principal sa longue liste illisible.
 */
function tokensDe(g: Game): string[] {
  const vus = new Set<string>();
  const out: string[] = [];
  for (const brut of `${g.genre ?? ""},${g.themes ?? ""}`.split(/[,/·|]/)) {
    const t = brut.replace(/\([^)]*\)/g, "").trim();
    const k = t.toLowerCase();
    if (t.length < 2 || t.length > 28 || vus.has(k)) continue;
    vus.add(k);
    out.push(t);
  }
  return out;
}

/** un jeu + tout ce qui sert à le filtrer, calculé UNE fois pour toute la liste */
type Indexed = { g: Game; key: string; hay: string; cats: CategoryKey[]; toks: string[] };

const splitCsv = (s: string | null) => new Set((s ?? "").split(",").filter(Boolean));

export function GamesView({
  games, list, canManage, lists = [], ownedTitles = [], showOwned = false, gerables = [],
}: {
  games: Game[];
  list: ListMeta;
  canManage: boolean;
  lists?: { slug: string; name: string }[];
  /** slugs des listes que l'utilisateur peut modifier — la vue agrégée en mêle plusieurs */
  gerables?: string[];
  ownedTitles?: string[];
  showOwned?: boolean;
}) {
  // ── état des filtres : local, jamais routé ──────────────────────────
  // Avant, la source de vérité était l'URL via router.replace() : chaque frappe et
  // chaque clic déclenchait une navigation Next → re-render serveur → re-requête de
  // TOUTE la liste. On lit l'URL une fois au montage (liens partagés, rechargement),
  // puis on n'y écrit plus qu'avec history.replaceState — zéro aller-retour serveur.
  const sp = useSearchParams();
  const [q, setQ] = useState(() => sp.get("q") ?? "");
  const [cats, setCats] = useState<Set<string>>(() => {
    const s = splitCsv(sp.get("c"));
    // ancien lien « ?g=Souls-like » (genre exact) → on retombe sur sa famille
    const legacy = sp.get("g");
    if (legacy) for (const k of categorize(legacy)) if (k !== "autre") s.add(k);
    return s;
  });
  const [sousTags, setSousTags] = useState<Set<string>>(() => splitCsv(sp.get("st")));
  const [platformFilter, setPlatformFilter] = useState(() => sp.get("p") ?? "all");
  const [active, setActive] = useState<Set<string>>(() => splitCsv(sp.get("f")));
  const [sortKey, setSortKey] = useState(() => sp.get("tri") ?? "note");
  const [sortDir, setSortDir] = useState(() => {
    const s = sp.get("sens");
    return s ? (s === "asc" ? 1 : -1) : SORT_DEFDIR[sp.get("tri") ?? "note"] ?? -1;
  });

  const [plages, setPlages] = useState<Record<string, Bornes>>(() =>
    Object.fromEntries(Object.entries(PLAGES).map(([k, def]) => [k, litBornes(k, sp.get(def.param))]))
  );
  // un jeu sans note / sans durée connue reste visible, sauf si on décoche
  const [sansInfo, setSansInfo] = useState(() => sp.get("si") !== "0");

  const [panel, setPanel] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // les ajouts récents remontent en tête ; débrayable, parce que ça bouscule le tri
  const [epingler, setEpingler] = useState(() => sp.get("ep") !== "0");
  const [fiche, setFiche] = useState<Game | null>(null);
  const [vue, setVue] = useState<"collection" | "decouvrir">(() => (sp.get("vue") === "decouvrir" ? "decouvrir" : "collection"));

  // la frappe reste fluide : le filtrage utilise une valeur « en retard » que React
  // recalcule en tâche de fond pendant que l'input, lui, répond au clavier.
  const deferredQ = useDeferredValue(q);
  const qq = deferredQ.toLowerCase().trim();

  // ── URL en écriture seule, sans navigation ──────────────────────────
  const skipFirst = useRef(true);
  useEffect(() => {
    if (skipFirst.current) { skipFirst.current = false; return; }
    const t = setTimeout(() => {
      const p = new URLSearchParams(window.location.search);
      const put = (k: string, v: string | null) => (v ? p.set(k, v) : p.delete(k));
      put("q", q.trim() || null);
      put("c", [...cats].join(",") || null);
      put("g", null); // l'ancien paramètre « genre exact » n'existe plus
      put("st", [...sousTags].join(",") || null);
      put("p", platformFilter === "all" ? null : platformFilter);
      put("f", [...active].join(",") || null);
      for (const [k, def] of Object.entries(PLAGES)) {
        const b = plages[k];
        put(def.param, estPleine(k, b) ? null : `${b[0]}-${b[1]}`);
      }
      put("si", sansInfo ? null : "0");
      put("ep", epingler ? null : "0");
      put("vue", vue === "decouvrir" ? "decouvrir" : null);
      put("tri", sortKey === "note" ? null : sortKey);
      put("sens", sortDir === (SORT_DEFDIR[sortKey] ?? -1) ? null : sortDir === 1 ? "asc" : "desc");
      const qs = p.toString();
      const url = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
      if (url !== window.location.pathname + window.location.search) window.history.replaceState(null, "", url);
    }, 250);
    return () => clearTimeout(t);
  }, [q, cats, sousTags, platformFilter, active, plages, sansInfo, sortKey, sortDir, vue, epingler]);

  const owned = useMemo(() => new Set(ownedTitles.map((t) => t.toLowerCase())), [ownedTitles]);
  const groups = useMemo(() => GROUPS.filter((g) => g.titre !== "Ma bibliothèque" || showOwned), [showOwned]);

  // ── index calculé une seule fois ────────────────────────────────────
  // minuscules de recherche + familles de genres : sinon on refaisait toLowerCase()
  // et l'analyse du genre pour chaque jeu, à chaque frappe, pour chaque compteur.
  const index = useMemo<Indexed[]>(
    () => games.map((g) => ({
      g,
      key: g.titre.toLowerCase(),
      hay: `${g.titre} ${g.genre ?? ""} ${g.univers ?? ""}`.toLowerCase(),
      cats: g.cats ?? categorize(g),
      toks: tokensDe(g),
    })),
    [games]
  );

  const platforms = useMemo(() => {
    const c = new Map<string, number>();
    for (const g of games) for (const p of g.plateformes ?? []) c.set(p, (c.get(p) ?? 0) + 1);
    return [...c.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t);
  }, [games]);

  // familles présentes dans cette liste, les plus fournies d'abord
  const catList = useMemo(() => {
    const c = new Map<string, number>();
    for (const it of index) for (const k of it.cats) c.set(k, (c.get(k) ?? 0) + 1);
    return CATEGORIES.filter((cat) => c.has(cat.key)).sort((a, b) => (c.get(b.key) ?? 0) - (c.get(a.key) ?? 0));
  }, [index]);

  // les sous-tags n'ont de sens qu'une fois une famille choisie : ce sont ses nuances
  const sousTagsDispo = useMemo(() => {
    if (!cats.size) return [] as { label: string; n: number }[];
    const c = new Map<string, { label: string; n: number }>();
    for (const it of index) {
      if (!it.cats.some((k) => cats.has(k))) continue;
      for (const t of it.toks) {
        const k = t.toLowerCase();
        const e = c.get(k) ?? { label: t, n: 0 };
        e.n++;
        c.set(k, e);
      }
    }
    return [...c.values()].filter((e) => e.n >= 2).sort((a, b) => b.n - a.n).slice(0, 20);
  }, [index, cats]);

  // ── filtrage ────────────────────────────────────────────────────────
  // `except` permet de compter ce que donnerait CHAQUE filtre sans lui-même :
  // les compteurs affichés tiennent compte des autres critères actifs.
  const keep = useCallback((it: Indexed, except?: string) => {
    if (except !== "q" && qq && !it.hay.includes(qq)) return false;
    if (except !== "cat" && cats.size && !it.cats.some((k) => cats.has(k))) return false;
    if (except !== "stag" && sousTags.size && !it.toks.some((t) => sousTags.has(t.toLowerCase()))) return false;
    if (except !== "plat" && platformFilter !== "all" && !(it.g.plateformes ?? []).includes(platformFilter)) return false;
    for (const k of active) {
      if (k === except) continue;
      const f = findFilter(k);
      if (f && !f.test(it.g, owned)) return false;
    }
    for (const k of Object.keys(PLAGES)) {
      const b = plages[k];
      if (estPleine(k, b)) continue;
      const v = valeurPlage(k, it.g);
      if (v == null) { if (!sansInfo) return false; continue; }
      if (v < b[0] || v > b[1]) return false;
    }
    return true;
  }, [qq, cats, sousTags, platformFilter, active, owned, plages, sansInfo]);

  const shown = useMemo(() => {
    const l = index.filter((it) => keep(it));
    const base = SORT_VAL[sortKey] ?? SORT_VAL.note;
    // « Type » trie par famille ; mais dès qu'une famille est cochée, la famille ne
    // distingue plus rien — on trie alors par SOUS-type, l'étiquette d'origine du jeu.
    const val = sortKey === "type" && cats.size
      ? (it: Indexed) => (it.toks[0] ?? "").toLowerCase()
      : (it: Indexed) => base(it.g);
    l.sort((a, b) => {
      // ce qu'on vient d'ajouter reste en tête quel que soit le tri, pendant 7 jours
      if (epingler) {
        const ra = estRecent(a.g) ? 1 : 0, rb = estRecent(b.g) ? 1 : 0;
        if (ra !== rb) return rb - ra;
      }
      const va = val(a), vb = val(b);
      const r = va < vb ? -1 : va > vb ? 1 : 0;
      return r * sortDir || a.g.titre.localeCompare(b.g.titre);
    });
    return l;
  }, [index, keep, sortKey, sortDir, cats, epingler]);

  // compteurs : seulement quand le panneau est ouvert — inutile de payer 11 passes sinon
  const counts = useMemo(() => {
    const out: Record<string, number> = {};
    if (!panel) return out;
    for (const f of ALL_FILTERS) {
      let n = 0;
      for (const it of index) if (f.test(it.g, owned) && keep(it, f.key)) n++;
      out[f.key] = n;
    }
    for (const cat of CATEGORIES) {
      let n = 0;
      for (const it of index) if (it.cats.includes(cat.key) && keep(it, "cat")) n++;
      out["cat:" + cat.key] = n;
    }
    return out;
  }, [panel, index, keep, owned]);

  const stats = useMemo(() => {
    const base: [string, number][] = [
      ["Jeux", games.length], ["Dispo", games.filter((g) => g.dispo).length],
      ["Gratuits", games.filter((g) => g.gratuit).length], ["Bons plans", games.filter((g) => g.bonPlan).length],
      ["Coop", games.filter((g) => md(g).coop).length],
    ];
    if (showOwned) base.push(["Déjà à moi", games.filter((g) => owned.has(g.titre.toLowerCase())).length]);
    else base.push(["PvP", games.filter((g) => md(g).pvp).length]);
    return base;
  }, [games, owned, showOwned]);

  const toggleFilter = useCallback((k: string) => {
    setActive((prev) => {
      const n = new Set(prev);
      n.has(k) ? n.delete(k) : n.add(k);
      // « je l'ai déjà » et « pas encore » s'excluent
      if (k === "possede") n.delete("manque");
      if (k === "manque") n.delete("possede");
      if (k === "aVenir") n.delete("sorti");
      if (k === "sorti") n.delete("aVenir");
      if (k === "inde") n.delete("gros");
      if (k === "gros") n.delete("inde");
      return n;
    });
  }, []);

  const toggleCat = useCallback((k: string) => {
    setCats((prev) => {
      const n = new Set(prev);
      n.has(k) ? n.delete(k) : n.add(k);
      return n;
    });
    setSousTags(new Set()); // les nuances de l'ancienne famille n'ont plus cours
  }, []);

  const toggleSousTag = useCallback((t: string) => {
    setSousTags((prev) => {
      const n = new Set(prev);
      const k = t.toLowerCase();
      n.has(k) ? n.delete(k) : n.add(k);
      return n;
    });
  }, []);

  function resetAll() {
    setQ("");
    setCats(new Set());
    setSousTags(new Set());
    setPlatformFilter("all");
    setActive(new Set());
    setPlages(Object.fromEntries(Object.keys(PLAGES).map((k) => [k, bornesPleines(k)])));
  }
  const nbPlages = Object.keys(PLAGES).filter((k) => !estPleine(k, plages[k])).length;
  const nbActifs = active.size + cats.size + sousTags.size + nbPlages + (platformFilter !== "all" ? 1 : 0) + (q ? 1 : 0);

  const changeSort = (k: string) => {
    if (k === sortKey) setSortDir((d) => -d);
    else { setSortKey(k); setSortDir(SORT_DEFDIR[k] ?? -1); }
  };
  const arrow = (k: string) => (sortKey === k ? (sortDir === 1 ? " ▲" : " ▼") : "");

  const hero = useMemo(
    () => games.filter((g) => g.dispo && g.bienNote).sort((a, b) => (noteVal(b) ?? 0) - (noteVal(a) ?? 0)).slice(0, 10),
    [games]
  );

  // le tableau ne transporte plus les captures ni la description : on va chercher le
  // reste de la fiche à l'ouverture, et on l'affiche par-dessus ce qu'on a déjà.
  const detail = useAction(gameDetail);
  const onOpen = useCallback((g: Game) => { setFiche(g); detail.execute({ id: g.id }); }, [detail]);
  const complet = detail.result?.data?.game as unknown as Game | undefined;
  const dansListes = detail.result?.data?.listes ?? [];
  const ficheAffichee = fiche && complet?.id === fiche.id ? { ...fiche, ...complet } : fiche;

  const onCheck = useCallback((id: string, c: boolean) => {
    setSelected((prev) => { const n = new Set(prev); c ? n.add(id) : n.delete(id); return n; });
  }, []);

  /**
   * Virtualisation : on ne rend que la vingtaine de lignes visibles, quelle que soit
   * la taille de la liste. Le tri et le filtre, eux, portent toujours sur la TOTALITÉ
   * — plus de « afficher plus » qui découpait le résultat après coup.
   * Ancrée sur le défilement de la page : pas d'ascenseur interne.
   */
  const listeRef = useRef<HTMLDivElement>(null);
  const [decalage, setDecalage] = useState(0);
  // volontairement sans tableau de dépendances : la position de la liste bouge dès que
  // le panneau s'ouvre, qu'une puce apparaît ou que l'écran change. React ne re-rend
  // pas quand la mesure est identique, donc ça converge au lieu de boucler.
  useEffect(() => {
    const maj = () => setDecalage(listeRef.current?.offsetTop ?? 0);
    maj();
    window.addEventListener("resize", maj);
    return () => window.removeEventListener("resize", maj);
  });
  const virt = useWindowVirtualizer({
    count: shown.length,
    estimateSize: () => HAUTEUR_LIGNE,
    overscan: 8,
    scrollMargin: decalage,
  });

  const allShownSelected = shown.length > 0 && shown.every((it) => selected.has(it.g.id));
  function toggleSelectAll() {
    setSelected(allShownSelected ? new Set() : new Set(shown.map((it) => it.g.id)));
  }
  const selectedGames = useMemo(() => games.filter((g) => selected.has(g.id)), [games, selected]);

  /**
   * Les critères du panneau, traduits pour la recherche IGDB : mêmes familles, même
   * console, mêmes modes, même note et même nombre de joueurs. On ne demande pas deux
   * fois la même chose à l'utilisateur selon l'onglet où il se trouve.
   */
  const criteres = useMemo(() => ({
    familles: [...cats],
    plateforme: platformFilter,
    solo: active.has("solo"),
    coop: active.has("coop"),
    pvp: active.has("pvp"),
    canape: active.has("canape"),
    noteMin: estPleine("note", plages.note) ? 0 : plages.note[0],
    joueursMin: Math.max(estPleine("joueurs", plages.joueurs) ? 0 : plages.joueurs[0], active.has("j4") ? 4 : 0),
  }), [cats, platformFilter, active, plages]);

  const onglets: [typeof vue, string][] = [
    ["collection", `Ma collection (${games.length})`],
    ["decouvrir", "Découvrir de nouveaux jeux"],
  ];

  return (
    <div className="space-y-5">
      {/* deux façons de chercher, un seul endroit : dans mes listes, ou dans tout IGDB */}
      <div className="flex gap-1 border-b">
        {onglets.map(([k, l]) => (
          <button key={k} onClick={() => setVue(k)}
            className={cn("-mb-px border-b-2 px-3 py-2 text-sm font-semibold transition",
              vue === k ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}>
            {l}
          </button>
        ))}
      </div>

      {/* barre de commande : la recherche vit dans le panneau quand il est ouvert,
          pour n'avoir qu'un seul endroit où poser ses critères */}
      <div className="flex flex-wrap items-center gap-2.5">
        {!panel && (
          <div className="relative min-w-[220px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input placeholder="Rechercher un titre, un genre, un univers…" value={q}
              onChange={(e) => setQ(e.target.value)} className="pl-9" />
          </div>
        )}
        <Button variant={panel || nbActifs ? "default" : "outline"} onClick={() => setPanel((v) => !v)}
          className={panel ? "flex-1 justify-start sm:flex-none sm:justify-center" : ""}>
          <SlidersHorizontal className="mr-1 h-4 w-4" /> Filtres{nbActifs ? ` (${nbActifs})` : ""}
        </Button>
        {vue === "collection" && (
          <>
            <Select value={sortKey} onValueChange={(v) => { setSortKey(v); setSortDir(SORT_DEFDIR[v] ?? -1); }}>
              <SelectTrigger className="w-[150px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(SORT_LABEL).map(([k, l]) => <SelectItem key={k} value={k}>Tri : {l}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button variant="outline" size="icon" title="Inverser le sens"
              onClick={() => setSortDir((d) => -d)}>{sortDir === 1 ? "▲" : "▼"}</Button>
          </>
        )}
      </div>

      {/* filtres actifs, retirables un par un */}
      {nbActifs > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {q && <ActiveChip label={`« ${q} »`} onRemove={() => setQ("")} />}
          {[...cats].map((k) => (
            <ActiveChip key={k} label={`${CATEGORY_BY_KEY[k]?.emoji ?? ""} ${CATEGORY_BY_KEY[k]?.label ?? k}`} onRemove={() => toggleCat(k)} />
          ))}
          {[...sousTags].map((t) => (
            <ActiveChip key={t} label={t} onRemove={() => toggleSousTag(t)} />
          ))}
          {Object.entries(PLAGES).filter(([k]) => !estPleine(k, plages[k])).map(([k, def]) => (
            <ActiveChip key={k} label={`${def.label} ${plages[k][0]}–${plages[k][1]}${def.unite}`}
              onRemove={() => setPlages((p) => ({ ...p, [k]: bornesPleines(k) }))} />
          ))}
          {platformFilter !== "all" && <ActiveChip label={`Console : ${platformFilter}`} onRemove={() => setPlatformFilter("all")} />}
          {[...active].map((k) => (
            <ActiveChip key={k} label={findFilter(k)?.label ?? k} onRemove={() => toggleFilter(k)} />
          ))}
          <Button variant="ghost" size="sm" onClick={resetAll}>Tout effacer</Button>
        </div>
      )}

      {/* ── panneau : un seul endroit pour chercher et affiner ─────────── */}
      {panel && (
        <div className="space-y-5 rounded-2xl border bg-card p-4 shadow-sm sm:p-5">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
            <Input autoFocus placeholder="Rechercher un titre, un genre, un univers…" value={q}
              onChange={(e) => setQ(e.target.value)} className="h-12 pl-11 pr-10 text-base" />
            {q && (
              <button onClick={() => setQ("")} aria-label="Effacer la recherche"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground transition hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          <Bloc titre="Type de jeu">
            <div className="flex flex-wrap gap-2">
              {catList.map((cat) => {
                const on = cats.has(cat.key);
                const n = counts["cat:" + cat.key] ?? 0;
                return (
                  <Puce key={cat.key} on={on} n={n} titre={cat.hint} onClick={() => toggleCat(cat.key)}>
                    {cat.emoji} {cat.label}
                  </Puce>
                );
              })}
            </div>
            {sousTagsDispo.length > 0 && (
              <div className="mt-2.5 rounded-lg bg-muted/40 p-2.5">
                <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Nuances de la sélection
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {sousTagsDispo.map((t) => {
                    const on = sousTags.has(t.label.toLowerCase());
                    return (
                      <button key={t.label} onClick={() => toggleSousTag(t.label)}
                        className={cn("rounded-full border px-2.5 py-1 text-[12px] transition",
                          on ? "border-primary bg-primary/15 font-semibold text-primary"
                            : "border-transparent bg-background text-muted-foreground hover:border-primary")}>
                        {t.label} <span className="opacity-60">{t.n}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </Bloc>

          <div className="grid gap-5 md:grid-cols-2">
            {groups.map((grp) => (
              <Bloc key={grp.titre} titre={grp.titre}>
                <div className="flex flex-wrap gap-2">
                  {grp.items.map((f) => {
                    const on = active.has(f.key);
                    const n = counts[f.key] ?? 0;
                    return (
                      <Puce key={f.key} on={on} n={n} onClick={() => toggleFilter(f.key)}>{f.label}</Puce>
                    );
                  })}
                </div>
              </Bloc>
            ))}
            <Bloc titre="Console">
              <Select value={platformFilter} onValueChange={setPlatformFilter}>
                <SelectTrigger className="w-[220px]"><SelectValue placeholder="Console" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Toutes les consoles</SelectItem>
                  {platforms.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </Bloc>
          </div>

          <Bloc titre="Fourchettes"
            aide="Un jeu dont l'info manque reste affiché — mieux vaut un résultat en trop qu'un jeu écarté par une donnée absente.">
            <div className="flex flex-wrap items-end gap-4">
              {Object.entries(PLAGES).map(([k, def]) => (
                <Fourchette key={k} k={k} def={def} bornes={plages[k]}
                  onChange={(b) => setPlages((p) => ({ ...p, [k]: b }))} />
              ))}
              <label className="flex cursor-pointer items-center gap-2 pb-1.5 text-xs text-muted-foreground">
                <Checkbox checked={sansInfo} onCheckedChange={(c) => setSansInfo(!!c)} />
                Garder les jeux dont l&apos;info manque
              </label>
            </div>
          </Bloc>

          <Bloc titre="Tri">
            <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
              <Checkbox checked={epingler} onCheckedChange={(c) => setEpingler(!!c)} />
              🆕 Garder mes ajouts de la semaine en tête, quel que soit le tri
            </label>
          </Bloc>

          <div className="flex flex-wrap items-center gap-3 border-t pt-3 text-sm">
            <span className="font-semibold">
              {vue === "collection" ? `${shown.length} jeu${shown.length > 1 ? "x" : ""} sur ${games.length}` : "Critères appliqués à la recherche IGDB"}
            </span>
            <Button variant="ghost" size="sm" onClick={resetAll} disabled={!nbActifs}>Tout effacer</Button>
            <Button variant="outline" size="sm" className="ml-auto" onClick={() => setPanel(false)}>Fermer</Button>
          </div>
        </div>
      )}

      {vue === "decouvrir" ? (
        <DiscoverView lists={lists} criteres={criteres} />
      ) : (
      <>
      {/* stats */}
      <div className="flex flex-wrap gap-2.5">
        {stats.map(([l, v]) => (
          <div key={l} className="min-w-[92px] rounded-xl border bg-card px-4 py-2.5">
            <div className="text-2xl font-bold">{v}</div>
            <div className="text-xs text-muted-foreground">{l}</div>
          </div>
        ))}
      </div>

      {/* hero */}
      {hero.length > 0 && (
        <div className="rounded-2xl border bg-gradient-to-br from-primary/10 to-transparent p-4">
          <h2 className="mb-3 text-sm font-semibold">🔥 À jouer maintenant — dispo &amp; bien noté</h2>
          <div className="flex gap-3 overflow-x-auto pb-1">
            {hero.map((g) => {
              const p = prixVal(g), dev = g.prix?.devise ?? "CHF";
              return (
                <Link key={g.id} href={`/l/${g.listSlug ?? list.slug}/${slugifyTitle(g.titre)}`}
                  className="min-w-[190px] rounded-xl border bg-card p-3 transition hover:-translate-y-0.5 hover:border-primary">
                  <div className="truncate text-sm font-bold">{g.titre}</div>
                  <div className="text-xs text-muted-foreground">⭐ {noteVal(g)} · {g.gratuit ? "Gratuit" : p != null ? `${p} ${dev}` : "—"}</div>
                </Link>
              );
            })}
          </div>
        </div>
      )}

      <div className="text-sm text-muted-foreground">
        {shown.length} jeu{shown.length > 1 ? "x" : ""} affiché{shown.length > 1 ? "s" : ""}
        {shown.length !== games.length ? ` sur ${games.length}` : ""}
      </div>

      {/* liste, ou état vide */}
      {games.length === 0 ? (
        <EmptyState titre="Cette liste est vide" texte="Ajoute un lien YouTube, un lien Steam, un titre — ou colle une liste entière." />
      ) : shown.length === 0 ? (
        <EmptyState titre="Aucun jeu ne correspond" texte="Les filtres actifs ne laissent rien passer."
          action={<Button onClick={resetAll}>Réinitialiser les filtres</Button>} />
      ) : (
        <div className="rounded-lg border">
          {/* en-tête : mêmes colonnes que les lignes, collé en haut de l'écran */}
          <div className={cn(GRILLE, "sticky top-[57px] z-10 items-center border-b bg-background/95 px-2.5 py-2 text-xs uppercase tracking-wide text-muted-foreground backdrop-blur")}>
            <Checkbox checked={allShownSelected} onCheckedChange={toggleSelectAll} aria-label="Tout sélectionner" />
            <button className="text-left hover:text-foreground" onClick={() => changeSort("titre")}>Jeu{arrow("titre")}</button>
            <button className="hidden text-left hover:text-foreground md:block" onClick={() => changeSort("type")}>Type{arrow("type")}</button>
            <button className="hidden text-left hover:text-foreground md:block" onClick={() => changeSort("prix")}>Prix{arrow("prix")}</button>
            <button className="text-left hover:text-foreground" onClick={() => changeSort("note")}>Note{arrow("note")}</button>
            <button className="hidden text-left hover:text-foreground lg:block" onClick={() => changeSort("joueurs")}>Joueurs{arrow("joueurs")}</button>
            <button className="hidden text-left hover:text-foreground lg:block" onClick={() => changeSort("sortie")}>Sortie{arrow("sortie")}</button>
          </div>

          <div ref={listeRef} className="relative" style={{ height: virt.getTotalSize() }}>
            {virt.getVirtualItems().map((v) => {
              const it = shown[v.index];
              return (
                <div key={it.g.id} data-index={v.index} ref={virt.measureElement}
                  className="absolute inset-x-0 top-0"
                  style={{ transform: `translateY(${v.start - decalage}px)` }}>
                  <Row it={it} slug={it.g.listSlug ?? list.slug}
                    possede={showOwned && owned.has(it.key)}
                    checked={selected.has(it.g.id)}
                    onCheck={onCheck} onOpen={onOpen} />
                </div>
              );
            })}
          </div>
        </div>
      )}

      </>
      )}

      {/* clic sur un jeu = grande modale ; ⌘/ctrl-clic ou clic du milieu ouvrent
          toujours la vraie page dans un onglet, le lien est un <a> normal */}
      <Dialog open={!!fiche} onOpenChange={(o) => { if (!o) setFiche(null); }}>
        <DialogContent className="max-h-[92vh] gap-0 overflow-y-auto sm:max-w-4xl">
          <DialogTitle className="sr-only">{fiche?.titre ?? "Fiche du jeu"}</DialogTitle>
          {ficheAffichee && (
            <>
              <GameDetail g={ficheAffichee} slug={ficheAffichee.listSlug ?? list.slug} lists={lists}
                dansListes={dansListes}
                canManage={canManage || gerables.includes(ficheAffichee.listSlug ?? list.slug)} />
              <Link href={`/l/${ficheAffichee.listSlug ?? list.slug}/${slugifyTitle(ficheAffichee.titre)}`}
                className="mt-4 inline-block text-xs text-muted-foreground hover:text-foreground hover:underline">
                Ouvrir la fiche complète ↗
              </Link>
            </>
          )}
        </DialogContent>
      </Dialog>

      <SelectionBar games={selectedGames} lists={lists} currentSlug={list.slug}
        onClear={() => setSelected(new Set())} canManage={canManage} />
    </div>
  );
}

/** une section du panneau : titre discret, contenu, et une aide facultative */
function Bloc({ titre, aide, children }: { titre: string; aide?: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-baseline gap-2">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{titre}</div>
        {aide && <div className="text-[11px] text-muted-foreground/70">{aide}</div>}
      </div>
      {children}
    </div>
  );
}

/** puce de filtre : allumée, éteinte, ou désactivée quand elle ne laisserait rien passer */
function Puce({
  on, n, titre, onClick, children,
}: { on: boolean; n: number; titre?: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} disabled={!on && n === 0} title={titre}
      className={cn("rounded-full border px-3 py-1.5 text-[13px] font-semibold transition",
        on ? "border-primary bg-primary text-primary-foreground shadow-sm"
          : n === 0 ? "cursor-not-allowed border-dashed text-muted-foreground/40"
            : "bg-background text-muted-foreground hover:border-primary hover:text-foreground")}>
      {children} <span className={cn("ml-0.5 font-normal tabular-nums", on ? "opacity-80" : "opacity-60")}>{n}</span>
    </button>
  );
}

/** deux menus min/max — plus lisible et plus sûr au clavier qu'un double curseur */
function Fourchette({
  k, def, bornes, onChange,
}: {
  k: string;
  def: { label: string; unite: string; opts: number[] };
  bornes: Bornes;
  onChange: (b: Bornes) => void;
}) {
  const max = def.opts[def.opts.length - 1];
  const fmt = (v: number) => `${v}${def.unite}${v === max && k !== "note" && k !== "annee" ? "+" : ""}`;
  const actif = !estPleine(k, bornes);
  return (
    <div className="space-y-1">
      <div className={cn("text-xs font-semibold", actif ? "text-primary" : "text-muted-foreground")}>{def.label}</div>
      <div className="flex items-center gap-1.5">
        <Select value={String(bornes[0])} onValueChange={(v) => onChange([+v, Math.max(+v, bornes[1])])}>
          <SelectTrigger size="sm" className="w-[86px]"><SelectValue /></SelectTrigger>
          <SelectContent>{def.opts.map((o) => <SelectItem key={o} value={String(o)}>{fmt(o)}</SelectItem>)}</SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground">à</span>
        <Select value={String(bornes[1])} onValueChange={(v) => onChange([Math.min(+v, bornes[0]), +v])}>
          <SelectTrigger size="sm" className="w-[86px]"><SelectValue /></SelectTrigger>
          <SelectContent>{def.opts.map((o) => <SelectItem key={o} value={String(o)}>{fmt(o)}</SelectItem>)}</SelectContent>
        </Select>
      </div>
    </div>
  );
}

function ActiveChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <button onClick={onRemove}
      className="inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-[13px] font-semibold transition hover:bg-primary/20">
      {label} <X className="h-3.5 w-3.5 opacity-70" />
    </button>
  );
}

function EmptyState({ titre, texte, action }: { titre: string; texte: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed p-10 text-center">
      <span className="text-4xl">🎮</span>
      <div>
        <div className="font-semibold">{titre}</div>
        <p className="mt-1 text-sm text-muted-foreground">{texte}</p>
      </div>
      {action}
    </div>
  );
}

/** popularité sous la note : avis cumulés, et joueurs connectés quand on les a */
function Popularite({ g }: { g: Game }) {
  const pop = popuVal(g);
  if (!pop && !g.joueursSteam) return null;
  return (
    <div className="mt-0.5 flex flex-wrap gap-x-1.5 text-[10px] text-muted-foreground">
      {pop > 0 && <span title={`${pop.toLocaleString("fr-CH")} avis / votes`}>👥 {fmtNb(pop)}</span>}
      {!!g.joueursSteam && <span title="joueurs connectés au moment du scan">🔥 {fmtNb(g.joueursSteam)}</span>}
    </div>
  );
}

/**
 * Vignette du tableau : format 16/9 lisible, et au survol elle joue le trailer —
 * le mp4 Steam quand on l'a (léger, démarrage immédiat), sinon la vidéo YouTube IGDB.
 *
 * La vidéo n'est montée qu'après 400 ms de survol : traverser le tableau à la souris
 * ne déclenche pas 30 lecteurs. Elle est en `pointer-events-none` par-dessus l'image,
 * donc le survol et le clic continuent d'appartenir au lien vers la fiche.
 */
function Thumb({ g, href, onOpen }: { g: Game; href: string; onOpen: () => void }) {
  const [playing, setPlaying] = useState(false);
  const [ready, setReady] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mp4 = https(g.trailer);
  const yt = g.trailerYoutube;
  const hasVideo = !!(mp4 || yt);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const enter = () => {
    if (!hasVideo || playing) return;
    timer.current = setTimeout(() => setPlaying(true), 400);
  };
  const leave = () => {
    if (timer.current) clearTimeout(timer.current);
    setPlaying(false);
    setReady(false);
  };

  return (
    <div onMouseEnter={enter} onMouseLeave={leave}
      className="group relative aspect-video w-[120px] shrink-0 overflow-hidden rounded-md bg-muted sm:w-[168px]">
      {g.image
        ? <img src={g.image} loading="lazy" alt="" className="h-full w-full object-cover" />
        : <div className="flex h-full w-full items-center justify-center text-2xl">🎮</div>}

      {playing && (mp4 ? (
        <video src={mp4} autoPlay muted loop playsInline onCanPlay={() => setReady(true)}
          className={cn("pointer-events-none absolute inset-0 h-full w-full object-cover transition-opacity duration-300",
            ready ? "opacity-100" : "opacity-0")} />
      ) : (
        <iframe title="" tabIndex={-1} onLoad={() => setReady(true)} allow="autoplay; encrypted-media"
          src={`https://www.youtube.com/embed/${yt}?autoplay=1&mute=1&controls=0&modestbranding=1&playsinline=1&rel=0&loop=1&playlist=${yt}`}
          className={cn("pointer-events-none absolute inset-0 h-full w-full transition-opacity duration-300",
            ready ? "opacity-100" : "opacity-0")} />
      ))}

      {hasVideo && !ready && (
        <span className="pointer-events-none absolute bottom-1 right-1 rounded bg-black/65 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white">▶</span>
      )}

      {/* le lien couvre la vignette : la vidéo est en dessous et inerte, donc survol
          et clic restent au lien, et on n'imbrique pas d'iframe dans un <a> */}
      <Link href={href} onFocus={enter} onBlur={leave} aria-label={g.titre}
        onClick={(e) => { if (clicSimple(e)) { e.preventDefault(); onOpen(); } }}
        className="absolute inset-0 rounded-md ring-primary transition group-hover:ring-2 focus-visible:ring-2 focus-visible:outline-none" />
    </div>
  );
}

// mémoïsée : une frappe ou un clic de filtre ne re-rend que les lignes qui changent
// vraiment (props toutes primitives, `onCheck` stable côté parent).
const Row = memo(function Row({
  it, slug, possede, checked, onCheck, onOpen,
}: {
  it: Indexed; slug: string; possede: boolean; checked: boolean;
  onCheck: (id: string, c: boolean) => void; onOpen: (g: Game) => void;
}) {
  const g = it.g;
  const m = md(g);
  const p = prixVal(g);
  const n = noteVal(g);
  const dev = g.prix?.devise ?? "CHF";
  const store = g.prix?.store ?? "Steam";
  const detail = modesDetailText(g);
  const { txt, released } = fmtDate(g.sortieISO);
  const familles = it.cats.map((k) => CATEGORY_BY_KEY[k]).filter(Boolean);
  const href = `/l/${slug}/${slugifyTitle(g.titre)}`;

  return (
    <div className={cn(GRILLE, "items-start border-b px-2.5 py-2.5 transition hover:bg-muted/40", checked && "bg-primary/5")}>
      <div className="pt-1">
        <Checkbox checked={checked} onCheckedChange={(c) => onCheck(g.id, !!c)} aria-label={`Sélectionner ${g.titre}`} />
      </div>

      <div className="flex min-w-0 items-start gap-3">
        <Thumb g={g} href={href} onOpen={() => onOpen(g)} />
        <div className="min-w-0 flex-1 space-y-0.5">
          <div className="flex items-baseline gap-2">
            <Link href={href} onClick={(e) => { if (clicSimple(e)) { e.preventDefault(); onOpen(g); } }}
              className="min-w-0 truncate text-left text-[15px] font-bold hover:text-primary hover:underline">{g.titre}</Link>
            {/* statut : des pastilles expliquées au survol, plutôt qu'une colonne entière */}
            <span className="flex shrink-0 items-center gap-1 text-[13px]">
              {possede && <span title="déjà dans ma bibliothèque">✔</span>}
              {g.dispo && <span title="disponible">✅</span>}
              {(g.gratuit || g.gratuitMention) && <span title={g.gratuit ? "gratuit" : `gratuit — ${g.gratuitMention}`}>🆓</span>}
              {g.bonPlan && <span title="bon plan">💸</span>}
              {g.bienNote && <span title="bien noté">⭐</span>}
              {aVenir(g) && <span title="pas encore sorti">🔜</span>}
              {estInde(g) && <span title="studio indé">🎨</span>}
              {estRecent(g) && <span title="ajouté cette semaine">🆕</span>}
            </span>
          </div>
          <div className="truncate text-xs text-muted-foreground">{[g.genre, g.univers].filter(Boolean).join(" · ")}</div>
          <div className="flex flex-wrap items-center gap-1">
            {m.solo && <Tag className="bg-violet-500/15 text-violet-400">🎯 Solo</Tag>}
            {m.coop && <Tag className="bg-teal-500/15 text-teal-400">👥 Coop</Tag>}
            {m.pvp && <Tag className="bg-pink-500/15 text-pink-400">⚔️ PvP</Tag>}
            {!m.solo && !m.coop && !m.pvp && m.multi && <Tag className="bg-muted text-muted-foreground">🌐 Multi</Tag>}
            {!!g.plateformes.length && (
              <span className="truncate text-[11px] text-muted-foreground" title={g.plateformes.join(" · ")}>
                {g.plateformes.slice(0, 4).join(" · ")}
              </span>
            )}
          </div>
          <div className="flex flex-wrap gap-x-2 text-[11px] text-muted-foreground">
            {detail && <span>{detail}</span>}
            {g.dureeVie && <span title="durée de vie approximative">⏱ {g.dureeVie}</span>}
            {g.ajouteLe && <span title={`ajouté le ${g.ajouteLe}`}>+ {fmtJour(g.ajouteLe)}</span>}
            {g.urlSteam && <a href={g.urlSteam} target="_blank" rel="noopener noreferrer" className="hover:text-primary hover:underline">Steam ↗</a>}
            {g.urlPsn && <a href={g.urlPsn} target="_blank" rel="noopener noreferrer" className="hover:text-primary hover:underline">PS ↗</a>}
            {g.urlStore && g.urlStore !== g.urlSteam && <a href={g.urlStore} target="_blank" rel="noopener noreferrer" className="hover:text-primary hover:underline">Deal ↗</a>}
          </div>
        </div>
      </div>

      <div className="hidden flex-wrap gap-1 md:flex">
        {familles.length ? familles.map((c) => (
          <Tag key={c.key} className="bg-muted text-foreground" title={c.hint}>{c.emoji} {c.label}</Tag>
        )) : <span className="text-muted-foreground">—</span>}
      </div>

      <div className="hidden whitespace-nowrap text-sm md:block">
        {g.gratuit ? <span className="font-bold text-emerald-500">Gratuit</span> : p == null ? <span className="text-muted-foreground">—</span> : (
          <>
            <div className="font-bold">{p} {dev}{g.reducPct > 0 && <span className="ml-1 text-orange-500">-{g.reducPct}%</span>}</div>
            <div className="text-[11px] text-muted-foreground">{store}</div>
            {g.prix?.plusBasHisto != null && <div className="text-[11px] text-muted-foreground">bas {g.prix.plusBasHisto} {dev}</div>}
          </>
        )}
      </div>

      <div className="text-sm">
        {n == null ? <span className="text-muted-foreground">—</span> : (
          <>
            <span className="inline-flex min-w-[34px] items-center justify-center rounded-md px-1.5 py-1 text-[13px] font-extrabold"
              style={{ background: noteColor(n) + "22", color: noteColor(n) }}>{n}</span>
            {(g.noteSource || g.steamPct != null) && (
              <div className="mt-0.5 text-[10px] text-muted-foreground">
                {/* « Steam 35166 avis » → « Steam » : le compte est juste en dessous */}
                {(g.noteSource ?? "").replace(/\s*[\d\s]+avis/i, "")}
                {g.steamPct != null && !/Steam/.test(g.noteSource ?? "") ? ` · 👍 ${g.steamPct}%` : ""}
              </div>
            )}
          </>
        )}
        <Popularite g={g} />
      </div>

      <div className="hidden text-sm lg:block">{g.nbJoueurs || <span className="text-muted-foreground">—</span>}</div>

      <div className="hidden text-sm lg:block">
        {txt ? <span className={released ? "font-bold text-emerald-500" : "text-muted-foreground"}>{txt}</span>
          : <span className="text-muted-foreground">{g.sortiePrec || "—"}</span>}
      </div>
    </div>
  );
});
