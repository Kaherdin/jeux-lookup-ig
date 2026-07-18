"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useAction } from "next-safe-action/hooks";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { createNewList } from "@/app/actions/lists";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

const schema = z.object({
  name: z.string().min(2, "Nom trop court").max(60),
  description: z.string().max(300).optional(),
});

export function CreateListDialog({ trigger }: { trigger: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const form = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema), defaultValues: { name: "", description: "" } });
  const action = useAction(createNewList, {
    onSuccess: ({ data }) => {
      toast.success(`Liste « ${data?.name} » créée.`);
      setOpen(false);
      form.reset();
      if (data?.slug) router.push(`/l/${data.slug}`);
    },
    onError: ({ error }) => toast.error(error.serverError ?? "Échec."),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Nouvelle liste</DialogTitle></DialogHeader>
        <form onSubmit={form.handleSubmit((v) => action.execute({ ...v, isPublic: true }))} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="name">Nom</Label>
            <Input id="name" placeholder="Ex : Coop entre potes" {...form.register("name")} autoFocus />
            {form.formState.errors.name && <p className="text-xs text-destructive">{form.formState.errors.name.message}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="description">Description (optionnel)</Label>
            <Textarea id="description" rows={2} {...form.register("description")} />
          </div>
          <Button type="submit" className="w-full" disabled={action.isPending}>
            {action.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Créer la liste
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
