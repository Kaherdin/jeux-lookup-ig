"use client";
import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { toast } from "sonner";
import { Heart, Loader2, Trash2, Bookmark, X } from "lucide-react";
import { copyToList } from "@/app/actions/games";
import { createNewList } from "@/app/actions/lists";
import { lireMatchs, retirerMatch, viderMatchs, surMatchs, OUVRIR_MATCHS, type Match } from "@/lib/matchs";
import { https } from "@/lib/tri";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/**
 * Les matchs viennent du stockage local : ils n'existent donc pas au premier rendu, qui
 * se fait sur le serveur. On part toujours d'une liste vide et on la remplit après le
 * montage — sinon le HTML du serveur et celui du client divergent, et React proteste.
 */
export function useMatchs() {
  const [matchs, setMatchs] = useState<Match[]>([]);
  useEffect(() => {
    setMatchs(lireMatchs());
    return surMatchs(setMatchs);
  }, []);
  return matchs;
}

/** Le bouton de la barre du haut : n'apparaît qu'une fois qu'il y a quelque chose à voir. */
export function MatchsBouton() {
  const matchs = useMatchs();
  const [ouvert, setOuvert] = useState(false);

  // le menu du compte n'a pas à connaître cet état : il crie, on écoute
  useEffect(() => {
    const ouvre = () => setOuvert(true);
    window.addEventListener(OUVRIR_MATCHS, ouvre);
    return () => window.removeEventListener(OUVRIR_MATCHS, ouvre);
  }, []);

  if (!matchs.length) return <MatchsDialog ouvert={ouvert} onOuvert={setOuvert} matchs={matchs} />;
  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOuvert(true)} aria-label={`Mes matchs (${matchs.length})`}>
        <Heart className="mr-1 h-4 w-4 fill-rose-500 text-rose-500" />
        <span className="tabular-nums">{matchs.length}</span>
      </Button>
      <MatchsDialog ouvert={ouvert} onOuvert={setOuvert} matchs={matchs} />
    </>
  );
}

/**
 * Le bandeau du bas, pendant le défilé : les dernières jaquettes gardées, pour voir
 * sa moisson sans quitter la carte en cours.
 */
export function BandeauMatchs() {
  const matchs = useMatchs();
  const [ouvert, setOuvert] = useState(false);
  if (!matchs.length) return null;
  return (
    <>
      <button onClick={() => setOuvert(true)}
        className="mx-auto mt-4 flex w-full max-w-lg items-center gap-3 rounded-xl border bg-card/60 px-3 py-2 text-left transition hover:border-primary hover:bg-card">
        <span className="flex -space-x-3">
          {matchs.slice(0, 5).map((m) => (
            m.image
              ? <img key={m.id} src={https(m.image)} alt="" className="h-9 w-9 rounded-full border-2 border-background object-cover" />
              : <span key={m.id} className="flex h-9 w-9 items-center justify-center rounded-full border-2 border-background bg-muted text-xs">🎮</span>
          ))}
        </span>
        <span className="min-w-0 flex-1 text-sm">
          <span className="font-semibold">{matchs.length} match{matchs.length > 1 ? "s" : ""}</span>
          <span className="ml-1 text-muted-foreground">— voir ma sélection</span>
        </span>
        <Heart className="h-4 w-4 shrink-0 fill-rose-500 text-rose-500" />
      </button>
      <MatchsDialog ouvert={ouvert} onOuvert={setOuvert} matchs={matchs} />
    </>
  );
}

export function MatchsDialog({
  ouvert, onOuvert, matchs,
}: { ouvert: boolean; onOuvert: (v: boolean) => void; matchs: Match[] }) {
  const router = useRouter();
  const [nom, setNom] = useState("");
  const [saisie, setSaisie] = useState(false);

  const copie = useAction(copyToList, {
    onSuccess: ({ data }) => {
      toast.success(`« ${data?.name} » : ${data?.added ?? 0} jeu(x) enregistré(s).`);
      onOuvert(false);
      if (data?.slug) router.push(`/l/${data.slug}`);
    },
    onError: ({ error }) => toast.error(error.serverError ?? "Échec de l'enregistrement."),
  });
  const creation = useAction(createNewList, {
    onSuccess: ({ data }) => { if (data?.slug) copie.execute({ ids: matchs.map((m) => m.id), toSlug: data.slug }); },
    onError: ({ error }) => toast.error(error.serverError ?? "Échec de la création."),
  });
  const occupe = creation.isPending || copie.isPending;

  const vider = useCallback(() => {
    if (window.confirm("Vider toute la sélection ?")) { viderMatchs(); toast.success("Sélection vidée."); }
  }, []);

  return (
    <Dialog open={ouvert} onOpenChange={onOuvert}>
      <DialogContent className="max-h-[85dvh] w-full overflow-x-hidden overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Heart className="h-5 w-5 fill-rose-500 text-rose-500" />
            Ma sélection {!!matchs.length && <span className="text-muted-foreground">({matchs.length})</span>}
          </DialogTitle>
        </DialogHeader>

        {!matchs.length ? (
          <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            Rien pour l&apos;instant. Les jeux que tu gardes pendant une session apparaissent ici.
          </p>
        ) : (
          <>
            <ul className="min-w-0 space-y-2">
              {matchs.map((m) => (
                <li key={m.id} className="flex items-center gap-3 rounded-lg border p-2">
                  {m.image
                    ? <img src={https(m.image)} alt="" className="h-12 w-20 shrink-0 rounded object-cover" />
                    : <span className="flex h-12 w-20 shrink-0 items-center justify-center rounded bg-muted">🎮</span>}
                  <span className="min-w-0 flex-1 truncate font-semibold">{m.titre}</span>
                  {m.note != null && <span className="shrink-0 text-sm text-muted-foreground">{m.note}</span>}
                  <Button variant="ghost" size="icon" aria-label={`Retirer ${m.titre}`}
                    onClick={() => retirerMatch(m.id)}>
                    <X className="h-4 w-4" />
                  </Button>
                </li>
              ))}
            </ul>

            {saisie ? (
              <div className="flex flex-wrap items-center gap-2">
                <Input autoFocus value={nom} onChange={(e) => setNom(e.target.value)}
                  placeholder="Nom de la liste…" className="h-9 min-w-0 flex-1"
                  onKeyDown={(e) => { if (e.key === "Enter" && nom.trim().length >= 2) creation.execute({ name: nom.trim(), isPublic: true }); }} />
                <Button disabled={occupe || nom.trim().length < 2} onClick={() => creation.execute({ name: nom.trim(), isPublic: true })}>
                  {occupe && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Créer
                </Button>
                <Button variant="ghost" onClick={() => setSaisie(false)}>Annuler</Button>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                <Button className="flex-1" onClick={() => setSaisie(true)}>
                  <Bookmark className="mr-2 h-4 w-4" /> En faire une liste
                </Button>
                <Button variant="ghost" onClick={vider} aria-label="Vider la sélection">
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            )}
            <p className={cn("text-xs text-muted-foreground")}>
              La sélection reste dans ce navigateur. En faire une liste la rend consultable partout.
            </p>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
