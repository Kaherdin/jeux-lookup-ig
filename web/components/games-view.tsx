"use client";
import { useState, useMemo, useEffect, useCallback, useRef, useDeferredValue, memo } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Search, SlidersHorizontal, X, Check } from "lucide-react";
import type { Game, ListMeta } from "@/lib/types";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn, slugifyTitle } from "@/lib/utils";
import { SelectionBar } from "@/components/selection-bar";
import { CATEGORIES, CATEGORY_BY_KEY, categorize, type CategoryKey } from "@/lib/categories";

const https = (u?: string | null) => (u ? u.replace(/^http:/, "https:") : "");
const prixVal = (g: Game) => g.prix?.meilleur ?? g.prixSteam ?? null;
const noteVal = (g: Game) => g.note ?? g.metacritic ?? g.steamPct ?? null;
const md = (g: Game) => g.modes ?? {};
const TODAY = new Date().toISOString().slice(0, 10);
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
/** « ~12h », « 100h+ » → 12, 100 (pour trier ; -1 quand on ne sait pas) */
const dureeVal = (g: Game) => { const m = (g.dureeVie ?? "").match(/\d+/); return m ? +m[0] : -1; };
const noteColor = (n: number) => (n >= 85 ? "#3fb950" : n >= 75 ? "#f5c518" : n >= 60 ? "#ff8c42" : "#f85149");
const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];

/** nombre de lignes rendues d'un coup — au-delà, un bouton « en afficher plus » */
const PAGE = 60;

function fmtDate(iso: string | null) {
  if (!iso) return { txt: "", released: false };
  const p = iso.split("-");
  const txt = p.length >= 3 ? `${+p[2]} ${MOIS[+p[1] - 1]} ${p[0]}` : p.length === 2 ? `${MOIS[+p[1] - 1]} ${p[0]}` : p[0];
  const today = new Date().toISOString().slice(0, 10);
  return { txt, released: iso <= today.slice(0, iso.length) };
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

function Tag({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={cn("inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-semibold whitespace-nowrap", className)}>{children}</span>;
}

const SORT_VAL: Record<string, (g: Game) => number | string> = {
  titre: (g) => g.titre.toLowerCase(),
  prix: (g) => prixVal(g) ?? Infinity,
  note: (g) => noteVal(g) ?? -1,
  joueurs: (g) => g.nbJoueursMax ?? -1,
  sortie: sortieVal,
  duree: dureeVal,
};
const SORT_DEFDIR: Record<string, number> = { titre: 1, prix: 1, note: -1, joueurs: -1, sortie: -1, duree: -1 };
const SORT_LABEL: Record<string, string> = { note: "Note", prix: "Prix", joueurs: "Joueurs", sortie: "Sortie", duree: "Durée de vie", titre: "Titre" };

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

/** un jeu + tout ce qui sert à le filtrer, calculé UNE fois pour toute la liste */
type Indexed = { g: Game; key: string; hay: string; cats: CategoryKey[] };

const splitCsv = (s: string | null) => new Set((s ?? "").split(",").filter(Boolean));

export function GamesView({
  games, list, canManage, lists = [], ownedTitles = [], showOwned = false,
}: {
  games: Game[];
  list: ListMeta;
  canManage: boolean;
  lists?: { slug: string; name: string }[];
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
  const [platformFilter, setPlatformFilter] = useState(() => sp.get("p") ?? "all");
  const [active, setActive] = useState<Set<string>>(() => splitCsv(sp.get("f")));
  const [sortKey, setSortKey] = useState(() => sp.get("tri") ?? "note");
  const [sortDir, setSortDir] = useState(() => {
    const s = sp.get("sens");
    return s ? (s === "asc" ? 1 : -1) : SORT_DEFDIR[sp.get("tri") ?? "note"] ?? -1;
  });

  const [panel, setPanel] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [limit, setLimit] = useState(PAGE);

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
      put("p", platformFilter === "all" ? null : platformFilter);
      put("f", [...active].join(",") || null);
      put("tri", sortKey === "note" ? null : sortKey);
      put("sens", sortDir === (SORT_DEFDIR[sortKey] ?? -1) ? null : sortDir === 1 ? "asc" : "desc");
      const qs = p.toString();
      const url = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
      if (url !== window.location.pathname + window.location.search) window.history.replaceState(null, "", url);
    }, 250);
    return () => clearTimeout(t);
  }, [q, cats, platformFilter, active, sortKey, sortDir]);

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
      cats: categorize(g),
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

  // ── filtrage ────────────────────────────────────────────────────────
  // `except` permet de compter ce que donnerait CHAQUE filtre sans lui-même :
  // les compteurs affichés tiennent compte des autres critères actifs.
  const keep = useCallback((it: Indexed, except?: string) => {
    if (except !== "q" && qq && !it.hay.includes(qq)) return false;
    if (except !== "cat" && cats.size && !it.cats.some((k) => cats.has(k))) return false;
    if (except !== "plat" && platformFilter !== "all" && !(it.g.plateformes ?? []).includes(platformFilter)) return false;
    for (const k of active) {
      if (k === except) continue;
      const f = findFilter(k);
      if (f && !f.test(it.g, owned)) return false;
    }
    return true;
  }, [qq, cats, platformFilter, active, owned]);

  const shown = useMemo(() => {
    const l = index.filter((it) => keep(it));
    const val = SORT_VAL[sortKey] ?? SORT_VAL.note;
    l.sort((a, b) => {
      const va = val(a.g), vb = val(b.g);
      const r = va < vb ? -1 : va > vb ? 1 : 0;
      return r * sortDir || a.g.titre.localeCompare(b.g.titre);
    });
    return l;
  }, [index, keep, sortKey, sortDir]);

  // on ne repart du haut que quand les critères changent (pas au tri, pas à la sélection)
  useEffect(() => { setLimit(PAGE); }, [qq, cats, platformFilter, active]);
  const visible = useMemo(() => shown.slice(0, limit), [shown, limit]);

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
  }, []);

  function resetAll() {
    setQ("");
    setCats(new Set());
    setPlatformFilter("all");
    setActive(new Set());
  }
  const nbActifs = active.size + cats.size + (platformFilter !== "all" ? 1 : 0) + (q ? 1 : 0);

  const changeSort = (k: string) => {
    if (k === sortKey) setSortDir((d) => -d);
    else { setSortKey(k); setSortDir(SORT_DEFDIR[k] ?? -1); }
  };
  const arrow = (k: string) => (sortKey === k ? (sortDir === 1 ? " ▲" : " ▼") : "");

  const hero = useMemo(
    () => games.filter((g) => g.dispo && g.bienNote).sort((a, b) => (noteVal(b) ?? 0) - (noteVal(a) ?? 0)).slice(0, 10),
    [games]
  );

  const onCheck = useCallback((id: string, c: boolean) => {
    setSelected((prev) => { const n = new Set(prev); c ? n.add(id) : n.delete(id); return n; });
  }, []);

  const allShownSelected = shown.length > 0 && shown.every((it) => selected.has(it.g.id));
  function toggleSelectAll() {
    setSelected(allShownSelected ? new Set() : new Set(shown.map((it) => it.g.id)));
  }
  const selectedGames = useMemo(() => games.filter((g) => selected.has(g.id)), [games, selected]);

  return (
    <div className="space-y-5">
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

      {/* barre principale : recherche + filtres + tri */}
      <div className="flex flex-wrap items-center gap-2.5">
        <Input placeholder="Rechercher un titre, un genre, un univers…" value={q}
          onChange={(e) => setQ(e.target.value)} className="min-w-[220px] flex-1" />
        <Button variant={panel || nbActifs ? "default" : "outline"} onClick={() => setPanel((v) => !v)}>
          <SlidersHorizontal className="mr-1 h-4 w-4" /> Filtres{nbActifs ? ` (${nbActifs})` : ""}
        </Button>
        <Select value={sortKey} onValueChange={(v) => { setSortKey(v); setSortDir(SORT_DEFDIR[v] ?? -1); }}>
          <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            {Object.entries(SORT_LABEL).map(([k, l]) => <SelectItem key={k} value={k}>Tri : {l}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button variant="outline" size="icon" title="Inverser le sens"
          onClick={() => setSortDir((d) => -d)}>{sortDir === 1 ? "▲" : "▼"}</Button>
        <Button asChild variant="outline"><Link href="/decouvrir"><Search className="mr-1 h-4 w-4" /> Trouver un jeu</Link></Button>
      </div>

      {/* familles de jeux, toujours visibles : c'est le filtre le plus utilisé */}
      {catList.length > 1 && (
        <div className="flex flex-wrap gap-1.5">
          {catList.map((cat) => {
            const on = cats.has(cat.key);
            return (
              <button key={cat.key} onClick={() => toggleCat(cat.key)} title={cat.hint}
                className={cn("rounded-full border px-3 py-1 text-[13px] font-semibold transition",
                  on ? "border-primary bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:border-primary")}>
                {cat.emoji} {cat.label}
              </button>
            );
          })}
          {cats.size > 0 && <Button variant="ghost" size="sm" onClick={() => setCats(new Set())}>Toutes</Button>}
        </div>
      )}

      {/* filtres actifs, retirables un par un */}
      {nbActifs > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {q && <ActiveChip label={`« ${q} »`} onRemove={() => setQ("")} />}
          {[...cats].map((k) => (
            <ActiveChip key={k} label={`${CATEGORY_BY_KEY[k]?.emoji ?? ""} ${CATEGORY_BY_KEY[k]?.label ?? k}`} onRemove={() => toggleCat(k)} />
          ))}
          {platformFilter !== "all" && <ActiveChip label={`Console : ${platformFilter}`} onRemove={() => setPlatformFilter("all")} />}
          {[...active].map((k) => (
            <ActiveChip key={k} label={findFilter(k)?.label ?? k} onRemove={() => toggleFilter(k)} />
          ))}
          <Button variant="ghost" size="sm" onClick={resetAll}>Tout effacer</Button>
        </div>
      )}

      {/* panneau de filtres */}
      {panel && (
        <div className="space-y-4 rounded-xl border bg-card p-4">
          <div>
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Type de jeu</div>
            <div className="flex flex-wrap gap-2">
              {catList.map((cat) => {
                const on = cats.has(cat.key);
                const n = counts["cat:" + cat.key] ?? 0;
                return (
                  <button key={cat.key} onClick={() => toggleCat(cat.key)} disabled={!on && n === 0} title={cat.hint}
                    className={cn("rounded-full border px-3 py-1.5 text-[13px] font-semibold transition",
                      on ? "border-primary bg-primary text-primary-foreground"
                        : n === 0 ? "cursor-not-allowed border-dashed text-muted-foreground/40"
                          : "bg-background text-muted-foreground hover:border-primary")}>
                    {cat.emoji} {cat.label} <span className={cn("ml-0.5 font-normal", on ? "opacity-80" : "opacity-60")}>{n}</span>
                  </button>
                );
              })}
            </div>
          </div>
          {groups.map((grp) => (
            <div key={grp.titre}>
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{grp.titre}</div>
              <div className="flex flex-wrap gap-2">
                {grp.items.map((f) => {
                  const on = active.has(f.key);
                  const n = counts[f.key] ?? 0;
                  return (
                    <button key={f.key} onClick={() => toggleFilter(f.key)} disabled={!on && n === 0}
                      className={cn("rounded-full border px-3 py-1.5 text-[13px] font-semibold transition",
                        on ? "border-primary bg-primary text-primary-foreground"
                          : n === 0 ? "cursor-not-allowed border-dashed text-muted-foreground/40"
                            : "bg-background text-muted-foreground hover:border-primary")}>
                      {f.label} <span className={cn("ml-0.5 font-normal", on ? "opacity-80" : "opacity-60")}>{n}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
          <div className="flex flex-wrap gap-2.5 border-t pt-3">
            <Select value={platformFilter} onValueChange={setPlatformFilter}>
              <SelectTrigger className="w-[190px]"><SelectValue placeholder="Console" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Toutes les consoles</SelectItem>
                {platforms.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button variant="ghost" onClick={() => setPanel(false)} className="ml-auto">Fermer</Button>
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
        <>
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full min-w-[1060px] text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="w-9 p-2.5">
                    <Checkbox checked={allShownSelected} onCheckedChange={toggleSelectAll} aria-label="Tout sélectionner" />
                  </th>
                  <th className="cursor-pointer p-2.5 whitespace-nowrap" onClick={() => changeSort("titre")}>Jeu{arrow("titre")}</th>
                  <th className="p-2.5">Statut</th>
                  <th className="p-2.5">Modes</th>
                  <th className="hidden p-2.5 md:table-cell">Plateformes</th>
                  <th className="cursor-pointer p-2.5" onClick={() => changeSort("prix")}>Prix{arrow("prix")}</th>
                  <th className="cursor-pointer p-2.5" onClick={() => changeSort("note")}>Note{arrow("note")}</th>
                  <th className="hidden cursor-pointer p-2.5 md:table-cell" onClick={() => changeSort("joueurs")}>Joueurs{arrow("joueurs")}</th>
                  <th className="hidden cursor-pointer p-2.5 md:table-cell" onClick={() => changeSort("duree")}>Durée{arrow("duree")}</th>
                  <th className="hidden cursor-pointer p-2.5 md:table-cell" onClick={() => changeSort("sortie")}>Sortie{arrow("sortie")}</th>
                  <th className="hidden p-2.5 md:table-cell">Liens</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((it) => (
                  <Row key={it.g.id} g={it.g} slug={it.g.listSlug ?? list.slug}
                    possede={showOwned && owned.has(it.key)}
                    checked={selected.has(it.g.id)}
                    onCheck={onCheck} />
                ))}
              </tbody>
            </table>
          </div>
          {shown.length > visible.length && (
            <div className="flex justify-center">
              <Button variant="outline" onClick={() => setLimit((n) => n + PAGE * 2)}>
                Afficher plus ({shown.length - visible.length} restants)
              </Button>
            </div>
          )}
        </>
      )}

      <SelectionBar games={selectedGames} lists={lists} currentSlug={list.slug}
        onClear={() => setSelected(new Set())} canManage={canManage} />
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

/**
 * Vignette du tableau : format 16/9 lisible, et au survol elle joue le trailer —
 * le mp4 Steam quand on l'a (léger, démarrage immédiat), sinon la vidéo YouTube IGDB.
 *
 * La vidéo n'est montée qu'après 400 ms de survol : traverser le tableau à la souris
 * ne déclenche pas 30 lecteurs. Elle est en `pointer-events-none` par-dessus l'image,
 * donc le survol et le clic continuent d'appartenir au lien vers la fiche.
 */
function Thumb({ g, href }: { g: Game; href: string }) {
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
        className="absolute inset-0 rounded-md ring-primary transition group-hover:ring-2 focus-visible:ring-2 focus-visible:outline-none" />
    </div>
  );
}

// mémoïsée : une frappe ou un clic de filtre ne re-rend que les lignes qui changent
// vraiment (props toutes primitives, `onCheck` stable côté parent).
const Row = memo(function Row({
  g, slug, possede, checked, onCheck,
}: { g: Game; slug: string; possede: boolean; checked: boolean; onCheck: (id: string, c: boolean) => void }) {
  const m = md(g);
  const p = prixVal(g);
  const n = noteVal(g);
  const dev = g.prix?.devise ?? "CHF";
  const store = g.prix?.store ?? "Steam";
  const detail = modesDetailText(g);
  const { txt, released } = fmtDate(g.sortieISO);
  return (
    <tr className={cn("border-b hover:bg-muted/40", checked && "bg-primary/5")}>
      <td className="p-2.5 align-top">
        <Checkbox checked={checked} onCheckedChange={(c) => onCheck(g.id, !!c)} aria-label={`Sélectionner ${g.titre}`} />
      </td>
      <td className="p-2.5">
        <div className="flex items-center gap-3">
          <Thumb g={g} href={`/l/${slug}/${slugifyTitle(g.titre)}`} />
          <div className="min-w-0">
            <Link href={`/l/${slug}/${slugifyTitle(g.titre)}`}
              className="block max-w-[230px] truncate text-left font-bold hover:text-primary hover:underline">{g.titre}</Link>
            <div className="max-w-[230px] truncate text-xs text-muted-foreground">{[g.genre, g.univers].filter(Boolean).join(" · ")}</div>
          </div>
        </div>
      </td>
      <td className="p-2.5">
        <div className="flex flex-wrap gap-1">
          {possede && <Tag className="bg-primary/15 text-primary"><Check className="mr-0.5 h-3 w-3" /> J&apos;ai</Tag>}
          {g.dispo && <Tag className="bg-emerald-500/15 text-emerald-500">✅ Dispo</Tag>}
          {g.gratuit ? <Tag className="bg-sky-500/15 text-sky-500">🆓 Gratuit</Tag> : g.gratuitMention && <Tag className="bg-sky-500/15 text-sky-500">🆓 {g.gratuitMention}</Tag>}
          {g.bonPlan && <Tag className="bg-orange-500/15 text-orange-500">💸 Bon plan</Tag>}
          {g.bienNote && <Tag className="bg-yellow-500/15 text-yellow-500">⭐ Top</Tag>}
          {aVenir(g) && <Tag className="bg-muted text-muted-foreground">🔜 À venir</Tag>}
          {estInde(g) && <Tag className="bg-fuchsia-500/15 text-fuchsia-400">🎨 Indé</Tag>}
          {!possede && !g.dispo && !g.gratuit && !g.bonPlan && !g.bienNote && !aVenir(g) && !g.envergure && <span className="text-muted-foreground">—</span>}
        </div>
      </td>
      <td className="p-2.5">
        <div className="flex flex-wrap gap-1">
          {m.solo && <Tag className="bg-violet-500/15 text-violet-400">🎯 Solo</Tag>}
          {m.coop && <Tag className="bg-teal-500/15 text-teal-400">👥 Coop</Tag>}
          {m.pvp && <Tag className="bg-pink-500/15 text-pink-400">⚔️ PvP</Tag>}
          {!m.solo && !m.coop && !m.pvp && m.multi && <Tag className="bg-muted text-muted-foreground">🌐 Multi</Tag>}
          {!m.solo && !m.coop && !m.pvp && !m.multi && <span className="text-muted-foreground">—</span>}
        </div>
        {detail && <div className="mt-0.5 text-[11px] text-muted-foreground">{detail}</div>}
      </td>
      <td className="hidden p-2.5 md:table-cell">
        <div className="flex flex-wrap gap-1">
          {g.plateformes.length ? g.plateformes.slice(0, 5).map((pl, i) => <Tag key={i} className="bg-muted text-foreground">{pl}</Tag>)
            : <span className="text-muted-foreground">—</span>}
        </div>
      </td>
      <td className="p-2.5 whitespace-nowrap">
        {g.gratuit ? <span className="font-bold text-emerald-500">Gratuit</span> : p == null ? <span className="text-muted-foreground">—</span> : (
          <>
            <div className="font-bold">{p} {dev}{g.reducPct > 0 && <span className="ml-1 text-orange-500">-{g.reducPct}%</span>}</div>
            <div className="text-[11px] text-muted-foreground">{store}</div>
            {g.prix?.plusBasHisto != null && <div className="text-[11px] text-muted-foreground">bas {g.prix.plusBasHisto} {dev}</div>}
          </>
        )}
      </td>
      <td className="p-2.5">
        {n == null ? <span className="text-muted-foreground">—</span> : (
          <>
            <span className="inline-flex min-w-[34px] items-center justify-center rounded-md px-1.5 py-1 text-[13px] font-extrabold" style={{ background: noteColor(n) + "22", color: noteColor(n) }}>{n}</span>
            {(g.noteSource || g.steamPct != null) && (
              <div className="mt-0.5 text-[10px] text-muted-foreground">{g.noteSource}{g.steamPct != null && !/Steam/.test(g.noteSource ?? "") ? ` · 👍 ${g.steamPct}%` : ""}</div>
            )}
          </>
        )}
      </td>
      <td className="hidden p-2.5 md:table-cell">{g.nbJoueurs || <span className="text-muted-foreground">—</span>}</td>
      <td className="hidden p-2.5 whitespace-nowrap md:table-cell">
        {g.dureeVie ? <span title="durée de vie approximative">⏱ {g.dureeVie}</span> : <span className="text-muted-foreground">—</span>}
      </td>
      <td className="hidden p-2.5 md:table-cell">
        {txt ? <span className={released ? "font-bold text-emerald-500" : "text-muted-foreground"}>{txt}</span> : <span className="text-muted-foreground">{g.sortiePrec || "—"}</span>}
      </td>
      <td className="hidden p-2.5 md:table-cell">
        <div className="flex gap-2 text-xs font-semibold">
          {g.urlSteam && <a className="text-primary hover:underline" href={g.urlSteam} target="_blank" rel="noopener noreferrer">Steam</a>}
          {g.urlPsn && <a className="text-primary hover:underline" href={g.urlPsn} target="_blank" rel="noopener noreferrer">PS</a>}
          {g.urlStore && g.urlStore !== g.urlSteam && <a className="text-primary hover:underline" href={g.urlStore} target="_blank" rel="noopener noreferrer">Deal</a>}
          {g.reel && <a className="text-primary hover:underline" href={g.reel} target="_blank" rel="noopener noreferrer">Source</a>}
          {!g.urlSteam && !g.urlStore && !g.reel && !g.urlPsn && <span className="text-muted-foreground">—</span>}
        </div>
      </td>
    </tr>
  );
});
