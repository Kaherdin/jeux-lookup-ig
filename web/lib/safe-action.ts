import { createSafeActionClient } from "next-safe-action";
import { headers } from "next/headers";
import { auth } from "./auth";

export const actionClient = createSafeActionClient({
  handleServerError(e) {
    return e instanceof Error ? e.message : "Une erreur est survenue.";
  },
});

/** Action réservée aux utilisateurs connectés — expose ctx.user. */
export const authActionClient = actionClient.use(async ({ next }) => {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) throw new Error("Tu dois être connecté pour faire ça.");
  return next({ ctx: { user: session.user } });
});
