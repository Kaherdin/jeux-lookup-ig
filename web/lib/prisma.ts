import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { __prisma?: PrismaClient };

/**
 * En environnement serverless, chaque instance ouvre son propre pool. Sans borne,
 * Prisma en prend `nb_cpus * 2 + 1` — multiplié par le nombre d'instances tièdes,
 * la base finit par répondre « too many connections ». Une connexion par instance
 * est le réglage recommandé ; `pool_timeout` laisse le temps d'en attendre une
 * libre au lieu d'échouer sur-le-champ.
 *
 * On complète l'URL à la main plutôt qu'avec URL/searchParams : ça évite de
 * ré-encoder un mot de passe qui contiendrait des caractères spéciaux.
 */
function urlAvecPool(raw: string) {
  if (!raw) return raw;
  const ajouts: string[] = [];
  if (!/[?&]connection_limit=/.test(raw)) ajouts.push("connection_limit=1");
  if (!/[?&]pool_timeout=/.test(raw)) ajouts.push("pool_timeout=20");
  if (!/[?&]connect_timeout=/.test(raw)) ajouts.push("connect_timeout=10");
  if (!ajouts.length) return raw;
  return raw + (raw.includes("?") ? "&" : "?") + ajouts.join("&");
}

export const prisma =
  globalForPrisma.__prisma ??
  new PrismaClient({
    datasources: { db: { url: urlAvecPool(process.env.POSTGRES_URL ?? "") } },
  });

// En production aussi : Next découpe le serveur en plusieurs paquets (pages, actions,
// routes), et ce module peut être évalué une fois par paquet. Sans ce point d'ancrage
// commun, une même instance se retrouvait avec plusieurs clients — donc plusieurs pools.
globalForPrisma.__prisma = prisma;
