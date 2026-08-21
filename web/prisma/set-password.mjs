/**
 * Redonne un mot de passe à un compte existant, en utilisant le hachage de better-auth.
 *
 * Cas d'usage : les données ont été restaurées depuis une sauvegarde qui ne contenait pas
 * la table `account` (celle qui porte le mot de passe). Le compte existe, mais plus aucun
 * moyen de s'y connecter — et l'inscription est refusée puisque l'e-mail est déjà pris.
 *
 * Usage : node prisma/set-password.mjs <email> <motdepasse>
 * Choisis le mot de passe toi-même : il ne doit transiter par personne d'autre.
 */
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "better-auth/crypto";

for (const f of [".env.local", ".env"]) {
  try {
    for (const line of readFileSync(new URL(`../${f}`, import.meta.url), "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z_0-9]+)\s*=\s*(.*)\s*$/);
      if (m) process.env[m[1]] ??= m[2].trim().replace(/^["']|["']$/g, "");
    }
  } catch { /* absent */ }
}

const [email, motDePasse] = process.argv.slice(2);
if (!email || !motDePasse) {
  console.error("Usage : node prisma/set-password.mjs <email> <motdepasse>");
  process.exit(1);
}
if (motDePasse.length < 6) {
  console.error("Mot de passe trop court (6 caractères minimum, comme dans lib/auth.ts).");
  process.exit(1);
}

const prisma = new PrismaClient({ datasources: { db: { url: process.env.POSTGRES_URL } } });
const user = await prisma.user.findUnique({ where: { email } });
if (!user) {
  console.error(`Aucun compte avec l'e-mail ${email}.`);
  await prisma.$disconnect();
  process.exit(1);
}

const password = await hashPassword(motDePasse);
const existant = await prisma.account.findFirst({ where: { userId: user.id, providerId: "credential" } });

if (existant) {
  await prisma.account.update({ where: { id: existant.id }, data: { password } });
  console.log(`✅ Mot de passe remplacé pour ${email}.`);
} else {
  await prisma.account.create({
    data: {
      id: `cred-${user.id}`,
      accountId: user.id,
      providerId: "credential",
      userId: user.id,
      password,
    },
  });
  console.log(`✅ Connexion rétablie pour ${email} — tu peux te connecter avec ce mot de passe.`);
}
await prisma.$disconnect();
