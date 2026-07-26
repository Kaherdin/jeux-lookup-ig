import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { steamOpenIdUrl } from "@/lib/steam";

// Démarre le flux Steam OpenID : redirige l'utilisateur (connecté à l'app) vers Steam.
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session?.user) return NextResponse.redirect(new URL("/sign-in", req.url));

  const origin = process.env.BETTER_AUTH_URL || req.nextUrl.origin;
  const returnTo = `${origin}/api/steam/return`;
  return NextResponse.redirect(steamOpenIdUrl(returnTo, origin));
}
