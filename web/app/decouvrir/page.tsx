import { redirect } from "next/navigation";

// La découverte n'est plus une page à part : c'est un onglet de la page principale,
// avec les mêmes familles de jeux et les mêmes critères. On garde l'URL vivante.
export default function Page() {
  redirect("/?vue=decouvrir");
}
