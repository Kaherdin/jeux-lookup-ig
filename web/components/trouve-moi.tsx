"use client";
import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import Link from "next/link";

import { useAction } from "next-safe-action/hooks";
import { toast } from "sonner";
import { Loader2, X, Check, RotateCcw, Bookmark, ArrowLeft, Volume2, VolumeX } from "lucide-react";
import { proposerJeux } from "@/app/actions/games";
import { ajouterMatch } from "@/lib/matchs";
import { BandeauMatchs, MatchsDialog, useMatchs } from "@/components/matchs";
import { questionsPertinentes, critereDe, resume, type Criteres } from "@/lib/quiz";
import type { Proposition } from "@/lib/selection";
import { https, noteVal, prixVal, dureeVal } from "@/lib/tri";
import { estDeLaFamille } from "@/lib/categories";
import type { Game } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn, gameHref } from "@/lib/utils";

/** un jeu venu d'IGDB quand le catalogue n'avait rien à proposer */
type Externe = { igdbId: number; titre: string; cover: string; annee: number | null; note: number | null; plateformes: string[]; genres: string };

type Etape = "quiz" | "defile" | "fin";

/** au-delà de ce déplacement, lâcher la carte vaut décision */
const SEUIL = 110;

export function TrouveMoi() {
  const [etape, setEtape] = useState<Etape>("quiz");
  const [reponses, setReponses] = useState<Record<string, string[]>>({});
  const [iq, setIq] = useState(0);
  const [file, setFile] = useState<Proposition[]>([]);
  const [externes, setExternes] = useState<Externe[]>([]);
  const [i, setI] = useState(0);
  const [gardes, setGardes] = useState<Game[]>([]);

  const criteres = useMemo(() => critereDe(reponses), [reponses]);
  const posees = useMemo(() => questionsPertinentes(criteres), [criteres]);
  const question = posees[iq];

  const recherche = useAction(proposerJeux, {
    onSuccess: ({ data }) => {
      const props = (data?.props ?? []) as Proposition[];
      setFile(props);
      setExternes((data?.ailleurs ?? []) as Externe[]);
      setI(0);
      setEtape("defile");
      if (!props.length && !(data?.ailleurs ?? []).length) {
        toast.warning("Rien trouvé, même en cherchant ailleurs — élargis un critère.");
      }
    },
    onError: ({ error }) => toast.error(error.serverError ?? "La recherche a échoué."),
  });

  const repondre = useCallback((qid: string, choixId: string, multiple: boolean) => {
    setReponses((prev) => {
      const dejala = prev[qid] ?? [];
      if (!multiple) return { ...prev, [qid]: [choixId] };
      const n = dejala.includes(choixId) ? dejala.filter((x) => x !== choixId) : [...dejala, choixId];
      return { ...prev, [qid]: n };
    });
  }, []);

  /** avance d'une question, ou lance la recherche si c'était la dernière */
  const suivante = useCallback(() => {
    // la liste des questions pertinentes vient de changer si on a modifié « joueurs » :
    // on la recalcule à partir des réponses à jour plutôt que de l'index courant
    if (iq + 1 < posees.length) setIq(iq + 1);
    else recherche.execute({ criteres: criteres as Criteres });
  }, [iq, posees.length, criteres, recherche]);

  /**
   * Tout se fait ici, à plat. Passer par les updaters de setState pour lire la carte
   * courante revenait à écrire dans le stockage — donc à mettre à jour la barre du haut
   * — pendant le rendu de ce composant, ce que React refuse à juste titre : un updater
   * doit être pur, il peut être rejoué.
   */
  const trancher = useCallback((garder: boolean) => {
    const p = file[i];
    if (p && garder) {
      // la sélection survit à la session et se consulte depuis n'importe quelle page
      ajouterMatch(p.jeu);
      setGardes((g) => (g.some((x) => x.id === p.jeu.id) ? g : [...g, p.jeu]));
    }
    const suiv = i + 1;
    setI(suiv);
    if (suiv >= file.length) setEtape("fin");
  }, [file, i]);

  // ── clavier : le geste ne doit jamais être le seul moyen ────────────
  useEffect(() => {
    if (etape !== "defile") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") { e.preventDefault(); trancher(true); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); trancher(false); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [etape, trancher]);

  function recommencer() {
    setReponses({}); setIq(0); setFile([]); setExternes([]); setI(0); setGardes([]); setEtape("quiz");
  }

  // ── questionnaire ───────────────────────────────────────────────────
  if (etape === "quiz") {
    const choisis = reponses[question?.id ?? ""] ?? [];
    const peutAvancer = question?.multiple ? true : choisis.length > 0;
    return (
      <div className="mx-auto flex min-h-[70dvh] w-full max-w-lg flex-col justify-center gap-6 px-4">
        <div className="flex items-center gap-2">
          {iq > 0 && (
            <Button variant="ghost" size="sm" onClick={() => setIq(iq - 1)} aria-label="Question précédente">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          )}
          <div className="flex flex-1 gap-1.5" role="progressbar" aria-valuenow={iq + 1} aria-valuemax={posees.length}>
            {posees.map((q, k) => (
              <span key={q.id} className={cn("h-1.5 flex-1 rounded-full transition", k <= iq ? "bg-primary" : "bg-muted")} />
            ))}
          </div>
        </div>

        <h1 className="text-center text-2xl font-bold tracking-tight sm:text-3xl">{question?.titre}</h1>

        <div className="grid gap-2.5">
          {question?.choix.map((c) => {
            const on = choisis.includes(c.id);
            return (
              <button key={c.id} onClick={() => { repondre(question.id, c.id, !!question.multiple); if (!question.multiple) setTimeout(suivante, 120); }}
                className={cn("flex items-center gap-3 rounded-xl border-2 px-4 py-3.5 text-left transition active:scale-[0.99]",
                  on ? "border-primary bg-primary/10" : "border-border hover:border-primary/50 hover:bg-muted/50")}>
                <span className="text-2xl">{c.emoji}</span>
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">{c.label}</span>
                  {c.aide && <span className="block text-xs text-muted-foreground">{c.aide}</span>}
                </span>
                {on && <Check className="h-5 w-5 shrink-0 text-primary" />}
              </button>
            );
          })}
        </div>

        <Button size="lg" disabled={!peutAvancer || recherche.isPending} onClick={suivante}>
          {recherche.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {iq + 1 >= posees.length ? "Trouve-moi un jeu" : question?.multiple ? "Continuer" : "Suivant"}
        </Button>
        {question?.multiple && <p className="-mt-3 text-center text-xs text-muted-foreground">Plusieurs réponses possibles — ou aucune, si tu es ouvert à tout.</p>}
      </div>
    );
  }

  // ── défilé ──────────────────────────────────────────────────────────
  if (etape === "defile") {
    return (
      <Defile
        file={file} i={i} criteres={criteres}
        onTrancher={trancher}
        onFin={() => setEtape("fin")}
        gardes={gardes.length}
      />
    );
  }

  // ── récapitulatif ───────────────────────────────────────────────────
  return <Fin externes={externes} vus={i} onRecommencer={recommencer} />;
}

/** La pile de cartes. Une seule décision à la fois, c'est tout l'intérêt. */
function Defile({
  file, i, criteres, onTrancher, onFin, gardes,
}: {
  file: Proposition[]; i: number; criteres: Criteres;
  onTrancher: (garder: boolean) => void; onFin: () => void; gardes: number;
}) {
  const [dx, setDx] = useState(0);
  // le choix du son vaut pour la session : le refaire à chaque carte serait pénible
  const [son, setSon] = useState(false);
  const [glisse, setGlisse] = useState(false);
  const depart = useRef(0);
  const carte = useRef<HTMLDivElement>(null);
  /**
   * Le geste se pilote par des refs, pas par l'état React : un doigt rapide envoie ses
   * premiers pointermove dans le même tick que le pointerdown, où `glisse` vaut encore
   * false et `dx` encore 0. La carte manquait alors le début du mouvement, et lâcher
   * tôt décidait sur une valeur périmée. L'état ne sert plus qu'à couper la transition.
   */
  const actif = useRef(false);
  const dxRef = useRef(0);

  const p = file[i];
  const suivante = file[i + 1];

  useEffect(() => { setDx(0); dxRef.current = 0; actif.current = false; setGlisse(false); }, [i]);

  if (!p) {
    return (
      <div className="mx-auto flex min-h-[60dvh] max-w-lg flex-col items-center justify-center gap-4 px-4 text-center">
        <p className="text-lg font-semibold">C&apos;est tout pour cette fois.</p>
        <Button onClick={onFin}>Voir ce que j&apos;ai gardé</Button>
      </div>
    );
  }

  const finir = (garder: boolean) => onTrancher(garder);

  const onDown = (e: React.PointerEvent) => {
    depart.current = e.clientX;
    actif.current = true;
    dxRef.current = 0;
    setGlisse(true);
    // la capture garde le geste même si le doigt sort de la carte ; elle échoue sur
    // certains pointeurs synthétiques, et ce n'est pas une raison d'abandonner le geste
    try { carte.current?.setPointerCapture(e.pointerId); } catch { /* sans capture, tant pis */ }
  };
  const onMove = (e: React.PointerEvent) => {
    if (!actif.current) return;
    dxRef.current = e.clientX - depart.current;
    setDx(dxRef.current);
  };
  const onUp = () => {
    if (!actif.current) return;
    actif.current = false;
    setGlisse(false);
    if (Math.abs(dxRef.current) > SEUIL) finir(dxRef.current > 0);
    else { dxRef.current = 0; setDx(0); }
  };

  const g = p.jeu;
  /**
   * La machine demandée passe devant. Terraria est listé sur quinze plateformes, Switch
   * en quinzième : demander « Nintendo » et lire « Stadia · PS3 · PS4 » sur la carte
   * donne l'impression que le filtre est cassé, alors qu'il a raison.
   */
  const machines = (() => {
    const toutes = g.plateformes ?? [];
    if (!criteres.plateforme) return toutes.slice(0, 3);
    const k = criteres.plateforme;
    return [...toutes.filter((x) => estDeLaFamille(x, k)), ...toutes.filter((x) => !estDeLaFamille(x, k))].slice(0, 3);
  })();
  const note = noteVal(g);
  const prix = prixVal(g);
  const heures = dureeVal(g);
  const devise = g.prix?.devise ?? g.prixPsn?.devise ?? "CHF";
  const intention = dx > 40 ? "garder" : dx < -40 ? "passer" : null;

  return (
    <div className="mx-auto w-full max-w-lg px-4">
      <div className="mb-3 flex items-center justify-between text-sm text-muted-foreground">
        <span>{i + 1} / {file.length}</span>
        <span>{gardes} gardé{gardes > 1 ? "s" : ""}</span>
      </div>

      <div className="relative h-[62dvh] min-h-[420px] select-none">
        {/* la carte suivante, en dessous : on voit qu'il y a une suite */}
        {suivante && (
          <div className="absolute inset-0 scale-[0.96] rounded-2xl border bg-card opacity-60" aria-hidden />
        )}

        <div
          ref={carte}
          onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
          className={cn("absolute inset-0 touch-none overflow-hidden rounded-2xl border-2 bg-card shadow-xl",
            !glisse && "transition-transform duration-200",
            intention === "garder" ? "border-emerald-500" : intention === "passer" ? "border-rose-500" : "border-border")}
          style={{ transform: `translateX(${dx}px) rotate(${dx / 22}deg)`, cursor: glisse ? "grabbing" : "grab" }}
        >
          {/* verdict en cours, lisible avant même de lâcher */}
          {intention && (
            <div className={cn("absolute left-1/2 top-6 z-10 -translate-x-1/2 rounded-lg border-2 px-4 py-1.5 text-lg font-black uppercase tracking-wider",
              intention === "garder" ? "border-emerald-500 text-emerald-500" : "border-rose-500 text-rose-500")}>
              {intention === "garder" ? "Je garde" : "Je passe"}
            </div>
          )}

          <Media g={g} son={son} onSon={() => setSon((s) => !s)} />

          <div className="flex h-1/2 flex-col gap-2 overflow-y-auto p-4">
            <div className="flex items-start justify-between gap-2">
              <h2 className="text-xl font-bold leading-tight">{g.titre}</h2>
              {note != null && (
                <span className="shrink-0 rounded-md bg-primary/15 px-2 py-1 text-sm font-extrabold text-primary">{note}</span>
              )}
            </div>

            {p.surprise && (
              <span className="w-fit rounded-full bg-amber-500/15 px-2.5 py-1 text-[11px] font-semibold text-amber-500">
                ✨ Hors de tes critères — mais ça vaut le coup d&apos;œil
              </span>
            )}

            <div className="flex flex-wrap gap-1.5 text-[11px] text-muted-foreground">
              {g.nbJoueurs && <Etiq>👥 {g.nbJoueurs}</Etiq>}
              {heures > 0 && <Etiq>⏱ {g.dureeVie}</Etiq>}
              {g.gratuit ? <Etiq>🆓 Gratuit</Etiq> : prix != null && <Etiq>{prix} {devise}</Etiq>}
              {machines.map((pl) => <Etiq key={pl}>{pl}</Etiq>)}
            </div>

            {!!p.raisons.length && (
              <ul className="space-y-0.5 text-sm text-muted-foreground">
                {p.raisons.map((r) => <li key={r}>· {r}</li>)}
              </ul>
            )}

            {g.genre && <p className="text-xs text-muted-foreground">{g.genre}</p>}

            <Link href={gameHref(g.listSlug ?? "", g.titre)} target="_blank"
              className="mt-auto w-fit text-xs text-muted-foreground underline hover:text-primary">
              Voir la fiche ↗
            </Link>
          </div>
        </div>
      </div>

      <div className="mt-5 flex items-center justify-center gap-4">
        <Button size="lg" variant="outline" onClick={() => finir(false)}
          className="h-16 w-16 rounded-full border-2 border-rose-500/40 p-0 text-rose-500 hover:bg-rose-500/10" aria-label="Passer">
          <X className="h-7 w-7" />
        </Button>
        <Button size="lg" variant="outline" onClick={() => finir(true)}
          className="h-16 w-16 rounded-full border-2 border-emerald-500/40 p-0 text-emerald-500 hover:bg-emerald-500/10" aria-label="Garder">
          <Check className="h-7 w-7" />
        </Button>
      </div>
      <p className="mt-3 text-center text-xs text-muted-foreground">
        Glisse la carte, ou utilise ← et → au clavier.
      </p>
      <BandeauMatchs />
      <div className="mt-1 flex flex-wrap justify-center gap-1.5 text-[11px] text-muted-foreground">
        {resume(criteres).map((r) => <span key={r} className="rounded-full bg-muted px-2 py-0.5">{r}</span>)}
      </div>
    </div>
  );
}

/**
 * La moitié haute de la carte : le trailer s'il existe, sinon la jaquette.
 *
 * Il se lance tout seul et sans habillage — pas de bouton play à viser, pas de barre de
 * lecture : on regarde, on tranche. 495 jeux du catalogue ont une vidéo YouTube, aucun
 * n'a de mp4 Steam pour l'instant, mais les deux chemins sont là.
 *
 * `pointer-events-none` sur le média est ce qui rend le tout compatible avec le geste :
 * sans ça, une iframe avale le pointeur et la carte ne suit plus le doigt.
 */
function Media({ g, son, onSon }: { g: Game; son: boolean; onSon: () => void }) {
  const yt = g.trailerYoutube?.trim();
  const src = yt
    // nocookie : rien n'est déposé chez le visiteur tant qu'il n'a pas lancé la vidéo
    ? `https://www.youtube-nocookie.com/embed/${yt}?autoplay=1&mute=${son ? 0 : 1}&controls=0&loop=1&playlist=${yt}` +
      `&modestbranding=1&rel=0&playsinline=1&disablekb=1&fs=0&iv_load_policy=3`
    : null;

  return (
    <div className="relative h-1/2 w-full overflow-hidden bg-muted">
      {g.trailer ? (
        <video key={g.id} src={https(g.trailer)} poster={https(g.image)} autoPlay muted={!son} loop playsInline
          className="pointer-events-none h-full w-full object-cover" />
      ) : src ? (
        <iframe key={`${g.id}-${son}`} src={src} title={`Trailer de ${g.titre}`} allow="autoplay; encrypted-media"
          // la vidéo déborde volontairement du cadre : YouTube ajoute des bandes noires
          // sur une 16/9 forcée dans un format plus carré, et on veut du plein cadre
          className="pointer-events-none absolute left-1/2 top-1/2 h-[calc(100%+120px)] w-[177.78%] min-w-full -translate-x-1/2 -translate-y-1/2 border-0" />
      ) : g.image ? (
        <img src={https(g.image)} alt="" draggable={false} className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-6xl">🎮</div>
      )}

      {(g.trailer || src) && (
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); onSon(); }}
          className="absolute right-2 top-2 z-10 rounded-full bg-black/60 p-2 text-white backdrop-blur transition hover:bg-black/80"
          aria-label={son ? "Couper le son" : "Activer le son"}
        >
          {son ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
        </button>
      )}
    </div>
  );
}

const Etiq = ({ children }: { children: React.ReactNode }) => (
  <span className="rounded-md bg-muted px-1.5 py-0.5 font-semibold">{children}</span>
);

/**
 * Fin de session. La sélection n'est plus une notion locale à cet écran : c'est la même
 * que dans la barre du haut et le bandeau du défilé, et c'est la fenêtre commune qui
 * sait en faire une liste — inutile de refaire ici un second formulaire de création.
 */
function Fin({
  externes, vus, onRecommencer,
}: {
  externes: Externe[]; vus: number; onRecommencer: () => void;
}) {
  const matchs = useMatchs();
  const [ouvert, setOuvert] = useState(false);
  const n = matchs.length;

  return (
    <div className="mx-auto w-full max-w-lg space-y-5 px-4 py-6">
      <div className="text-center">
        <h1 className="text-2xl font-bold">
          {n ? `${n} jeu${n > 1 ? "x" : ""} dans ta sélection` : "Rien gardé cette fois"}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {vus} proposition{vus > 1 ? "s" : ""} passée{vus > 1 ? "s" : ""} en revue.
        </p>
      </div>

      {!!n && (
        <ul className="space-y-2">
          {matchs.slice(0, 8).map((m) => (
            <li key={m.id} className="flex items-center gap-3 rounded-lg border p-2">
              {m.image ? <img src={https(m.image)} alt="" className="h-12 w-20 shrink-0 rounded object-cover" />
                : <span className="flex h-12 w-20 shrink-0 items-center justify-center rounded bg-muted">🎮</span>}
              <span className="min-w-0 flex-1 truncate font-semibold">{m.titre}</span>
              {m.note != null && <span className="shrink-0 text-sm text-muted-foreground">{m.note}</span>}
            </li>
          ))}
          {n > 8 && <li className="text-center text-sm text-muted-foreground">et {n - 8} de plus…</li>}
        </ul>
      )}

      {!!n && (
        <Button className="w-full" size="lg" onClick={() => setOuvert(true)}>
          <Bookmark className="mr-2 h-4 w-4" /> Voir ma sélection et en faire une liste
        </Button>
      )}
      <MatchsDialog ouvert={ouvert} onOuvert={setOuvert} matchs={matchs} />

      {/* le catalogue n'avait rien : ce qu'IGDB propose, clairement séparé */}
      {!!externes.length && (
        <div className="space-y-2 rounded-xl border border-dashed p-3">
          <p className="text-sm font-semibold">Hors de ta collection</p>
          <p className="text-xs text-muted-foreground">
            Ton catalogue n&apos;avait pas grand-chose pour ces critères — voilà ce qui existe ailleurs.
          </p>
          <ul className="space-y-1.5">
            {externes.slice(0, 8).map((e) => (
              <li key={e.igdbId} className="flex items-center gap-2 text-sm">
                {e.cover && <img src={e.cover} alt="" className="h-10 w-7 shrink-0 rounded object-cover" />}
                <span className="min-w-0 flex-1 truncate">{e.titre}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{e.annee ?? ""}{e.note ? ` · ⭐ ${e.note}` : ""}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap justify-center gap-2">
        <Button variant="outline" onClick={onRecommencer}>
          <RotateCcw className="mr-2 h-4 w-4" /> Une autre session
        </Button>
        <Button variant="ghost" asChild><Link href="/">Retour au catalogue</Link></Button>
      </div>
    </div>
  );
}
