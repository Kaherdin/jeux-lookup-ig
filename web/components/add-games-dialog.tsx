"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { detectGames, addBatch, searchGames, importPsn } from "@/app/actions/games";
import type { PreviewGame } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

export function AddGamesDialog({ slug, trigger }: { slug: string; trigger: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  const [single, setSingle] = useState("");
  const [text, setText] = useState("");
  const [playlist, setPlaylist] = useState("");
  const [extract, setExtract] = useState(false);
  const [npsso, setNpsso] = useState("");
  const [detected, setDetected] = useState<PreviewGame[] | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const psn = useAction(importPsn, {
    onSuccess: ({ data }) => {
      toast.success(`${data?.added ?? 0} jeu(x) importés (sur ${data?.total ?? 0}) → « Ma bibliothèque PlayStation ». Rescanne pour enrichir.`);
      setNpsso("");
      setOpen(false);
      if (data?.slug) router.push(`/l/${data.slug}`); else router.refresh();
    },
    onError: ({ error }) => toast.error(error.serverError ?? "Échec de l'import PSN."),
  });

  function showResult(games: PreviewGame[], skipped: string[], pickFirst: boolean) {
    setDetected(games);
    if (pickFirst) setSelected(new Set(games.length && !games[0].duplicate ? [0] : []));
    else setSelected(new Set(games.map((g, i) => (!g.duplicate ? i : -1)).filter((i) => i >= 0)));
    const dup = games.filter((g) => g.duplicate).length;
    if (!games.length) toast.warning(skipped.length ? `Aucun jeu reconnu (${skipped.length} ignoré).` : "Aucun jeu trouvé.");
    else toast.success(`${games.length} trouvé(s)${dup ? ` · ${dup} déjà présent(s)` : ""}${skipped.length ? ` · ${skipped.length} ignoré(s)` : ""}.`);
  }

  const detect = useAction(detectGames, {
    onSuccess: ({ data }) => showResult(data?.games ?? [], data?.skipped ?? [], false),
    onError: ({ error }) => toast.error(error.serverError ?? "Échec de l'analyse."),
  });
  const search = useAction(searchGames, {
    onSuccess: ({ data }) => showResult(data?.games ?? [], [], true),
    onError: ({ error }) => toast.error(error.serverError ?? "Échec de la recherche."),
  });

  const batch = useAction(addBatch, {
    onSuccess: ({ data }) => {
      toast.success(`${data?.added ?? 0} jeu(x) ajouté(s).`);
      reset();
      router.refresh();
      setOpen(false);
    },
    onError: ({ error }) => toast.error(error.serverError ?? "Échec de l'ajout."),
  });

  function reset() {
    setDetected(null); setSelected(new Set()); setSingle(""); setText(""); setPlaylist("");
  }
  function analyze(payload: { text?: string; playlist?: string; extract?: boolean }) {
    setDetected(null);
    detect.execute({ slug, ...payload });
  }
  function analyzeSingle() {
    const s = single.trim();
    if (!s) return;
    setDetected(null);
    const isLink = /^https?:\/\//i.test(s) || /(youtube\.com|youtu\.be|instagram\.com|steampowered\.com|store\.playstation)/i.test(s);
    if (isLink) detect.execute({ slug, text: s });
    else search.execute({ slug, query: s }); // titre tapé → propose plusieurs candidats
  }
  function submitBatch() {
    if (!detected || !selected.size) return;
    batch.execute({ slug, items: [...selected].map((i) => detected[i]).filter(Boolean) });
  }
  function toggleAll() {
    if (!detected) return;
    const selectable = detected.map((d, i) => (d.duplicate ? -1 : i)).filter((i) => i >= 0);
    setSelected(selected.size >= selectable.length ? new Set() : new Set(selectable));
  }

  const analyzing = detect.isPending || search.isPending;

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-xl overflow-hidden">
        <DialogHeader><DialogTitle>➕ Ajouter des jeux</DialogTitle></DialogHeader>
        <Tabs defaultValue="single">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="single">Un jeu</TabsTrigger>
            <TabsTrigger value="multi">Plusieurs</TabsTrigger>
            <TabsTrigger value="psn">🎮 PSN</TabsTrigger>
          </TabsList>

          <TabsContent value="single" className="space-y-3 pt-2">
            <form onSubmit={(e) => { e.preventDefault(); analyzeSingle(); }} className="flex gap-2">
              <Input value={single} onChange={(e) => setSingle(e.target.value)} autoFocus
                placeholder="Lien Steam / PlayStation / YouTube / Instagram, ou un titre…" />
              <Button type="submit" disabled={analyzing || !single.trim()}>
                {analyzing && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Analyser
              </Button>
            </form>
            <p className="text-xs text-muted-foreground">Un titre te propose plusieurs jeux (God of War 1, 2, 3…) — coche ceux à ajouter. Un lien détecte le jeu exact.</p>
          </TabsContent>

          <TabsContent value="multi" className="space-y-3 pt-2">
            <Textarea rows={extract ? 6 : 4} value={text} onChange={(e) => setText(e.target.value)}
              placeholder={extract
                ? "Colle un texte / article / doc entier — l'IA en extrait les jeux automatiquement."
                : "Un lien ou un titre par ligne :\nhttps://store.steampowered.com/app/…\nHades II\nhttps://store.playstation.com/…"} />
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <Checkbox checked={extract} onCheckedChange={(c) => setExtract(!!c)} />
              📄 Texte libre / document — extraire les jeux automatiquement (IA)
            </label>
            <Input value={playlist} onChange={(e) => setPlaylist(e.target.value)} placeholder="… ou une URL de playlist YouTube" />
            <Button variant="secondary" disabled={analyzing || (!text.trim() && !playlist.trim())}
              onClick={() => analyze({ text, playlist, extract })}>
              {analyzing && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Analyser
            </Button>
            <p className="text-xs text-muted-foreground">Détecte plusieurs jeux d&apos;un coup et te les affiche avant ajout.</p>
          </TabsContent>

          <TabsContent value="psn" className="space-y-3 pt-2">
            <p className="text-sm text-muted-foreground">Importe ta bibliothèque PlayStation (jeux joués sur PS4/PS5).</p>
            <Input value={npsso} onChange={(e) => setNpsso(e.target.value)} placeholder="Colle ton token NPSSO…" />
            <Button variant="secondary" disabled={psn.isPending || npsso.trim().length < 32}
              onClick={() => psn.execute({ npsso: npsso.trim() })}>
              {psn.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Importer ma bibliothèque PSN
            </Button>
            <div className="space-y-1 rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
              <p className="font-semibold text-foreground">Récupérer ton token NPSSO (10 sec) :</p>
              <p>1. Connecte-toi sur <a className="underline" href="https://www.playstation.com" target="_blank" rel="noopener noreferrer">playstation.com</a></p>
              <p>2. Dans le même navigateur, ouvre <a className="underline" href="https://ca.account.sony.com/api/v1/ssocookie" target="_blank" rel="noopener noreferrer">ce lien</a></p>
              <p>3. Copie la valeur de <code className="rounded bg-background px-1">npsso</code> et colle-la ci-dessus.</p>
              <p className="pt-1">Import léger (titre + jaquette + plateforme). Clique ensuite <strong>« Rescanner »</strong> pour tout enrichir (notes, prix, durée…). Le token expire après ~2 mois.</p>
            </div>
          </TabsContent>
        </Tabs>

        {/* preview partagée (unitaire + multiple) */}
        {detected && (
          detected.length === 0 ? (
            <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">Aucun jeu détecté. Vérifie le lien/titre.</p>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate text-sm text-muted-foreground">
                  {detected.length} trouvé(s) · <span className="font-semibold text-foreground">{selected.size} sélectionné(s)</span>
                </span>
                <Button type="button" variant="ghost" size="sm" onClick={toggleAll}>
                  {selected.size ? "Tout décocher" : "Tout cocher"}
                </Button>
              </div>
              <div className="max-h-[340px] space-y-1.5 overflow-y-auto pr-1">
                {detected.map((d, i) => <PreviewRow key={i} d={d} checked={selected.has(i)}
                  onCheck={(c) => setSelected((prev) => { const n = new Set(prev); c ? n.add(i) : n.delete(i); return n; })} />)}
              </div>
              <Button className="w-full" disabled={batch.isPending || !selected.size} onClick={submitBatch}>
                {batch.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Ajouter {selected.size} jeu(x)
              </Button>
            </div>
          )
        )}
      </DialogContent>
    </Dialog>
  );
}

function PreviewRow({ d, checked, onCheck }: { d: PreviewGame; checked: boolean; onCheck: (c: boolean) => void }) {
  const dup = !!d.duplicate;
  const note = d.note ?? d.metacritic ?? d.steamPct ?? null;
  const p = d.prix?.meilleur ?? d.prixSteam ?? null;
  const dev = d.prix?.devise ?? "CHF";
  const year = d.sortieISO ? d.sortieISO.slice(0, 4) : null;
  return (
    <label className={cn("flex cursor-pointer gap-3 rounded-lg border p-2 transition",
      dup ? "opacity-50" : checked ? "border-primary bg-primary/5" : "hover:bg-muted/50")}>
      <Checkbox className="mt-1 shrink-0" checked={checked} disabled={dup} onCheckedChange={(c) => onCheck(!!c)} />
      {d.image ? <img src={d.image} alt="" className="h-14 w-28 shrink-0 rounded object-cover" />
        : <span className="flex h-14 w-28 shrink-0 items-center justify-center rounded bg-muted text-lg">🎮</span>}
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="min-w-0 truncate font-semibold">{d.titre}</span>
          {dup && <Badge variant="secondary" className="shrink-0">déjà présent</Badge>}
          {d.corrected && <Badge variant="outline" className="shrink-0 text-[10px]">corrigé depuis « {d.corrected} »</Badge>}
        </div>
        <div className="flex flex-wrap gap-1">
          {note != null && <Badge variant="outline">⭐ {note}</Badge>}
          {d.gratuit ? <Badge variant="outline">Gratuit</Badge> : p != null && <Badge variant="outline">{p} {dev}</Badge>}
          {year && <Badge variant="outline">{year}</Badge>}
          {d.nbJoueurs && <Badge variant="outline">👥 {d.nbJoueurs}</Badge>}
          {d.modes?.solo && <Badge variant="outline">Solo</Badge>}
          {d.modes?.coop && <Badge variant="outline">Coop</Badge>}
          {d.modes?.pvp && <Badge variant="outline">PvP</Badge>}
          {d.envergure && <Badge variant="outline">{d.envergure}</Badge>}
          {d.dureeVie && <Badge variant="outline">⏱ {d.dureeVie}</Badge>}
          {(d.plateformes ?? []).slice(0, 4).map((pl, i) => <Badge key={i} variant="secondary">{pl}</Badge>)}
        </div>
        {d.genre && <div className="truncate text-xs text-muted-foreground">{d.genre}</div>}
      </div>
    </label>
  );
}
