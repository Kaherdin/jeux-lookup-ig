"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { toast } from "sonner";
import { LogOut, User as UserIcon, RefreshCw, Loader2, Library, Gamepad2, Heart } from "lucide-react";
import { ouvrirMatchs } from "@/lib/matchs";
import { signOut } from "@/lib/auth-client";
import { rescanList, importSteam } from "@/app/actions/games";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function UserMenu({
  user, rescanSlug, rescanName,
}: {
  user: { name?: string | null; email?: string | null } | null;
  rescanSlug?: string;   // liste courante, si l'utilisateur a le droit de la modifier
  rescanName?: string;
}) {
  const router = useRouter();
  // resynchro de la bibliothèque Steam directement depuis le menu : c'est le geste
  // qu'on refait souvent (nouveaux jeux achetés), il n'a pas à passer par /compte.
  const syncSteam = useAction(importSteam, {
    onSuccess: ({ data }) => {
      toast.success(data?.added ? `${data.added} nouveau(x) jeu(x) Steam (sur ${data.total}).` : "Bibliothèque Steam déjà à jour.");
      router.refresh();
    },
    onError: ({ error }) => {
      const msg = error.serverError ?? "Échec de la synchronisation Steam.";
      toast.error(msg, /non lié|non configur/i.test(msg)
        ? { action: { label: "Lier Steam", onClick: () => router.push("/compte") } }
        : undefined);
    },
  });

  const rescan = useAction(rescanList, {
    onSuccess: ({ data }) => { toast.success(`${data?.count ?? 0} jeu(x) re-scanné(s).`); router.refresh(); },
    onError: ({ error }) => toast.error(error.serverError ?? "Échec du re-scan."),
  });

  if (!user) {
    return <Button asChild size="sm"><Link href="/sign-in">Se connecter</Link></Button>;
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="icon" aria-label="Compte">
          {rescan.isPending || syncSteam.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserIcon className="h-4 w-4" />}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="max-w-[220px] truncate">{user.name || user.email}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/mes-jeux"><Library className="mr-2 h-4 w-4" /> Tous mes jeux</Link>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={(e) => { e.preventDefault(); ouvrirMatchs(); }}>
          <Heart className="mr-2 h-4 w-4 fill-rose-500 text-rose-500" /> Ma sélection
        </DropdownMenuItem>
        <DropdownMenuItem disabled={syncSteam.isPending}
          onSelect={(e) => { e.preventDefault(); syncSteam.execute({}); }}>
          {syncSteam.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
          Resynchroniser ma bibliothèque Steam
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/compte"><Gamepad2 className="mr-2 h-4 w-4" /> Mon compte &amp; bibliothèques</Link>
        </DropdownMenuItem>
        {rescanSlug && (
          <DropdownMenuItem
            disabled={rescan.isPending}
            // le menu se referme au clic : la confirmation doit partir avant
            onSelect={(e) => {
              e.preventDefault();
              if (confirm(`Rescanner tous les jeux de « ${rescanName ?? "cette liste"} » ? Cela comble les infos manquantes (notes, prix, coop, durée…) et peut prendre un moment.`)) {
                rescan.execute({ slug: rescanSlug });
              }
            }}>
            {rescan.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
            Rescanner cette liste
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => signOut({ fetchOptions: { onSuccess: () => router.refresh() } })}>
          <LogOut className="mr-2 h-4 w-4" /> Se déconnecter
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
