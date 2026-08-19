"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { toast } from "sonner";
import { Loader2, ListPlus, X } from "lucide-react";
import { copyToList } from "@/app/actions/games";
import { createNewList } from "@/app/actions/lists";
import type { Game } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/**
 * Barre flottante de sélection : n'apparaît qu'avec au moins un jeu coché.
 * Permet de verser la sélection dans une liste existante ou dans une liste créée
 * à la volée (possible aussi sans compte — elle sera alors collaborative).
 */
export function SelectionBar({
  games, lists, currentSlug, onClear,
}: {
  games: Game[];
  lists: { slug: string; name: string }[];
  currentSlug: string;
  onClear: () => void;
  canManage?: boolean;
}) {
  const router = useRouter();
  const autres = lists.filter((l) => l.slug !== currentSlug);
  const [cible, setCible] = useState(autres[0]?.slug ?? "");
  const [nouveau, setNouveau] = useState(false);
  const [nom, setNom] = useState("");

  const copie = useAction(copyToList, {
    onSuccess: ({ data }) => {
      toast.success(`${data?.added ?? 0} jeu(x) ajouté(s) à « ${data?.name} ».`, {
        action: data?.slug ? { label: "Voir", onClick: () => router.push(`/l/${data.slug}`) } : undefined,
      });
      onClear();
      router.refresh();
    },
    onError: ({ error }) => toast.error(error.serverError ?? "Échec de l'ajout à la liste."),
  });

  const creation = useAction(createNewList, {
    onSuccess: ({ data }) => {
      if (data?.slug) copie.execute({ ids: games.map((g) => g.id), toSlug: data.slug });
      setNouveau(false);
      setNom("");
    },
    onError: ({ error }) => toast.error(error.serverError ?? "Échec de la création de la liste."),
  });

  if (!games.length) return null;
  const busy = copie.isPending || creation.isPending;

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 backdrop-blur">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-2 px-4 py-3">
        <span className="text-sm font-semibold">
          {games.length} jeu{games.length > 1 ? "x" : ""} sélectionné{games.length > 1 ? "s" : ""}
        </span>

        {nouveau ? (
          <div className="flex flex-1 flex-wrap items-center gap-2">
            <Input autoFocus value={nom} onChange={(e) => setNom(e.target.value)} placeholder="Nom de la nouvelle liste…"
              className="min-w-[180px] max-w-xs"
              onKeyDown={(e) => { if (e.key === "Enter" && nom.trim().length >= 2) creation.execute({ name: nom.trim(), isPublic: true }); }} />
            <Button disabled={busy || nom.trim().length < 2} onClick={() => creation.execute({ name: nom.trim(), isPublic: true })}>
              {busy && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Créer et ajouter
            </Button>
            <Button variant="ghost" onClick={() => setNouveau(false)}>Annuler</Button>
          </div>
        ) : (
          <div className="flex flex-1 flex-wrap items-center gap-2">
            {autres.length > 0 && (
              <>
                <Select value={cible} onValueChange={setCible}>
                  <SelectTrigger className="w-[220px]"><SelectValue placeholder="Choisir une liste" /></SelectTrigger>
                  <SelectContent>
                    {autres.map((l) => <SelectItem key={l.slug} value={l.slug}>{l.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Button disabled={busy || !cible}
                  onClick={() => copie.execute({ ids: games.map((g) => g.id), toSlug: cible })}>
                  {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <ListPlus className="mr-1 h-4 w-4" />} Ajouter
                </Button>
              </>
            )}
            <Button variant="outline" onClick={() => setNouveau(true)}>+ Nouvelle liste</Button>
          </div>
        )}

        <Button variant="ghost" size="icon" aria-label="Vider la sélection" onClick={onClear}>
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
