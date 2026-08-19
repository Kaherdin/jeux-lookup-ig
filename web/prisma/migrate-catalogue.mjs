/**
 * Migration « un jeu par liste » → « catalogue unique + listes qui y font référence ».
 *
 * Avant : table game avec une colonne listId → le même jeu était recopié dans chaque liste.
 * Après : table game = catalogue dédoublonné (clé unique sur le titre normalisé),
 *         table list_item = appartenances (listId, gameId).
 *
 * Le script est idempotent : relancé, il détecte l'état déjà migré et ne fait rien.
 * Usage : node prisma/migrate-catalogue.mjs [--go]   (sans --go : simulation)
 */
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";

// charge .env.local sans dépendance
for (const f of [".env.local", ".env"]) {
  try {
    for (const line of readFileSync(new URL(`../${f}`, import.meta.url), "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z_0-9]+)\s*=\s*(.*)\s*$/);
      if (m) process.env[m[1]] ??= m[2].trim().replace(/^["']|["']$/g, "");
    }
  } catch { /* fichier absent : les variables viennent de l'environnement */ }
}

const GO = process.argv.includes("--go");
const prisma = new PrismaClient({ datasources: { db: { url: process.env.POSTGRES_URL } } });
const sql = (q) => prisma.$executeRawUnsafe(q);

/** Clé de dédoublonnage : « Halo: Campaign Evolved » et « HALO CAMPAIGN EVOLVED » = même jeu. */
function cleDe(titre) {
  return (titre || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[™®©]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim() || "sans-titre";
}

/** Richesse d'une fiche : on garde la plus complète quand un titre existe en double. */
function score(g) {
  const champs = [g.igdbId, g.steamAppId, g.image, g.genre, g.univers, g.sortieISO, g.note, g.metacritic,
    g.prix, g.prixSteam, g.modes, g.modesDetail, g.nbJoueurs, g.developpeur, g.editeur, g.description,
    g.dureeVie, g.envergure, g.urlSteam, g.urlPsn, g.trailer, g.trailerYoutube, g.reel];
  let n = champs.filter((v) => v != null && v !== "").length;
  n += (g.screenshots?.length ?? 0) > 0 ? 2 : 0;
  n += (g.plateformes?.length ?? 0) > 0 ? 1 : 0;
  return n;
}

async function colonneExiste(table, colonne) {
  const r = await prisma.$queryRawUnsafe(
    `SELECT 1 FROM information_schema.columns WHERE table_name = $1 AND column_name = $2 LIMIT 1`,
    table, colonne
  );
  return r.length > 0;
}

async function main() {
  const dejaMigre = !(await colonneExiste("game", "listId"));
  if (dejaMigre) {
    const n = await prisma.$queryRawUnsafe(`SELECT count(*)::int AS n FROM list_item`);
    console.log(`✅ Base déjà au format catalogue (${n[0].n} appartenances). Rien à faire.`);
    return;
  }

  const games = await prisma.$queryRawUnsafe(`SELECT * FROM game`);
  const lists = await prisma.$queryRawUnsafe(`SELECT id, slug, name FROM list`);
  console.log(`État actuel : ${games.length} lignes de jeux réparties dans ${lists.length} listes.`);

  // regroupe par clé : chaque groupe donnera UN jeu du catalogue
  const groupes = new Map();
  for (const g of games) {
    const k = cleDe(g.titre);
    if (!groupes.has(k)) groupes.set(k, []);
    groupes.get(k).push(g);
  }
  const doublons = [...groupes.values()].filter((v) => v.length > 1);
  console.log(`Après dédoublonnage : ${groupes.size} jeux uniques (${games.length - groupes.size} doublons fusionnés, sur ${doublons.length} titres).`);

  const appartenances = [];
  const aSupprimer = [];
  for (const [cle, grp] of groupes) {
    const garde = grp.slice().sort((a, b) => score(b) - score(a))[0];
    for (const g of grp) {
      appartenances.push({ listId: g.listId, gameId: garde.id });
      if (g.id !== garde.id) aSupprimer.push(g.id);
    }
    garde.__cle = cle;
  }
  console.log(`→ ${appartenances.length} appartenances à créer, ${aSupprimer.length} lignes en double à supprimer.`);

  if (!GO) {
    console.log("\n(simulation — relance avec --go pour appliquer)");
    for (const grp of doublons.slice(0, 5)) {
      console.log(`   doublon : « ${grp[0].titre} » ×${grp.length}`);
    }
    return;
  }

  console.log("\n1/5 · création de la table d'appartenance…");
  await sql(`CREATE TABLE IF NOT EXISTS "list_item" (
    "listId" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "ajouteLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "list_item_pkey" PRIMARY KEY ("listId","gameId")
  )`);
  await sql(`CREATE INDEX IF NOT EXISTS "list_item_gameId_idx" ON "list_item"("gameId")`);

  console.log("2/5 · nouvelles colonnes (game.cle, list.filtre)…");
  await sql(`ALTER TABLE "game" ADD COLUMN IF NOT EXISTS "cle" TEXT`);
  await sql(`ALTER TABLE "list" ADD COLUMN IF NOT EXISTS "filtre" TEXT`);

  console.log("3/5 · remplissage des clés et des appartenances…");
  for (const [cle, grp] of groupes) {
    const garde = grp.slice().sort((a, b) => score(b) - score(a))[0];
    await prisma.$executeRawUnsafe(`UPDATE "game" SET "cle" = $1 WHERE "id" = $2`, cle, garde.id);
  }
  // insertion par paquets pour ne pas exploser la taille des requêtes
  const uniques = [...new Map(appartenances.map((a) => [`${a.listId}|${a.gameId}`, a])).values()];
  for (let i = 0; i < uniques.length; i += 200) {
    const lot = uniques.slice(i, i + 200);
    const valeurs = lot.map((_, j) => `($${j * 2 + 1}, $${j * 2 + 2})`).join(",");
    await prisma.$executeRawUnsafe(
      `INSERT INTO "list_item" ("listId","gameId") VALUES ${valeurs} ON CONFLICT DO NOTHING`,
      ...lot.flatMap((a) => [a.listId, a.gameId])
    );
  }
  console.log(`   ${uniques.length} appartenances écrites.`);

  console.log("4/5 · suppression des fiches en double…");
  for (let i = 0; i < aSupprimer.length; i += 200) {
    const lot = aSupprimer.slice(i, i + 200);
    await prisma.$executeRawUnsafe(
      `DELETE FROM "game" WHERE "id" IN (${lot.map((_, j) => `$${j + 1}`).join(",")})`, ...lot
    );
  }

  console.log("5/5 · bascule des contraintes…");
  await sql(`ALTER TABLE "game" ALTER COLUMN "cle" SET NOT NULL`);
  await sql(`CREATE UNIQUE INDEX IF NOT EXISTS "game_cle_key" ON "game"("cle")`);
  await sql(`ALTER TABLE "game" DROP CONSTRAINT IF EXISTS "game_listId_fkey"`);
  await sql(`ALTER TABLE "game" DROP CONSTRAINT IF EXISTS "game_listId_titre_key"`);
  await sql(`DROP INDEX IF EXISTS "game_listId_idx"`);
  await sql(`ALTER TABLE "game" DROP COLUMN IF EXISTS "listId"`);
  await sql(`ALTER TABLE "list_item" DROP CONSTRAINT IF EXISTS "list_item_listId_fkey"`);
  await sql(`ALTER TABLE "list_item" ADD CONSTRAINT "list_item_listId_fkey" FOREIGN KEY ("listId") REFERENCES "list"("id") ON DELETE CASCADE ON UPDATE CASCADE`);
  await sql(`ALTER TABLE "list_item" DROP CONSTRAINT IF EXISTS "list_item_gameId_fkey"`);
  await sql(`ALTER TABLE "list_item" ADD CONSTRAINT "list_item_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "game"("id") ON DELETE CASCADE ON UPDATE CASCADE`);

  const [{ n: nJeux }] = await prisma.$queryRawUnsafe(`SELECT count(*)::int AS n FROM game`);
  const [{ n: nItems }] = await prisma.$queryRawUnsafe(`SELECT count(*)::int AS n FROM list_item`);
  console.log(`\n✅ Terminé : catalogue de ${nJeux} jeux · ${nItems} appartenances.`);
}

main()
  .catch((e) => { console.error("❌ échec :", e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
