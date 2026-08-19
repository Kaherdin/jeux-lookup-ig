"use client";
import { useState, useMemo, useEffect, useCallback } from "react";
import Link from "next/link";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Search, SlidersHorizontal, X, Check } from "lucide-react";
import type { Game, ListMeta } from "@/lib/types";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn, slugifyTitle } from "@/lib/utils";
import { SelectionBar } from "@/components/selection-bar";

const prixVal = (g: Game) => g.prix?.meilleur ?? g.prixSteam ?? null;
const noteVal = (g: Game) => g.note ?? g.metacritic ?? g.steamPct ?? null;
const md = (g: Game) => g.modes ?? {};
const noteColor = (n: number) => (n >= 85 ? "#3fb950" : n >= 75 ? "#f5c518" : n >= 60 ? "#ff8c42" : "#f85149");
const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];

function fmtDate(iso: string | null) {
  if (!iso) return { txt: "", released: false };
  const p = iso.split("-");
  const txt = p.length >= 3 ? `${+p[2]} ${MOIS[+p[1] - 1]} ${p[0]}` : p.length === 2 ? `${MOIS[+p[1] - 1]} ${p[0]}` : p[0];
  const today = new Date().toISOString().slice(0, 10);
  return { txt, released: iso <= today.slice(0, iso.length) };
}
function genreTokens(g: Game) {
  return (g.genre ?? "").split(/[,/]/).map((s) => s.trim()).filter(Boolean);
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
  sortie: (g) => g.sortieISO ?? "",
};
const SORT_DEFDIR: Record<string, number> = { titre: 1, prix: 1, note: -1, joueurs: -1, sortie: -1 };
const SORT_LABEL: Record<string, string> = { note: "Note", prix: "Prix", joueurs: "Joueurs", sortie: "Sortie", titre: "Titre" };

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
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  // ── état des filtres : la source de vérité est l'URL ────────────────
  // rechargement, retour arrière et partage de lien fonctionnent gratuitement.
  const q = sp.get("q") ?? "";
  const genreFilter = sp.get("g") ?? "all";
  const platformFilter = sp.get("p") ?? "all";
  const active = useMemo(() => new Set((sp.get("f") ?? "").split(",").filter(Boolean)), [sp]);
  const sortKey = sp.get("tri") ?? "note";
  const sortDir = sp.get("sens") ? (sp.get("sens") === "asc" ? 1 : -1) : (SORT_DEFDIR[sortKey] ?? -1);

  const setParams = useCallback((patch: Record<string, string | null>) => {
    const p = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) { if (v) p.set(k, v); else p.delete(k); }
    const qs = p.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [router, pathname, sp]);

  // la recherche est tapée au clavier : on ne réécrit l'URL qu'après une pause
  const [qInput, setQInput] = useState(q);
  useEffect(() => { setQInput(q); }, [q]);
  useEffect(() => {
    const t = setTimeout(() => { if (qInput !== q) setParams({ q: qInput || null }); }, 300);
    return () => clearTimeout(t);
  }, [qInput]); // eslint-disable-line react-hooks/exhaustive-deps

  const [panel, setPanel] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const owned = useMemo(() => new Set(ownedTitles.map((t) => t.toLowerCase())), [ownedTitles]);
  const groups = useMemo(() => GROUPS.filter((g) => g.titre !== "Ma bibliothèque" || showOwned), [showOwned]);

  const genres = useMemo(() => {
    const c = new Map<string, number>();
    for (const g of games) for (const t of genreTokens(g)) c.set(t, (c.get(t) ?? 0) + 1);
    return [...c.entries()].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).map(([t]) => t);
  }, [games]);

  const platforms = useMemo(() => {
    const c = new Map<string, number>();
    for (const g of games) for (const p of g.plateformes ?? []) c.set(p, (c.get(p) ?? 0) + 1);
    return [...c.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t);
  }, [games]);

  // ── filtrage ────────────────────────────────────────────────────────
  // `except` permet de compter ce que donnerait CHAQUE filtre sans lui-même :
  // les compteurs affichés tiennent compte des autres critères actifs.
  const keep = useCallback((g: Game, except?: string) => {
    const s = q.toLowerCase().trim();
    if (except !== "q" && s && !(g.titre + " " + (g.genre ?? "") + " " + (g.univers ?? "")).toLowerCase().includes(s)) return false;
    if (except !== "genre" && genreFilter !== "all" && !genreTokens(g).some((t) => t.toLowerCase() === genreFilter.toLowerCase())) return false;
    if (except !== "plat" && platformFilter !== "all" && !(g.plateformes ?? []).includes(platformFilter)) return false;
    for (const k of active) {
      if (k === except) continue;
      const f = findFilter(k);
      if (f && !f.test(g, owned)) return false;
    }
    return true;
  }, [q, genreFilter, platformFilter, active, owned]);

  const shown = useMemo(() => {
    const l = games.filter((g) => keep(g));
    const val = SORT_VAL[sortKey] ?? SORT_VAL.note;
    l.sort((a, b) => {
      const va = val(a), vb = val(b);
      const r = va < vb ? -1 : va > vb ? 1 : 0;
      return r * sortDir || a.titre.localeCompare(b.titre);
    });
    return l;
  }, [games, keep, sortKey, sortDir]);

  const counts = useMemo(() => {
    const out: Record<string, number> = {};
    for (const f of ALL_FILTERS) out[f.key] = games.filter((g) => keep(g, f.key) && f.test(g, owned)).length;
    return out;
  }, [games, keep, owned]);

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

  function toggleFilter(k: string) {
    const n = new Set(active);
    n.has(k) ? n.delete(k) : n.add(k);
    // « je l'ai déjà » et « pas encore » s'excluent
    if (k === "possede") n.delete("manque");
    if (k === "manque") n.delete("possede");
    setParams({ f: [...n].join(",") || null });
  }
  function resetAll() {
    setParams({ q: null, g: null, p: null, f: null });
    setQInput("");
  }
  const nbActifs = active.size + (genreFilter !== "all" ? 1 : 0) + (platformFilter !== "all" ? 1 : 0) + (q ? 1 : 0);

  const changeSort = (k: string) => {
    if (k === sortKey) setParams({ sens: sortDir === 1 ? "desc" : "asc" });
    else setParams({ tri: k, sens: (SORT_DEFDIR[k] ?? -1) === 1 ? "asc" : "desc" });
  };
  const arrow = (k: string) => (sortKey === k ? (sortDir === 1 ? " ▲" : " ▼") : "");

  const hero = useMemo(
    () => games.filter((g) => g.dispo && g.bienNote).sort((a, b) => (noteVal(b) ?? 0) - (noteVal(a) ?? 0)).slice(0, 10),
    [games]
  );

  const allShownSelected = shown.length > 0 && shown.every((g) => selected.has(g.id));
  function toggleSelectAll() {
    setSelected(allShownSelected ? new Set() : new Set(shown.map((g) => g.id)));
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
        <Input placeholder="Rechercher un titre, un genre, un univers…" value={qInput}
          onChange={(e) => setQInput(e.target.value)} className="min-w-[220px] flex-1" />
        <Button variant={panel || nbActifs ? "default" : "outline"} onClick={() => setPanel((v) => !v)}>
          <SlidersHorizontal className="mr-1 h-4 w-4" /> Filtres{nbActifs ? ` (${nbActifs})` : ""}
        </Button>
        <Select value={sortKey} onValueChange={(v) => setParams({ tri: v, sens: (SORT_DEFDIR[v] ?? -1) === 1 ? "asc" : "desc" })}>
          <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            {Object.entries(SORT_LABEL).map(([k, l]) => <SelectItem key={k} value={k}>Tri : {l}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button variant="outline" size="icon" title="Inverser le sens"
          onClick={() => setParams({ sens: sortDir === 1 ? "desc" : "asc" })}>{sortDir === 1 ? "▲" : "▼"}</Button>
        <Button asChild variant="outline"><Link href="/decouvrir"><Search className="mr-1 h-4 w-4" /> Trouver un jeu</Link></Button>
      </div>

      {/* filtres actifs, retirables un par un */}
      {nbActifs > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {q && <ActiveChip label={`« ${q} »`} onRemove={() => { setQInput(""); setParams({ q: null }); }} />}
          {genreFilter !== "all" && <ActiveChip label={`Genre : ${genreFilter}`} onRemove={() => setParams({ g: null })} />}
          {platformFilter !== "all" && <ActiveChip label={`Console : ${platformFilter}`} onRemove={() => setParams({ p: null })} />}
          {[...active].map((k) => (
            <ActiveChip key={k} label={findFilter(k)?.label ?? k} onRemove={() => toggleFilter(k)} />
          ))}
          <Button variant="ghost" size="sm" onClick={resetAll}>Tout effacer</Button>
        </div>
      )}

      {/* panneau de filtres */}
      {panel && (
        <div className="space-y-4 rounded-xl border bg-card p-4">
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
            <Select value={genreFilter} onValueChange={(v) => setParams({ g: v === "all" ? null : v })}>
              <SelectTrigger className="w-[190px]"><SelectValue placeholder="Genre" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tous les genres</SelectItem>
                {genres.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={platformFilter} onValueChange={(v) => setParams({ p: v === "all" ? null : v })}>
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
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[900px] text-sm">
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
                <th className="hidden cursor-pointer p-2.5 md:table-cell" onClick={() => changeSort("sortie")}>Sortie{arrow("sortie")}</th>
                <th className="hidden p-2.5 md:table-cell">Liens</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((g) => (
                <Row key={g.id} g={g} slug={g.listSlug ?? list.slug}
                  possede={showOwned && owned.has(g.titre.toLowerCase())}
                  checked={selected.has(g.id)}
                  onCheck={(c) => setSelected((prev) => { const n = new Set(prev); c ? n.add(g.id) : n.delete(g.id); return n; })} />
              ))}
            </tbody>
          </table>
        </div>
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

function Row({
  g, slug, possede, checked, onCheck,
}: { g: Game; slug: string; possede: boolean; checked: boolean; onCheck: (c: boolean) => void }) {
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
        <Checkbox checked={checked} onCheckedChange={(c) => onCheck(!!c)} aria-label={`Sélectionner ${g.titre}`} />
      </td>
      <td className="p-2.5">
        <div className="flex items-center gap-3">
          {g.image ? <img src={g.image} loading="lazy" alt="" className="h-[43px] w-[92px] shrink-0 rounded-md object-cover" />
            : <div className="flex h-[43px] w-[92px] shrink-0 items-center justify-center rounded-md bg-muted text-lg">🎮</div>}
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
          {g.comingSoon && <Tag className="bg-muted text-muted-foreground">🔜 Bientôt</Tag>}
          {!possede && !g.dispo && !g.gratuit && !g.bonPlan && !g.bienNote && !g.comingSoon && <span className="text-muted-foreground">—</span>}
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
}
