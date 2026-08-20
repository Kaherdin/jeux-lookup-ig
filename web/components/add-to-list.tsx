"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { toast } from "sonner";
import { Loader2, ListPlus } from "lucide-react";
import { copyToList } from "@/app/actions/games";
import { createNewList } from "@/app/actions/lists";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/**
 * « Ajouter à une liste » pour UN jeu, depuis sa fiche — le pendant de la barre de
 * sélection du tableau. Même action serveur (copyToList), et création de liste à la
 * volée possible sans compte (la liste est alors collaborative).
 */
export function AddToList({
  gameId, lists, currentSlug,
}: {
  gameId: string;
  lists: { slug: string; name: string }[];
  currentSlug: string;
}) {
  const router = useRouter();
  const autres = lists.filter((l) => l.slug !== currentSlug);
  const [cible, setCible] = useState(autres[0]?.slug ?? "");
  const [nouveau, setNouveau] = useState(false);
  const [nom, setNom] = useState("");

  const copie = useAction(copyToList, {
    onSuccess: ({ data }) => {
      const dejaLa = (data?.added ?? 0) === 0;
      toast[dejaLa ? "info" : "success"](
        dejaLa ? `Déjà dans « ${data?.name} ».` : `Ajouté à « ${data?.name} ».`,
        { action: data?.slug ? { label: "Voir", onClick: () => router.push(`/l/${data.slug}`) } : undefined }
      );
      router.refresh();
    },
    onError: ({ error }) => toast.error(error.serverError ?? "Échec de l'ajout à la liste."),
  });

  const creation = useAction(createNewList, {
    onSuccess: ({ data }) => {
      if (data?.slug) copie.execute({ ids: [gameId], toSlug: data.slug });
      setNouveau(false);
      setNom("");
    },
    onError: ({ error }) => toast.error(error.serverError ?? "Échec de la création de la liste."),
  });

  const busy = copie.isPending || creation.isPending;

  if (nouveau) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Input autoFocus value={nom} onChange={(e) => setNom(e.target.value)} placeholder="Nom de la nouvelle liste…"
          className="h-9 min-w-[180px] max-w-xs"
          onKeyDown={(e) => { if (e.key === "Enter" && nom.trim().length >= 2) creation.execute({ name: nom.trim(), isPublic: true }); }} />
        <Button size="sm" disabled={busy || nom.trim().length < 2} onClick={() => creation.execute({ name: nom.trim(), isPublic: true })}>
          {busy && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Créer et ajouter
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setNouveau(false)}>Annuler</Button>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {autres.length > 0 && (
        <>
          <Select value={cible} onValueChange={setCible}>
            <SelectTrigger size="sm" className="w-[200px]"><SelectValue placeholder="Choisir une liste" /></SelectTrigger>
            <SelectContent>
              {autres.map((l) => <SelectItem key={l.slug} value={l.slug}>{l.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button size="sm" disabled={busy || !cible} onClick={() => copie.execute({ ids: [gameId], toSlug: cible })}>
            {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <ListPlus className="mr-1 h-4 w-4" />} Ajouter
          </Button>
        </>
      )}
      <Button size="sm" variant="outline" onClick={() => setNouveau(true)}>+ Nouvelle liste</Button>
    </div>
  );
}
