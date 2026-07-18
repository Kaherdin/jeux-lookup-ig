"use client";
import type { Game } from "@/lib/types";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const https = (u?: string | null) => (u ? u.replace(/^http:/, "https:") : "");
const prixVal = (g: Game) => g.prix?.meilleur ?? g.prixSteam ?? null;
const noteVal = (g: Game) => g.note ?? g.metacritic ?? g.steamPct ?? null;

export function GameDetailDialog({ g, trigger }: { g: Game; trigger: React.ReactNode }) {
  const p = prixVal(g);
  const n = noteVal(g);
  const dev = g.prix?.devise ?? "CHF";
  const m = g.modes ?? {};

  return (
    <Dialog>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl">{g.titre}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="text-sm text-muted-foreground">{[g.genre, g.univers].filter(Boolean).join(" · ")}</div>

          {/* infos */}
          <div className="flex flex-wrap gap-1.5">
            {g.dispo && <Badge>Dispo</Badge>}
            {g.comingSoon && <Badge variant="secondary">Bientôt</Badge>}
            {g.gratuit ? <Badge className="bg-emerald-600">Gratuit</Badge> : p != null && <Badge variant="secondary">{p} {dev}{g.prix?.store ? ` · ${g.prix.store}` : ""}</Badge>}
            {g.bonPlan && <Badge className="bg-orange-500 text-black">Bon plan</Badge>}
            {n != null && <Badge variant="outline">⭐ {n} {g.noteSource ? `(${g.noteSource})` : ""}</Badge>}
            {g.nbJoueurs && <Badge variant="outline">👥 {g.nbJoueurs} joueurs</Badge>}
            {m.solo && <Badge variant="outline">Solo</Badge>}
            {m.coop && <Badge variant="outline">Coop</Badge>}
            {m.pvp && <Badge variant="outline">PvP</Badge>}
            {g.sortieISO && <Badge variant="outline">{g.sortieISO}</Badge>}
            {g.plateformes.map((pl, i) => <Badge key={i} variant="secondary">{pl}</Badge>)}
          </div>

          {/* liens */}
          <div className="flex flex-wrap gap-2">
            {g.urlSteam && <Button asChild size="sm" variant="outline"><a href={g.urlSteam} target="_blank" rel="noopener noreferrer">Steam</a></Button>}
            {g.urlPsn && <Button asChild size="sm" variant="outline"><a href={g.urlPsn} target="_blank" rel="noopener noreferrer">PlayStation</a></Button>}
            {g.urlStore && g.urlStore !== g.urlSteam && <Button asChild size="sm" variant="outline"><a href={g.urlStore} target="_blank" rel="noopener noreferrer">Meilleur prix</a></Button>}
            {g.reel && <Button asChild size="sm" variant="outline"><a href={g.reel} target="_blank" rel="noopener noreferrer">Reel Insta</a></Button>}
          </div>

          {/* trailer */}
          {g.trailer && (
            <video controls playsInline poster={https(g.trailerThumb)} className="w-full rounded-lg" preload="none">
              <source src={https(g.trailer)} />
            </video>
          )}

          {/* galerie */}
          {g.screenshots?.length > 0 && (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {g.screenshots.map((s, i) => (
                <a key={i} href={https(s)} target="_blank" rel="noopener noreferrer">
                  <img src={https(s)} alt="" loading="lazy" className="aspect-video w-full rounded-md object-cover transition hover:opacity-80" />
                </a>
              ))}
            </div>
          )}

          {!g.trailer && !g.screenshots?.length && (
            <p className="text-sm text-muted-foreground">Pas de média disponible pour ce jeu.</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
