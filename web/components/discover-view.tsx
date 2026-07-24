"use client";
import { useState } from "react";
import Link from "next/link";
import { useAction } from "next-safe-action/hooks";
import { toast } from "sonner";
import { Loader2, Search, Plus, Check } from "lucide-react";
import { discoverGames, addDiscovered, type DiscoverGame } from "@/app/actions/games";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

// IGDB ids
const PLATFORMS: [number, string][] = [[6, "PC"], [167, "PS5"], [48, "PS4"], [130, "Switch"], [169, "Xbox Series"], [49, "Xbox One"]];
const GENRES: [number, string][] = [[12, "RPG"], [31, "Aventure"], [5, "Tir"], [8, "Plateforme"], [25, "Action"], [4, "Combat"], [15, "Stratégie"], [24, "Tactique"], [10, "Course"], [14, "Sport"], [13, "Simulation"], [9, "Puzzle"], [33, "Arcade"], [32, "Indé"], [36, "MOBA"]];
const MODES: [number, string][] = [[1, "Solo"], [2, "Multi"], [3, "Coop"], [6, "Battle Royale"]];

export function DiscoverView({ lists }: { lists: { slug: string; name: string }[] }) {
  const [platforms, setPlatforms] = useState<Set<number>>(new Set());
  const [genres, setGenres] = useState<Set<number>>(new Set());
  const [modes, setModes] = useState<Set<number>>(new Set());
  const [coopLocal, setCoopLocal] = useState(false);
  const [playersMin, setPlayersMin] = useState("0");
  const [noteMin, setNoteMin] = useState("0");
  const [sinceYear, setSinceYear] = useState("0");
  const [sort, setSort] = useState<"pop" | "note" | "recent">("pop");
  const [target, setTarget] = useState(lists[0]?.slug ?? "");
  const [results, setResults] = useState<DiscoverGame[] | null>(null);
  const [added, setAdded] = useState<Set<number>>(new Set());

  const search = useAction(discoverGames, {
    onSuccess: ({ data }) => {
      const g = data?.games ?? [];
      setResults(g);
      if (!g.length) toast.warning("Aucun jeu ne correspond — élargis les critères.");
    },
    onError: ({ error }) => toast.error(error.serverError ?? "Échec de la recherche."),
  });
  const add = useAction(addDiscovered, {
    onSuccess: ({ data, input }) => {
      const id = (input as { igdbId?: number }).igdbId;
      if (id) setAdded((s) => new Set(s).add(id));
      if (data?.duplicate) toast.info(`« ${data.titre} » est déjà dans la liste.`);
      else toast.success(`Ajouté : ${data?.titre}`);
    },
    onError: ({ error }) => toast.error(error.serverError ?? "Échec de l'ajout."),
  });

  function run() {
    setResults(null);
    search.execute({
      platforms: [...platforms], genres: [...genres], modes: [...modes],
      coopLocal, playersMin: +playersMin, noteMin: +noteMin, sinceYear: +sinceYear, sort,
    });
  }

  return (
    <main className="mx-auto max-w-6xl px-4 py-6">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h1 className="flex items-center gap-2 text-2xl font-bold"><Search className="h-6 w-6" /> Trouver un jeu</h1>
        <Link href="/" className="text-sm text-muted-foreground hover:text-foreground">← Retour aux listes</Link>
      </div>

      <div className="space-y-4 rounded-xl border bg-card p-4">
        <Field label="Plateforme"><ChipGroup opts={PLATFORMS} sel={platforms} setSel={setPlatforms} /></Field>
        <Field label="Type de jeu"><ChipGroup opts={GENRES} sel={genres} setSel={setGenres} /></Field>
        <Field label="Mode"><ChipGroup opts={MODES} sel={modes} setSel={setModes} /></Field>

        <div className="flex flex-wrap items-end gap-4">
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <Checkbox checked={coopLocal} onCheckedChange={(c) => setCoopLocal(!!c)} /> 🛋️ Coop locale / canapé
          </label>
          <Mini label="Joueurs min" value={playersMin} onChange={setPlayersMin}
            opts={[["0", "Indiff."], ["2", "2+"], ["3", "3+"], ["4", "4+"], ["6", "6+"], ["8", "8+"]]} />
          <Mini label="Note mini" value={noteMin} onChange={setNoteMin}
            opts={[["0", "Indiff."], ["70", "70+"], ["80", "80+"], ["90", "90+"]]} />
          <Mini label="Depuis" value={sinceYear} onChange={setSinceYear}
            opts={[["0", "Indiff."], ["2015", "2015+"], ["2020", "2020+"], ["2023", "2023+"]]} />
          <Mini label="Trier par" value={sort} onChange={(v) => setSort(v as typeof sort)}
            opts={[["pop", "Populaire"], ["note", "Mieux noté"], ["recent", "Récent"]]} />
        </div>

        <div className="flex flex-wrap items-center gap-3 border-t pt-3">
          <Button onClick={run} disabled={search.isPending}>
            {search.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Search className="mr-1 h-4 w-4" />} Chercher
          </Button>
          {lists.length > 0 && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              Ajouter à :
              <Select value={target} onValueChange={setTarget}>
                <SelectTrigger className="w-[220px]"><SelectValue /></SelectTrigger>
                <SelectContent>{lists.map((l) => <SelectItem key={l.slug} value={l.slug}>{l.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          )}
        </div>
      </div>

      {results && (
        results.length === 0 ? (
          <p className="mt-6 rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">Aucun résultat — essaie d&apos;élargir les filtres.</p>
        ) : (
          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {results.map((g) => (
              <div key={g.igdbId} className="flex flex-col overflow-hidden rounded-xl border bg-card">
                {g.cover ? <img src={g.cover} alt="" loading="lazy" className="aspect-[3/4] w-full object-cover" />
                  : <div className="flex aspect-[3/4] w-full items-center justify-center bg-muted text-3xl">🎮</div>}
                <div className="flex flex-1 flex-col gap-1.5 p-2.5">
                  <div className="line-clamp-2 text-sm font-semibold">{g.titre}</div>
                  <div className="flex flex-wrap gap-1">
                    {g.note != null && <Badge variant="outline">⭐ {g.note}</Badge>}
                    {g.annee && <Badge variant="outline">{g.annee}</Badge>}
                  </div>
                  <div className="line-clamp-1 text-xs text-muted-foreground">{g.plateformes.slice(0, 4).join(" · ")}</div>
                  <div className="line-clamp-1 text-xs text-muted-foreground">{g.genres}</div>
                  <Button size="sm" variant={added.has(g.igdbId) ? "secondary" : "default"} className="mt-auto"
                    disabled={!target || add.isPending || added.has(g.igdbId)}
                    onClick={() => add.execute({ slug: target, titre: g.titre, igdbId: g.igdbId })}>
                    {added.has(g.igdbId) ? <><Check className="mr-1 h-4 w-4" /> Ajouté</> : <><Plus className="mr-1 h-4 w-4" /> Ajouter</>}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )
      )}
    </main>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
      {children}
    </div>
  );
}
function ChipGroup({ opts, sel, setSel }: { opts: [number, string][]; sel: Set<number>; setSel: (s: Set<number>) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {opts.map(([id, label]) => (
        <button key={id} onClick={() => { const n = new Set(sel); n.has(id) ? n.delete(id) : n.add(id); setSel(n); }}
          className={cn("rounded-full border px-3 py-1 text-[13px] font-medium transition",
            sel.has(id) ? "border-primary bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:border-primary")}>
          {label}
        </button>
      ))}
    </div>
  );
}
function Mini({ label, value, onChange, opts }: { label: string; value: string; onChange: (v: string) => void; opts: [string, string][] }) {
  return (
    <div className="space-y-1">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="w-[130px]"><SelectValue /></SelectTrigger>
        <SelectContent>{opts.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
      </Select>
    </div>
  );
}
