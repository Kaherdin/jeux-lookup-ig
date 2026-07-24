"use client";
import { useState, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { toast } from "sonner";
import { Plus, RefreshCw, Loader2, Search } from "lucide-react";
import type { Game, ListMeta } from "@/lib/types";
import { rescanList } from "@/app/actions/games";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { AddGamesDialog } from "@/components/add-games-dialog";
import { GameDetailDialog } from "@/components/game-detail-dialog";

const prixVal = (g: Game) => g.prix?.meilleur ?? g.prixSteam ?? null;
const noteVal = (g: Game) => g.note ?? g.metacritic ?? g.steamPct ?? null;
const md = (g: Game) => g.modes ?? {};
const noteColor = (n: number) => (n >= 85 ? "#3fb950" : n >= 75 ? "#f5c518" : n >= 60 ? "#ff8c42" : "#f85149");
const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];

function fmtDate(iso: string | null) {
  if (!iso) return { txt: "", released: false };
  const p = iso.split("-");
  let txt = p.length >= 3 ? `${+p[2]} ${MOIS[+p[1] - 1]} ${p[0]}` : p.length === 2 ? `${MOIS[+p[1] - 1]} ${p[0]}` : p[0];
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
const FILTERS: [keyof Game | "coop" | "pvp" | "solo" | "canape" | "j4", string][] = [
  ["dispo", "✅ Dispo"], ["gratuit", "🆓 Gratuit"], ["bonPlan", "💸 Bon plan"], ["bienNote", "⭐ Bien noté"],
  ["coop", "👥 Coop"], ["pvp", "⚔️ PvP"], ["solo", "🎯 Solo"],
  ["canape", "🛋️ Canapé"], ["j4", "👨‍👩‍👧‍👦 4+ joueurs"],
];

export function GamesView({ games, list, canEdit }: { games: Game[]; list: ListMeta; canEdit: boolean }) {
  const [q, setQ] = useState("");
  const [genreFilter, setGenreFilter] = useState("all");
  const [platformFilter, setPlatformFilter] = useState("all");
  const [sortKey, setSortKey] = useState("note");
  const [sortDir, setSortDir] = useState(-1);
  const [filters, setFilters] = useState<Set<string>>(() => new Set());

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

  const stats = useMemo(() => [
    ["Jeux", games.length], ["Dispo", games.filter((g) => g.dispo).length],
    ["Gratuits", games.filter((g) => g.gratuit).length], ["Bons plans", games.filter((g) => g.bonPlan).length],
    ["Coop", games.filter((g) => md(g).coop).length], ["PvP", games.filter((g) => md(g).pvp).length],
  ] as [string, number][], [games]);

  const list2 = useMemo(() => {
    let l = games.slice();
    const s = q.toLowerCase().trim();
    if (s) l = l.filter((g) => (g.titre + " " + (g.genre ?? "") + " " + (g.univers ?? "")).toLowerCase().includes(s));
    if (genreFilter !== "all") l = l.filter((g) => genreTokens(g).some((t) => t.toLowerCase() === genreFilter.toLowerCase()));
    if (platformFilter !== "all") l = l.filter((g) => (g.plateformes ?? []).includes(platformFilter));
    for (const f of filters) {
      if (f === "coop") l = l.filter((g) => md(g).coop);
      else if (f === "pvp") l = l.filter((g) => md(g).pvp);
      else if (f === "solo") l = l.filter((g) => md(g).solo);
      else if (f === "canape") l = l.filter((g) => { const d = (g.modesDetail ?? {}) as Record<string, boolean>; return !!(d.coopCouch || d.pvpCouch || d.coopLan || d.pvpLan); });
      else if (f === "j4") l = l.filter((g) => (g.nbJoueursMax ?? 0) >= 4);
      else l = l.filter((g) => (g as unknown as Record<string, boolean>)[f]);
    }
    const val = SORT_VAL[sortKey] ?? SORT_VAL.note;
    l.sort((a, b) => {
      const va = val(a), vb = val(b);
      const r = va < vb ? -1 : va > vb ? 1 : 0;
      return r * sortDir || a.titre.localeCompare(b.titre);
    });
    return l;
  }, [games, q, genreFilter, platformFilter, sortKey, sortDir, filters]);

  function toggleFilter(f: string) {
    setFilters((prev) => { const n = new Set(prev); n.has(f) ? n.delete(f) : n.add(f); return n; });
  }
  function changeSort(k: string) {
    if (k === sortKey) setSortDir((d) => -d);
    else { setSortKey(k); setSortDir(SORT_DEFDIR[k]); }
  }
  const arrow = (k: string) => (sortKey === k ? (sortDir === 1 ? " ▲" : " ▼") : "");

  const hero = games.filter((g) => g.dispo && g.bienNote).sort((a, b) => (noteVal(b) ?? 0) - (noteVal(a) ?? 0)).slice(0, 10);

  return (
    <div className="space-y-5">
      {/* stats */}
      <div className="flex flex-wrap gap-2.5">
        {stats.map(([l, v]) => (
          <div key={l} className="rounded-xl border bg-card px-4 py-2.5 min-w-[92px]">
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
                <a key={g.id} href={g.urlStore || g.urlSteam || g.urlPsn || "#"} target="_blank" rel="noopener noreferrer"
                  className="min-w-[190px] rounded-xl border bg-card p-3 transition hover:border-primary hover:-translate-y-0.5">
                  <div className="text-sm font-bold truncate">{g.titre}</div>
                  <div className="text-xs text-muted-foreground">⭐ {noteVal(g)} · {g.gratuit ? "Gratuit" : p != null ? `${p} ${dev}` : "—"}</div>
                </a>
              );
            })}
          </div>
        </div>
      )}

      {/* toolbar */}
      <div className="flex flex-wrap items-center gap-2.5">
        <Input placeholder="Rechercher un titre, un genre, un univers…" value={q} onChange={(e) => setQ(e.target.value)} className="flex-1 min-w-[220px]" />
        <Select value={genreFilter} onValueChange={setGenreFilter}>
          <SelectTrigger className="w-[150px]"><SelectValue placeholder="Genre" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tous les genres</SelectItem>
            {genres.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={platformFilter} onValueChange={setPlatformFilter}>
          <SelectTrigger className="w-[140px]"><SelectValue placeholder="Console" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Toutes consoles</SelectItem>
            {platforms.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={sortKey} onValueChange={(v) => { setSortKey(v); setSortDir(SORT_DEFDIR[v]); }}>
          <SelectTrigger className="w-[130px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="note">Tri : Note</SelectItem>
            <SelectItem value="prix">Prix</SelectItem>
            <SelectItem value="joueurs">Joueurs</SelectItem>
            <SelectItem value="sortie">Sortie</SelectItem>
            <SelectItem value="titre">Titre</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" size="icon" onClick={() => setSortDir((d) => -d)} title="Inverser le sens">{sortDir === 1 ? "▲" : "▼"}</Button>
        <Button asChild variant="outline"><Link href="/decouvrir"><Search className="mr-1 h-4 w-4" /> Trouver un jeu</Link></Button>
        {canEdit && <AddGamesDialog slug={list.slug} trigger={<Button><Plus className="mr-1 h-4 w-4" /> Ajouter</Button>} />}
        {canEdit && <RescanListButton slug={list.slug} count={games.length} />}
      </div>

      {/* chips */}
      <div className="flex flex-wrap gap-2">
        {FILTERS.map(([f, label]) => (
          <button key={f as string} onClick={() => toggleFilter(f as string)}
            className={cn("rounded-full border px-3 py-1.5 text-[13px] font-semibold transition",
              filters.has(f as string) ? "bg-primary border-primary text-primary-foreground" : "bg-card text-muted-foreground hover:border-primary")}>
            {label}
          </button>
        ))}
      </div>

      <div className="text-sm text-muted-foreground">
        {list2.length} jeu{list2.length > 1 ? "x" : ""} affiché{list2.length > 1 ? "s" : ""}{genreFilter !== "all" ? ` · genre : ${genreFilter}` : ""}
      </div>

      {/* table */}
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full min-w-[900px] text-sm">
          <thead>
            <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
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
            {list2.map((g) => <Row key={g.id} g={g} slug={list.slug} canEdit={canEdit} />)}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RescanListButton({ slug, count }: { slug: string; count: number }) {
  const router = useRouter();
  const action = useAction(rescanList, {
    onSuccess: ({ data }) => { toast.success(`${data?.count ?? 0} jeu(x) re-scanné(s).`); router.refresh(); },
    onError: ({ error }) => toast.error(error.serverError ?? "Échec du re-scan."),
  });
  return (
    <Button variant="outline" disabled={action.isPending}
      title="Re-enrichit tous les jeux (comble les infos manquantes)"
      onClick={() => { if (confirm(`Rescanner les ${count} jeux de la liste ? Cela peut prendre un moment.`)) action.execute({ slug }); }}>
      {action.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-1 h-4 w-4" />} Rescanner
    </Button>
  );
}

function Row({ g, slug, canEdit }: { g: Game; slug: string; canEdit: boolean }) {
  const m = md(g);
  const p = prixVal(g);
  const n = noteVal(g);
  const dev = g.prix?.devise ?? "CHF";
  const store = g.prix?.store ?? "Steam";
  const detail = modesDetailText(g);
  const { txt, released } = fmtDate(g.sortieISO);
  return (
    <tr className="border-b hover:bg-muted/40">
      <td className="p-2.5">
        <div className="flex items-center gap-3">
          {g.image ? <img src={g.image} loading="lazy" alt="" className="h-[43px] w-[92px] shrink-0 rounded-md object-cover" />
            : <div className="flex h-[43px] w-[92px] shrink-0 items-center justify-center rounded-md bg-muted text-lg">🎮</div>}
          <div className="min-w-0">
            <GameDetailDialog g={g} slug={slug} canEdit={canEdit} trigger={
              <button className="block max-w-[230px] truncate text-left font-bold hover:text-primary hover:underline">{g.titre}</button>
            } />
            <div className="max-w-[230px] truncate text-xs text-muted-foreground">{[g.genre, g.univers].filter(Boolean).join(" · ")}</div>
          </div>
        </div>
      </td>
      <td className="p-2.5">
        <div className="flex flex-wrap gap-1">
          {g.dispo && <Tag className="bg-emerald-500/15 text-emerald-500">✅ Dispo</Tag>}
          {g.gratuit ? <Tag className="bg-sky-500/15 text-sky-500">🆓 Gratuit</Tag> : g.gratuitMention && <Tag className="bg-sky-500/15 text-sky-500">🆓 {g.gratuitMention}</Tag>}
          {g.bonPlan && <Tag className="bg-orange-500/15 text-orange-500">💸 Bon plan</Tag>}
          {g.bienNote && <Tag className="bg-yellow-500/15 text-yellow-500">⭐ Top</Tag>}
          {g.comingSoon && <Tag className="bg-muted text-muted-foreground">🔜 Bientôt</Tag>}
          {!g.dispo && !g.gratuit && !g.bonPlan && !g.bienNote && !g.comingSoon && <span className="text-muted-foreground">—</span>}
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
          {g.reel && <a className="text-primary hover:underline" href={g.reel} target="_blank" rel="noopener noreferrer">Reel</a>}
          {!g.urlSteam && !g.urlStore && !g.reel && !g.urlPsn && <span className="text-muted-foreground">—</span>}
        </div>
      </td>
    </tr>
  );
}
