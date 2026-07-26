"use client";
import { useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";

// Affiche un toast au retour du flux Steam OpenID (redirection depuis /api/steam/return), puis nettoie l'URL.
export function SteamReturnToast() {
  const params = useSearchParams();
  const router = useRouter();
  const done = useRef(false);

  useEffect(() => {
    const status = params.get("steam");
    if (!status || done.current) return;
    done.current = true;

    if (status === "ok") {
      const n = params.get("n") ?? "0";
      const total = params.get("total") ?? n;
      toast.success(`${n} jeu(x) importés (sur ${total}) depuis Steam. Clique « Rescanner » pour enrichir.`);
    } else if (status === "config") {
      toast.error("Steam n'est pas configuré (clé API manquante côté serveur).");
    } else {
      toast.error("Connexion Steam échouée. Réessaie.");
    }

    const url = new URL(window.location.href);
    ["steam", "n", "total"].forEach((k) => url.searchParams.delete(k));
    router.replace(url.pathname + url.search);
  }, [params, router]);

  return null;
}
