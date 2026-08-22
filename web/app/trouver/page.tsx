import { SiteHeader } from "@/components/site-header";
import { TrouveMoi } from "@/components/trouve-moi";

/**
 * « Trouve-moi un jeu » — quelques questions, puis des propositions à trancher une par
 * une. La page ne charge RIEN : le catalogue reste au chaud côté serveur et l'action
 * `proposerJeux` ne renvoie qu'une trentaine de cartes. C'est un écran de téléphone,
 * pas un tableau de bord.
 */
export const metadata = {
  title: "Trouve-moi un jeu",
  description: "Quelques questions, et de quoi jouer ce soir.",
};

export default function Page() {
  return (
    <>
      <SiteHeader currentSlug="" currentName="Trouve-moi un jeu" />
      {/* overflow-x-clip et non -hidden : une carte qu'on pousse hors de l'écran ne doit
          pas créer de barre de défilement, mais -hidden ferait un conteneur de
          défilement qui décrocherait l'en-tête collant */}
      <main className="mx-auto max-w-[1500px] overflow-x-clip py-6 pb-16">
        <TrouveMoi />
      </main>
    </>
  );
}
