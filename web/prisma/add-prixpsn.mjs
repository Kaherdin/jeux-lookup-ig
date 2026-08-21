/**
 * Ajoute la colonne game."prixPsn" (JSONB, nullable). Additive et idempotente : elle
 * ne touche à aucune donnée existante. Écrite en SQL direct parce que le dossier
 * prisma/migrations est en retard sur la base — `prisma migrate dev` y verrait une
 * dérive et proposerait un reset.
 */
import { readFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';

for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z_0-9]+)\s*=\s*(.*)\s*$/);
  if (m) process.env[m[1]] ??= m[2].trim().replace(/^["']|["']$/g, '');
}
const prisma = new PrismaClient({ datasources: { db: { url: process.env.POSTGRES_URL } } });

const avant = await prisma.$queryRawUnsafe(`SELECT column_name FROM information_schema.columns WHERE table_name = 'game' AND column_name = 'prixPsn';`);
console.log('colonne présente avant :', avant.length > 0);
if (!avant.length) {
  await prisma.$executeRawUnsafe(`ALTER TABLE "game" ADD COLUMN IF NOT EXISTS "prixPsn" JSONB;`);
  console.log('→ colonne ajoutée');
}
const apres = await prisma.$queryRawUnsafe(`SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name = 'game' AND column_name LIKE 'prix%';`);
console.log('colonnes prix* :', JSON.stringify(apres));
const n = await prisma.game.count();
console.log('jeux en base :', n);
await prisma.$disconnect();
