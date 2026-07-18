"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useAction } from "next-safe-action/hooks";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { addGame, detectGames, addBatch } from "@/app/actions/games";
import type { PreviewGame } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

const singleSchema = z.object({ input: z.string().min(1, "Entre un lien ou un titre.") });

export function AddGamesDialog({ slug, trigger }: { slug: string; trigger: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  // --- ajout unitaire (RHF + zod) ---
  const form = useForm<z.infer<typeof singleSchema>>({ resolver: zodResolver(singleSchema), defaultValues: { input: "" } });
  const single = useAction(addGame, {
    onSuccess: ({ data }) => {
      if (data?.duplicate) toast.info(`« ${data.titre} » est déjà dans la liste.`);
      else toast.success(`Ajouté : ${data?.titre}`);
      form.reset();
      router.refresh();
    },
    onError: ({ error }) => toast.error(error.serverError ?? "Échec de l'ajout."),
  });

  // --- ajout multiple ---
  const [text, setText] = useState("");
  const [playlist, setPlaylist] = useState("");
  const [detected, setDetected] = useState<PreviewGame[] | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const detect = useAction(detectGames, {
    onSuccess: ({ data }) => {
      const games = data?.games ?? [];
      setDetected(games);
      setSelected(new Set(games.map((g, i) => (!g.duplicate ? i : -1)).filter((i) => i >= 0)));
      const dup = games.filter((g) => g.duplicate).length;
      toast.success(`${games.length} jeu(x) détecté(s)${dup ? ` · ${dup} déjà présent(s)` : ""}.`);
    },
    onError: ({ error }) => toast.error(error.serverError ?? "Échec de l'analyse."),
  });

  const batch = useAction(addBatch, {
    onSuccess: ({ data }) => {
      toast.success(`${data?.added ?? 0} jeu(x) ajouté(s).`);
      setDetected(null);
      setSelected(new Set());
      setText("");
      setPlaylist("");
      router.refresh();
      setOpen(false);
    },
    onError: ({ error }) => toast.error(error.serverError ?? "Échec de l'ajout."),
  });

  function submitBatch() {
    if (!detected || !selected.size) return;
    const items = [...selected].map((i) => detected[i]).filter(Boolean);
    batch.execute({ slug, items });
  }

  function toggleAll() {
    if (!detected) return;
    const selectable = detected.map((d, i) => (d.duplicate ? -1 : i)).filter((i) => i >= 0);
    setSelected(selected.size >= selectable.length ? new Set() : new Set(selectable));
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-xl">
        <DialogHeader><DialogTitle>➕ Ajouter des jeux</DialogTitle></DialogHeader>
        <Tabs defaultValue="single">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="single">Un jeu</TabsTrigger>
            <TabsTrigger value="multi">Plusieurs / playlist</TabsTrigger>
          </TabsList>

          <TabsContent value="single" className="space-y-3 pt-2">
            <form onSubmit={form.handleSubmit((v) => single.execute({ slug, input: v.input }))} className="flex gap-2">
              <Input placeholder="Lien Steam / PlayStation / YouTube / Instagram, ou un titre…" {...form.register("input")} autoFocus />
              <Button type="submit" disabled={single.isPending}>
                {single.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Ajouter
              </Button>
            </form>
            {form.formState.errors.input && <p className="text-xs text-destructive">{form.formState.errors.input.message}</p>}
            <p className="text-xs text-muted-foreground">Détecte le jeu (Steam exact, PS Store, YouTube, reel Insta, ou titre) puis enrichit via Steam/IGDB/ITAD.</p>
          </TabsContent>

          <TabsContent value="multi" className="space-y-3 pt-2">
            <Textarea rows={4} value={text} onChange={(e) => setText(e.target.value)}
              placeholder={"Un lien ou un titre par ligne :\nhttps://store.steampowered.com/app/…\nHades II\nhttps://store.playstation.com/…"} />
            <Input value={playlist} onChange={(e) => setPlaylist(e.target.value)} placeholder="… ou une URL de playlist YouTube (nécessite YOUTUBE_API_KEY)" />
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="secondary" disabled={detect.isPending || (!text.trim() && !playlist.trim())}
                onClick={() => { setDetected(null); detect.execute({ slug, text, playlist }); }}>
                {detect.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Analyser
              </Button>
              {detected && detected.length > 0 && (
                <Button disabled={batch.isPending || !selected.size} onClick={submitBatch}>
                  {batch.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Ajouter les {selected.size} sélectionné(s)
                </Button>
              )}
            </div>
            <p className="text-xs text-muted-foreground">Détecte plusieurs jeux d&apos;un coup et te les affiche avant ajout, pour confirmation.</p>

            {detected && (
              detected.length === 0 ? (
                <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">Aucun jeu détecté. Vérifie les liens/titres.</p>
              ) : (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">
                      {detected.length} jeu(x) trouvé(s) · <span className="font-semibold text-foreground">{selected.size} sélectionné(s)</span>
                    </span>
                    <Button type="button" variant="ghost" size="sm" onClick={toggleAll}>
                      {selected.size ? "Tout décocher" : "Tout cocher"}
                    </Button>
                  </div>
                  <div className="max-h-[360px] space-y-1.5 overflow-y-auto pr-1">
                    {detected.map((d, i) => <PreviewRow key={i} d={d} checked={selected.has(i)}
                      onCheck={(c) => setSelected((prev) => { const n = new Set(prev); c ? n.add(i) : n.delete(i); return n; })} />)}
                  </div>
                </div>
              )
            )}
          </TabsContent>
        </Tabs>
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
      <Checkbox className="mt-1" checked={checked} disabled={dup} onCheckedChange={(c) => onCheck(!!c)} />
      {d.image ? <img src={d.image} alt="" className="h-14 w-28 shrink-0 rounded object-cover" />
        : <span className="flex h-14 w-28 shrink-0 items-center justify-center rounded bg-muted text-lg">🎮</span>}
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-semibold">{d.titre}</span>
          {dup && <Badge variant="secondary" className="shrink-0">déjà présent</Badge>}
        </div>
        <div className="flex flex-wrap gap-1">
          {note != null && <Badge variant="outline">⭐ {note}</Badge>}
          {d.gratuit ? <Badge variant="outline">Gratuit</Badge> : p != null && <Badge variant="outline">{p} {dev}</Badge>}
          {year && <Badge variant="outline">{year}</Badge>}
          {d.nbJoueurs && <Badge variant="outline">👥 {d.nbJoueurs}</Badge>}
          {d.modes?.solo && <Badge variant="outline">Solo</Badge>}
          {d.modes?.coop && <Badge variant="outline">Coop</Badge>}
          {d.modes?.pvp && <Badge variant="outline">PvP</Badge>}
          {(d.plateformes ?? []).slice(0, 4).map((pl, i) => <Badge key={i} variant="secondary">{pl}</Badge>)}
        </div>
        {d.genre && <div className="truncate text-xs text-muted-foreground">{d.genre}</div>}
      </div>
    </label>
  );
}
