"use client";
import type { Game } from "@/lib/types";
import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { toast } from "sonner";
import { Loader2, RefreshCw, Trash2 } from "lucide-react";
import { rescanGame, deleteGameAction } from "@/app/actions/games";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { GameGallery } from "@/components/game-gallery";
import { AddToList } from "@/components/add-to-list";

const https = (u?: string | null) => (u ? u.replace(/^http:/, "https:") : "");
const prixVal = (g: Game) => g.prix?.meilleur ?? g.prixSteam ?? null;
const noteVal = (g: Game) => g.note ?? g.metacritic ?? g.steamPct ?? null;

/** Contenu de la fiche d'un jeu — rendu par la page /l/[slug]/[jeu]. */
export function GameDetail({
  g, slug, canManage, lists = [],
}: { g: Game; slug: string; canManage: boolean; lists?: { slug: string; name: string }[] }) {
  const p = prixVal(g);
  const n = noteVal(g);
  const dev = g.prix?.devise ?? "CHF";
  const router = useRouter();

  const rescan = useAction(rescanGame, {
    onSuccess: () => { toast.success(`« ${g.titre} » re-scanné.`); router.refresh(); },
    onError: ({ error }) => toast.error(error.serverError ?? "Échec du re-scan."),
  });
  const suppr = useAction(deleteGameAction, {
    onSuccess: () => { toast.success(`« ${g.titre} » supprimé.`); router.push(`/l/${slug}`); router.refresh(); },
    onError: ({ error }) => toast.error(error.serverError ?? "Échec de la suppression."),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight">{g.titre}</h1>
          <div className="mt-1 text-sm text-muted-foreground">{[g.genre, g.univers].filter(Boolean).join(" · ")}</div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <AddToList gameId={g.id} lists={lists} currentSlug={slug} />
          {canManage && slug && (
          <>
            <Button size="sm" variant="outline" disabled={rescan.isPending}
              onClick={() => rescan.execute({ slug, titre: g.titre })}>
              {rescan.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-1 h-4 w-4" />} Rescanner
            </Button>
            <Button size="sm" variant="outline" disabled={suppr.isPending}
              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
              onClick={() => { if (confirm(`Supprimer « ${g.titre} » de cette liste ?`)) suppr.execute({ slug, id: g.id }); }}>
              {suppr.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Trash2 className="mr-1 h-4 w-4" />} Supprimer
            </Button>
          </>
          )}
        </div>
      </div>

      {/* infos */}
      <div className="flex flex-wrap gap-1.5">
        {g.dispo && <Badge>Dispo</Badge>}
        {g.comingSoon && <Badge variant="secondary">Bientôt</Badge>}
        {g.gratuit ? <Badge className="bg-emerald-600">Gratuit</Badge> : p != null && <Badge variant="secondary">{p} {dev}{g.prix?.store ? ` · ${g.prix.store}` : ""}</Badge>}
        {g.bonPlan && <Badge className="bg-orange-500 text-black">Bon plan</Badge>}
        {n != null && <Badge variant="outline">⭐ {n} {g.noteSource ? `(${g.noteSource})` : ""}</Badge>}
        {g.envergure && <Badge variant="outline">{g.envergure}</Badge>}
        {g.dureeVie && <Badge variant="outline">⏱ {g.dureeVie}</Badge>}
        {g.sortieISO && <Badge variant="outline">{g.sortieISO}</Badge>}
        {g.plateformes.map((pl, i) => <Badge key={i} variant="secondary">{pl}</Badge>)}
      </div>

      {/* multijoueur précis : local vs en ligne */}
      <MultiInfo g={g} />

      {g.description && <p className="text-sm leading-relaxed text-muted-foreground">{g.description}</p>}

      {(g.developpeur || g.editeur || g.tailleEquipe || g.themes) && (
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
          {g.developpeur && <Info label="Développeur" value={g.developpeur} />}
          {g.editeur && <Info label="Éditeur" value={g.editeur} />}
          {g.tailleEquipe && <Info label="Équipe" value={g.tailleEquipe} estime />}
          {g.themes && <Info label="Thèmes" value={g.themes} />}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {g.urlSteam && <Button asChild size="sm" variant="outline"><a href={g.urlSteam} target="_blank" rel="noopener noreferrer">Steam</a></Button>}
        {g.urlPsn && <Button asChild size="sm" variant="outline"><a href={g.urlPsn} target="_blank" rel="noopener noreferrer">PlayStation</a></Button>}
        {g.urlStore && g.urlStore !== g.urlSteam && <Button asChild size="sm" variant="outline"><a href={g.urlStore} target="_blank" rel="noopener noreferrer">Meilleur prix</a></Button>}
        {g.reel && <Button asChild size="sm" variant="outline"><a href={g.reel} target="_blank" rel="noopener noreferrer">Source</a></Button>}
      </div>

      {/* trailer : mp4 Steam, sinon vidéo YouTube IGDB */}
      {g.trailer ? (
        <video controls playsInline poster={https(g.trailerThumb)} className="w-full rounded-lg" preload="none">
          <source src={https(g.trailer)} />
        </video>
      ) : g.trailerYoutube ? (
        <div className="aspect-video w-full overflow-hidden rounded-lg">
          <iframe className="h-full w-full" src={`https://www.youtube.com/embed/${g.trailerYoutube}`}
            title="trailer" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowFullScreen />
        </div>
      ) : null}

      {g.screenshots?.length > 0 && <GameGallery screenshots={g.screenshots} titre={g.titre} />}

      {!g.trailer && !g.trailerYoutube && !g.screenshots?.length && (
        <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
          Pas de média pour ce jeu.{canManage ? " Un rescan peut en récupérer." : ""}
        </p>
      )}

      {/* debug : toutes les données brutes (repérer les trous / bugs) */}
      <DebugPanel g={g} />
    </div>
  );
}

function MultiInfo({ g }: { g: Game }) {
  const d = (g.modesDetail ?? {}) as Record<string, boolean>;
  const local = g.joueursLocalMax ?? null;
  const online = g.joueursOnlineMax ?? null;
  const hasLocal = !!(local || d.coopCouch || d.pvpCouch || d.coopLan || d.pvpLan || d.splitscreen || d.lancoop);
  const hasOnline = !!(online || d.coopOnline || d.pvpOnline);
  const solo = g.modes?.solo;
  if (!solo && !hasLocal && !hasOnline && !g.nbJoueurs) return null;
  const tags = (kind: "local" | "online") => {
    const parts: string[] = [];
    if (kind === "local") { if (d.coopCouch || d.coopLan) parts.push("coop"); if (d.pvpCouch || d.pvpLan) parts.push("versus"); }
    else { if (d.coopOnline) parts.push("coop"); if (d.pvpOnline) parts.push("versus"); }
    return parts.length ? ` · ${parts.join(" + ")}` : "";
  };
  return (
    <div className="space-y-1.5 rounded-lg border p-3 text-sm">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Comment y jouer</div>
      {solo && <div>🎯 <strong>Solo</strong></div>}
      {hasLocal && <div>🛋️ <strong>Local / canapé</strong>{local ? ` — jusqu'à ${local} joueurs` : ""}{tags("local")}</div>}
      {hasOnline && <div>🌐 <strong>En ligne</strong>{online ? ` — jusqu'à ${online} joueurs` : ""}{tags("online")}</div>}
      {!hasLocal && !hasOnline && g.nbJoueurs && <div>👥 {g.nbJoueurs} joueurs</div>}
      {d.crossPlatform && <div className="text-xs text-muted-foreground">✔ Cross-platform</div>}
      {d.remotePlay && <div className="text-xs text-muted-foreground">✔ Remote Play Together (canapé virtuel)</div>}
    </div>
  );
}

function DebugPanel({ g }: { g: Game }) {
  const rows: [string, unknown][] = [
    ["titre", g.titre], ["genre", g.genre], ["univers", g.univers],
    ["plateformes", g.plateformes?.join(", ")], ["sortieISO", g.sortieISO],
    ["note", g.note], ["noteSource", g.noteSource], ["metacritic", g.metacritic], ["steamPct", g.steamPct],
    ["prix", g.prix ? `${g.prix.meilleur} ${g.prix.devise} · ${g.prix.store}` : null], ["prixSteam", g.prixSteam],
    ["nbJoueurs", g.nbJoueurs], ["nbJoueursMax", g.nbJoueursMax], ["joueursLocalMax", g.joueursLocalMax], ["joueursOnlineMax", g.joueursOnlineMax],
    ["modes", JSON.stringify(g.modes)], ["modesDetail", JSON.stringify(g.modesDetail)],
    ["developpeur", g.developpeur], ["editeur", g.editeur], ["envergure", g.envergure], ["dureeVie", g.dureeVie], ["tailleEquipe", g.tailleEquipe], ["themes", g.themes],
    ["image", g.image], ["screenshots", g.screenshots?.length], ["trailer", g.trailer], ["trailerYoutube", g.trailerYoutube],
    ["urlSteam", g.urlSteam], ["urlPsn", g.urlPsn], ["description", g.description],
  ];
  const isEmpty = (v: unknown) => v === null || v === undefined || v === "" || v === 0;
  const missing = rows.filter(([, v]) => isEmpty(v)).map(([k]) => k);
  return (
    <details className="rounded-lg border text-xs">
      <summary className="cursor-pointer select-none p-2 font-semibold">🔧 Toutes les données ({missing.length} champ·s vide·s)</summary>
      <div className="space-y-1 border-t p-2">
        {rows.map(([k, v]) => (
          <div key={k} className="flex gap-2">
            <span className="w-32 shrink-0 text-muted-foreground">{k}</span>
            <span className={cn("min-w-0 break-words", isEmpty(v) && "italic text-destructive/70")}>{isEmpty(v) ? "— vide" : String(v)}</span>
          </div>
        ))}
      </div>
    </details>
  );
}

function Info({ label, value, estime }: { label: string; value: string; estime?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="truncate font-medium" title={value}>
        {value}
        {estime && <span className="ml-1 text-[10px] font-normal text-muted-foreground">(estimé)</span>}
      </div>
    </div>
  );
}
