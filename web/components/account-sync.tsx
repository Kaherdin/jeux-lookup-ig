"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { toast } from "sonner";
import { Loader2, Check, RefreshCw } from "lucide-react";
import { importPsn, importSteam } from "@/app/actions/games";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Etat = { jeux: number };

export function AccountSync({
  steam, psn,
}: { steam: Etat & { lie: boolean }; psn: Etat }) {
  const router = useRouter();
  const [npsso, setNpsso] = useState("");

  const syncSteam = useAction(importSteam, {
    onSuccess: ({ data }) => {
      toast.success(`${data?.added ?? 0} nouveau(x) jeu(x) Steam (sur ${data?.total ?? 0}).`);
      router.refresh();
    },
    onError: ({ error }) => toast.error(error.serverError ?? "Échec de la synchronisation Steam."),
  });
  const syncPsn = useAction(importPsn, {
    onSuccess: ({ data }) => {
      toast.success(`${data?.added ?? 0} nouveau(x) jeu(x) PlayStation (sur ${data?.total ?? 0}).`);
      setNpsso("");
      router.refresh();
    },
    onError: ({ error }) => toast.error(error.serverError ?? "Échec de la synchronisation PlayStation."),
  });

  return (
    <div className="mt-4 space-y-4">
      {/* ── Steam ─────────────────────────────────────────────────── */}
      <Carte titre="Steam" etat={steam.lie ? `Lié · ${steam.jeux} jeux` : "Non lié"} ok={steam.lie}>
        <p className="text-sm text-muted-foreground">
          Connexion via Steam (OpenID) — aucun mot de passe ne transite par l&apos;app. Ton profil doit être
          <strong> public</strong> : Steam → Profil → Modifier le profil → Confidentialité → « Détails du jeu » = Public.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant={steam.lie ? "outline" : "default"}>
            <a href="/api/steam/login">{steam.lie ? "Relier un autre compte" : "Se connecter avec Steam"}</a>
          </Button>
          {steam.lie && (
            <Button variant="secondary" disabled={syncSteam.isPending} onClick={() => syncSteam.execute({})}>
              {syncSteam.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-1 h-4 w-4" />} Synchroniser
            </Button>
          )}
        </div>
      </Carte>

      {/* ── PlayStation ───────────────────────────────────────────── */}
      <Carte titre="PlayStation" etat={psn.jeux ? `Lié · ${psn.jeux} jeux` : "Non lié"} ok={!!psn.jeux}>
        <p className="text-sm text-muted-foreground">
          Sony n&apos;offre pas de connexion officielle : on passe par un jeton <code className="rounded bg-muted px-1">NPSSO</code>,
          à recoller tous les ~2 mois.
        </p>
        <div className="flex flex-wrap gap-2">
          <Input value={npsso} onChange={(e) => setNpsso(e.target.value)} placeholder="Colle ton token NPSSO…" className="max-w-xs" />
          <Button disabled={syncPsn.isPending || npsso.trim().length < 32} onClick={() => syncPsn.execute({ npsso: npsso.trim() })}>
            {syncPsn.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Synchroniser
          </Button>
        </div>
        <ol className="ml-4 list-decimal space-y-0.5 text-xs text-muted-foreground">
          <li>Connecte-toi sur <a className="underline" href="https://www.playstation.com" target="_blank" rel="noopener noreferrer">playstation.com</a></li>
          <li>Dans le même navigateur, ouvre <a className="underline" href="https://ca.account.sony.com/api/v1/ssocookie" target="_blank" rel="noopener noreferrer">ce lien</a></li>
          <li>Copie la valeur de <code className="rounded bg-muted px-1">npsso</code> et colle-la ci-dessus</li>
        </ol>
      </Carte>

      {/* ── Nintendo ──────────────────────────────────────────────── */}
      <Carte titre="Nintendo" etat="Impossible" ok={false}>
        <p className="text-sm text-muted-foreground">
          Nintendo n&apos;expose <strong>aucune API</strong> permettant de lister les jeux d&apos;un compte, ni officielle
          ni tolérée — il n&apos;y a rien à brancher, et ça ne dépend pas de nous. En attendant, le plus simple est
          d&apos;ajouter tes jeux Switch à la main : colle leurs titres (un par ligne) dans « Ajouter des jeux », ou
          colle un lien de la boutique Nintendo, qui est reconnu.
        </p>
      </Carte>
    </div>
  );
}

function Carte({
  titre, etat, ok, children,
}: { titre: string; etat: string; ok: boolean; children: React.ReactNode }) {
  return (
    <section className="space-y-3 rounded-xl border p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-base font-semibold">{titre}</h3>
        <span className={ok
          ? "inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-semibold text-emerald-500"
          : "rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground"}>
          {ok && <Check className="h-3 w-3" />}{etat}
        </span>
        {ok && (
          <Link href="/?f=possede" className="ml-auto text-sm text-primary hover:underline">Voir ces jeux</Link>
        )}
      </div>
      {children}
    </section>
  );
}
