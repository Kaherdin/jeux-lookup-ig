"use client";
import Link from "next/link";
import { ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type L = { slug: string; name: string; count: number };
const href = (slug: string) => (slug === "decouvertes" ? "/" : `/l/${slug}`);

export function ListSwitcher({
  currentName, publicLists, userLists,
}: { currentName: string; publicLists: L[]; userLists: L[] }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className="max-w-[240px] gap-2">
          <span className="truncate">{currentName}</span>
          <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel>Listes publiques</DropdownMenuLabel>
        {publicLists.map((l) => (
          <DropdownMenuItem key={l.slug} asChild>
            <Link href={href(l.slug)} className="flex justify-between">
              <span className="truncate">{l.name}</span>
              <span className="text-muted-foreground">{l.count}</span>
            </Link>
          </DropdownMenuItem>
        ))}
        {userLists.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Mes listes</DropdownMenuLabel>
            {userLists.map((l) => (
              <DropdownMenuItem key={l.slug} asChild>
                <Link href={href(l.slug)} className="flex justify-between">
                  <span className="truncate">{l.name}</span>
                  <span className="text-muted-foreground">{l.count}</span>
                </Link>
              </DropdownMenuItem>
            ))}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
