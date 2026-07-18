"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { signIn, signUp } from "@/lib/auth-client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

const schema = z.object({
  name: z.string().optional(),
  email: z.string().email("Email invalide"),
  password: z.string().min(6, "6 caractères minimum"),
});

export function AuthForm({ mode }: { mode: "sign-in" | "sign-up" }) {
  const isSignUp = mode === "sign-up";
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(isSignUp ? schema.extend({ name: z.string().min(2, "Nom trop court") }) : schema),
    defaultValues: { name: "", email: "", password: "" },
  });

  async function onSubmit(v: z.infer<typeof schema>) {
    setLoading(true);
    const res = isSignUp
      ? await signUp.email({ email: v.email, password: v.password, name: v.name ?? "" })
      : await signIn.email({ email: v.email, password: v.password });
    setLoading(false);
    if (res.error) {
      toast.error(res.error.message ?? "Échec de l'authentification.");
      return;
    }
    toast.success(isSignUp ? "Compte créé, bienvenue !" : "Connecté !");
    router.push("/");
    router.refresh();
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-md items-center px-4">
      <Card className="w-full">
        <CardHeader>
          <CardTitle>{isSignUp ? "Créer un compte" : "Se connecter"}</CardTitle>
          <CardDescription>Pour créer et gérer tes listes de jeux.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            {isSignUp && (
              <div className="space-y-1.5">
                <Label htmlFor="name">Nom</Label>
                <Input id="name" {...form.register("name")} />
                {form.formState.errors.name && <p className="text-xs text-destructive">{form.formState.errors.name.message}</p>}
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" autoComplete="email" {...form.register("email")} />
              {form.formState.errors.email && <p className="text-xs text-destructive">{form.formState.errors.email.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Mot de passe</Label>
              <Input id="password" type="password" autoComplete={isSignUp ? "new-password" : "current-password"} {...form.register("password")} />
              {form.formState.errors.password && <p className="text-xs text-destructive">{form.formState.errors.password.message}</p>}
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
              {isSignUp ? "Créer le compte" : "Se connecter"}
            </Button>
          </form>
          <p className="mt-4 text-center text-sm text-muted-foreground">
            {isSignUp ? (
              <>Déjà un compte ? <Link href="/sign-in" className="text-primary hover:underline">Se connecter</Link></>
            ) : (
              <>Pas encore de compte ? <Link href="/sign-up" className="text-primary hover:underline">Créer un compte</Link></>
            )}
          </p>
          <p className="mt-2 text-center text-sm"><Link href="/" className="text-muted-foreground hover:underline">← Retour</Link></p>
        </CardContent>
      </Card>
    </div>
  );
}
