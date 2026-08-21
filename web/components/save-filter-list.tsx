"use client";
import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { toast } from "sonner";
import { Loader2, Bookmark } from "lucide-react";
import { createNewList } from "@/app/actions/lists";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * « Enregistrer comme liste » : fige les critères courants dans une liste-filtre.
 * On ne copie aucun jeu — on garde la requête. La liste se remplira donc toute seule
 * des futurs jeux qui correspondent.
 */
export function SaveFilterList() {
  const sp = useSearchParams();
  const router = useRouter();
  const [ouvert, setOuvert] = useState(false);
  const [nom, setNom] = useState("");

  const creation = useAction(createNewList, {
    onSuccess: ({ data }) => {
      toast.success(`Liste « ${data?.name} » créée — elle suit ces critères.`);
      setOuvert(false);
      setNom("");
      if (data?.slug) router.push(`/l/${data.slug}`);
    },
    onError: ({ error }) => toast.error(error.serverError ?? "Échec de la création."),
  });

  // le tri n'a rien à faire dans une liste enregistrée : ce sont les critères qui comptent
  const criteres = () => {
    const p = new URLSearchParams(sp.toString());
    p.delete("tri"); p.delete("sens"); p.delete("vue");
    return p.toString();
  };
  const valide = nom.trim().length >= 2;
  const creer = () => valide && creation.execute({ name: nom.trim(), isPublic: true, filtre: criteres() });

  if (!ouvert) {
    return (
      <Button variant="outline" size="sm" onClick={() => setOuvert(true)}>
        <Bookmark className="mr-1 h-4 w-4" /> Enregistrer comme liste
      </Button>
    );
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Input autoFocus value={nom} onChange={(e) => setNom(e.target.value)}
        placeholder="Nom de la liste (ex. Coop canapé PS5)…" className="h-8 w-[240px]"
        onKeyDown={(e) => { if (e.key === "Enter") creer(); if (e.key === "Escape") setOuvert(false); }} />
      <Button size="sm" disabled={!valide || creation.isPending} onClick={creer}>
        {creation.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Créer
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setOuvert(false)}>Annuler</Button>
    </span>
  );
}
