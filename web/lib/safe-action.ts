import { createSafeActionClient } from "next-safe-action";
import { headers } from "next/headers";
import { auth } from "./auth";
import { allow, ipFrom } from "./ratelimit";

export const actionClient = createSafeActionClient({
  handleServerError(e) {
    return e instanceof Error ? e.message : "Une erreur est survenue.";
  },
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
