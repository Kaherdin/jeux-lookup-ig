"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { toast } from "sonner";
import { Loader2, Sparkles, Library, ChevronDown } from "lucide-react";
import { analyzeInput, addBatch, importPsn, importSteam } from "@/app/actions/games";
import type { PreviewGame } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

const PLACEHOLDER =
  "Colle n'importe quoi : un lien YouTube (même un « Top 10 »), une playlist, un lien Steam / PlayStation / Instagram / Nintendo, un titre, une liste de titres (un par ligne), ou un texte entier…";

/** `slug` absent = on ajoute au CATALOGUE, sans rattacher à une liste. */
export function AddGamesDialog({ slug, trigger }: { slug?: string; trigger: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  const [input, setInput] = useState("");
  const [lib, setLib] = useState(false); // panneau « importer une bibliothèque »
  const [npsso, setNpsso] = useState("");
  const [detected, setDetected] = useState<PreviewGame[] | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const psn = useAction(importPsn, {
    onSuccess: ({ data }) => {
      toast.success(`${data?.added ?? 0} nouveau(x) jeu(x) sur ${data?.total ?? 0} — marqués « je l'ai » (PlayStation).`);
      setNpsso("");
      setOpen(false);
      router.refresh();
    },
    onError: ({ error }) => toast.error(error.serverError ?? "Échec de l'import PSN."),
  });

  const steam = useAction(importSteam, {
    onSuccess: ({ data }) => {
      toast.success(`${data?.added ?? 0} nouveau(x) jeu(x) sur ${data?.total ?? 0} — marqués « je l'ai » (Steam).`);
      setOpen(false);
      router.refresh();
    },
    onError: ({ error }) => toast.error(error.serverError ?? "Échec du rafraîchissement Steam."),
  });

  const analyze = useAction(analyzeInput, {
    onSuccess: ({ data }) => {
      const games = data?.games ?? [];
      const skipped = data?.skipped ?? [];
      const notes = data?.notes ?? [];
      setDetected(games);
      // un titre tapé → plusieurs candidats : on ne coche que le plus probable.
      // tout le reste (lien, liste, vidéo) → tout ce qui n'est pas déjà présent.
      const pickFirst = data?.mode === "candidats";
      setSelected(pickFirst
        ? new Set(games.length && !games[0].duplicate ? [0] : [])
        : new Set(games.map((g, i) => (!g.duplicate ? i : -1)).filter((i) => i >= 0)));
      // ex. « Instagram ne laisse plus lire ses publications » : à dire, sinon l'échec est incompréhensible
      for (const n of notes) toast.warning(n, { duration: 9000 });
      const dup = games.filter((g) => g.duplicate).length;
      if (!games.length) {
        if (!notes.length) toast.warning(skipped.length ? `Aucun jeu reconnu (${skipped.length} ignoré).` : "Aucun jeu trouvé.");
      } else {
        toast.success(`${games.length} trouvé(s)${dup ? ` · ${dup} déjà présent(s)` : ""}${skipped.length ? ` · ${skipped.length} ignoré(s)` : ""}.`);
      }
    },
    onError: ({ error }) => toast.error(error.serverError ?? "Échec de l'analyse."),
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
    setDetected(null); setSelected(new Set()); setInput(""); setLib(false);
  }
  function run() {
    if (!input.trim()) return;
    setDetected(null);
    analyze.execute({ slug, input: input.trim() });
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

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      {/* la preview peut lister 35 jeux : le dialogue doit défiler, pas déborder de l'écran */}
      <DialogContent className="max-h-[90dvh] max-w-xl overflow-y-auto">
        <DialogHeader><DialogTitle>➕ Ajouter des jeux</DialogTitle></DialogHeader>

        <div className="space-y-3">
          <Textarea
            autoFocus value={input} onChange={(e) => setInput(e.target.value)}
            placeholder={PLACEHOLDER}
            // le textarea se dimensionne au contenu (field-sizing) : on impose un plancher
            // confortable pour qu'on voie tout de suite qu'on peut coller plusieurs lignes
            className="min-h-[92px] resize-y"
            onKeyDown={(e) => {
              // Entrée = analyser (le geste attendu quand on tape un titre) ;
              // Maj+Entrée = nouvelle ligne, pour lister plusieurs jeux à la main.
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); run(); }
            }}
          />
          <Button className="w-full" size="lg" disabled={analyze.isPending || !input.trim()} onClick={run}>
            {analyze.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
            {analyze.isPending ? "Analyse en cours…" : "Analyser"}
          </Button>
          <p className="text-xs text-muted-foreground">
            Un <strong>titre</strong> propose plusieurs jeux (God of War 1, 2, 3…) — coche ceux à ajouter.
            Un <strong>lien</strong> détecte le jeu exact, une <strong>sélection</strong> (Top 10, playlist, article) détecte tous les jeux cités.
            <span className="ml-1 opacity-70">Entrée pour analyser · Maj+Entrée pour une nouvelle ligne.</span>
          </p>
        </div>

        {/* import de bibliothèque : rare, donc replié — mais toujours à portée de clic */}
        <div className="rounded-lg border bg-muted/20">
          <button type="button" onClick={() => setLib((v) => !v)}
            className="flex w-full items-center gap-2 px-3 py-2 text-sm font-semibold hover:bg-muted/40">
            <Library className="h-4 w-4" /> Importer toute une bibliothèque (Steam / PlayStation)
            <ChevronDown className={cn("ml-auto h-4 w-4 transition", lib && "rotate-180")} />
          </button>
          {lib && (
            <div className="space-y-4 border-t p-3">
              <div className="space-y-2">
                <p className="text-sm font-semibold">🎮 Steam</p>
                <p className="text-xs text-muted-foreground">
                  Jeux possédés. Aucun mot de passe ne transite par l&apos;app. Ton profil doit être <strong>public</strong>
                  {" "}(Steam → Profil → Modifier → Confidentialité → « Détails du jeu » = Public).
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button asChild variant="secondary" size="sm"><a href="/api/steam/login">Se connecter avec Steam</a></Button>
                  <Button variant="ghost" size="sm" disabled={steam.isPending} onClick={() => steam.execute({})}>
                    {steam.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} 🔄 Rafraîchir (déjà connecté)
                  </Button>
                </div>
              </div>
              <div className="space-y-2 border-t pt-3">
                <p className="text-sm font-semibold">🎮 PlayStation</p>
                <div className="flex gap-2">
                  <Input value={npsso} onChange={(e) => setNpsso(e.target.value)} placeholder="Colle ton token NPSSO…" />
                  <Button variant="secondary" disabled={psn.isPending || npsso.trim().length < 32}
                    onClick={() => psn.execute({ npsso: npsso.trim() })}>
                    {psn.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Importer
                  </Button>
                </div>
                <div className="space-y-1 text-xs text-muted-foreground">
                  <p>1. Connecte-toi sur <a className="underline" href="https://www.playstation.com" target="_blank" rel="noopener noreferrer">playstation.com</a></p>
                  <p>2. Dans le même navigateur, ouvre <a className="underline" href="https://ca.account.sony.com/api/v1/ssocookie" target="_blank" rel="noopener noreferrer">ce lien</a></p>
                  <p>3. Copie la valeur de <code className="rounded bg-background px-1">npsso</code> et colle-la ci-dessus. Le token expire après ~2 mois.</p>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Import léger (titre + jaquette + plateforme). Lance ensuite <strong>« Rescanner »</strong> (menu de ton compte) pour tout enrichir : notes, prix, coop, durée…
              </p>
            </div>
          )}
        </div>

        {/* preview */}
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
