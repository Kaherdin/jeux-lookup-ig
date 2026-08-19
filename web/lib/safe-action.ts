import { createSafeActionClient } from "next-safe-action";
import { headers } from "next/headers";
import { auth } from "./auth";
import { allow, ipFrom } from "./ratelimit";

export const actionClient = createSafeActionClient({
  handleServerError(e) {
    return e instanceof Error ? e.message : "Une erreur est survenue.";
  },
});

/**
 * Action ouverte : marche AVEC ou SANS compte — ctx.user vaut null pour un visiteur.
 * C'est aux actions de vérifier ce que le visiteur a le droit de toucher (une liste sans
 * propriétaire est publique, une liste possédée ne l'est pas). Le garde-fou anti-abus
 * bascule sur l'IP quand il n'y a pas de compte.
 */
export const openActionClient = actionClient.use(async ({ next }) => {
  const h = await headers();
  const session = await auth.api.getSession({ headers: h });
  const ip = ipFrom(h);
  const user = session?.user ?? null;
  const key = user ? `u:${user.id}` : `ip:${ip}`;
  if (!(await allow("general", key))) {
    throw new Error("Trop de requêtes — patiente une minute puis réessaie.");
  }
  return next({ ctx: { user, ip, key } });
});

/** Action réservée aux utilisateurs connectés — expose ctx.user + ctx.ip. */
export const authActionClient = actionClient.use(async ({ next }) => {
  const h = await headers();
  const session = await auth.api.getSession({ headers: h });
  if (!session?.user) throw new Error("Tu dois être connecté pour faire ça.");
  // garde-fou global anti-spam (par utilisateur)
  if (!(await allow("general", `u:${session.user.id}`))) {
    throw new Error("Trop de requêtes — patiente une minute puis réessaie.");
  }
  return next({ ctx: { user: session.user, ip: ipFrom(h) } });
});
