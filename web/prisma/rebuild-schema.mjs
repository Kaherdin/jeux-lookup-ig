/**
 * Remet la base au schéma de prisma/schema.prisma, sans passer par `prisma db push`.
 *
 * Écrit pour une reprise après sinistre : la base a été vidée et son schéma ramené à un
 * état ancien. Le script lit schema.prisma, le compare aux colonnes réellement présentes,
 * et n'applique que l'écart. Il REFUSE d'agir si une table contient des données — il est
 * fait pour une base vide, pas pour migrer une base vivante.
 *
 * Usage : node prisma/rebuild-schema.mjs [--go]   (sans --go : montre le plan)
 */
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";

for (const f of [".env.local", ".env"]) {
  try {
    for (const line of readFileSync(new URL(`../${f}`, import.meta.url), "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z_0-9]+)\s*=\s*(.*)\s*$/);
      if (m) process.env[m[1]] ??= m[2].trim().replace(/^["']|["']$/g, "");
    }
  } catch { /* absent */ }
}

const GO = process.argv.includes("--go");
const prisma = new PrismaClient({ datasources: { db: { url: process.env.POSTGRES_URL } } });

const SQL_TYPE = {
  String: "TEXT", Boolean: "BOOLEAN", Int: "INTEGER", Float: "DOUBLE PRECISION",
  Json: "JSONB", DateTime: "TIMESTAMP(3)", BigInt: "BIGINT",
};

/** Lit schema.prisma → { table: [{ nom, type, requis, defaut, liste }] } */
function lireSchema() {
  const src = readFileSync(new URL("./schema.prisma", import.meta.url), "utf8");
  const modeles = {};
  for (const m of src.matchAll(/model\s+(\w+)\s*\{([\s\S]*?)\n\}/g)) {
    const [, nom, corps] = m;
    const table = (corps.match(/@@map\("([^"]+)"\)/) || [, nom.toLowerCase()])[1];
    const champs = [];
    for (const ligne of corps.split("\n")) {
      const l = ligne.trim();
      if (!l || l.startsWith("//") || l.startsWith("@@") || l.startsWith("///")) continue;
      const f = l.match(/^(\w+)\s+(\w+)(\[\])?(\?)?\s*(.*)$/);
      if (!f) continue;
      const [, champ, type, liste, opt, reste] = f;
      if (!SQL_TYPE[type]) continue; // relation, pas une colonne
      if (/@relation/.test(reste)) continue;
      champs.push({
        nom: champ, type, liste: !!liste, requis: !opt,
        defaut: (reste.match(/@default\(([^)]*)\)/) || [])[1] ?? null,
        unique: /@unique/.test(reste),
        id: /@id/.test(reste),
      });
    }
    modeles[table] = { modele: nom, champs, corps };
  }
  return modeles;
}

function sqlDefaut(d, type) {
  if (d == null) return null;
  if (d === "now()") return "CURRENT_TIMESTAMP";
  if (d === "true" || d === "false") return d.toUpperCase();
  if (d === "cuid()" || d === "uuid()" || d === "autoincrement()") return null; // généré côté Prisma
  if (/^\[\]$/.test(d)) return "ARRAY[]::TEXT[]";
  if (/^-?\d+(\.\d+)?$/.test(d)) return d;
  return `'${d.replace(/^"|"$/g, "")}'`;
}
function colonneDDL(c) {
  const t = SQL_TYPE[c.type] + (c.liste ? "[]" : "");
  const d = sqlDefaut(c.defaut, c.type);
  return `"${c.nom}" ${t}${c.requis ? " NOT NULL" : ""}${d ? ` DEFAULT ${d}` : ""}`;
}

const modeles = lireSchema();
const cible = ["game", "list", "list_item", "ownership"]; // tables applicatives : alignées à l'identique
// tables better-auth : on COMPLÈTE ce qui manque, on ne retire jamais rien — une colonne
// inconnue de schema.prisma y est plus probablement utile que de trop.
const ajoutSeul = ["user", "session", "account", "verification"];

const actions = [];
for (const table of [...cible, ...ajoutSeul]) {
  const def = modeles[table];
  if (!def) { console.error(`schema.prisma : modèle introuvable pour ${table}`); process.exit(1); }
  const existantes = await prisma.$queryRawUnsafe(
    `SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1`, table
  );
  if (!existantes.length) {
    actions.push({ table, kind: "create" });
    continue;
  }
  const noms = new Set(existantes.map((r) => r.column_name));
  for (const c of def.champs) if (!noms.has(c.nom)) actions.push({ table, kind: "add", c });
  if (cible.includes(table)) {
    for (const n of noms) if (!def.champs.some((c) => c.nom === n)) actions.push({ table, kind: "drop", nom: n });
  }
}

// garde-fou : on ne touche à rien si des données existent
const compte = async (t) => {
  try { const r = await prisma.$queryRawUnsafe(`SELECT count(*)::int n FROM "${t}"`); return r[0].n; }
  catch { return 0; }
};
const total = (await Promise.all(cible.map(compte))).reduce((a, b) => a + b, 0);

console.log("Plan :");
if (!actions.length) console.log("  (rien à faire — le schéma correspond déjà)");
for (const a of actions) {
  if (a.kind === "create") console.log(`  CRÉER la table ${a.table}`);
  if (a.kind === "add") console.log(`  ${a.table} : AJOUTER ${colonneDDL(a.c)}`);
  if (a.kind === "drop") console.log(`  ${a.table} : SUPPRIMER la colonne "${a.nom}"`);
}
console.log(`\nLignes présentes dans ${cible.join(", ")} : ${total}`);

if (!GO || !actions.length) {
  if (!GO) console.log("(plan seulement — relance avec --go pour appliquer)");
  await prisma.$disconnect();
  process.exit(0);
}
// Créer une table neuve est sans risque, même sur une base pleine ; retirer une colonne
// ne l'est pas. On ne bloque donc que sur les actions réellement destructrices.
if (total > 0 && actions.some((a) => a.kind === "drop")) {
  console.error("\n❌ Suppression de colonne sur une base qui contient des données. Abandon.");
  await prisma.$disconnect();
  process.exit(1);
}

console.log("\nApplication…");
for (const a of actions) {
  if (a.kind === "create") {
    const def = modeles[a.table];
    const cols = def.champs.map(colonneDDL).join(",\n  ");
    const pk = def.champs.filter((c) => c.id).map((c) => `"${c.nom}"`);
    const pkComposite = (def.corps.match(/@@id\(\[([^\]]+)\]\)/) || [])[1];
    const cle = pkComposite ? pkComposite.split(",").map((s) => `"${s.trim()}"`) : pk;
    await prisma.$executeRawUnsafe(
      `CREATE TABLE "${a.table}" (\n  ${cols}${cle.length ? `,\n  PRIMARY KEY (${cle.join(",")})` : ""}\n)`
    );
    console.log(`  ✔ table ${a.table} créée`);
  }
  if (a.kind === "add") {
    await prisma.$executeRawUnsafe(`ALTER TABLE "${a.table}" ADD COLUMN ${colonneDDL(a.c)}`);
    console.log(`  ✔ ${a.table}.${a.c.nom} ajoutée`);
  }
  if (a.kind === "drop") {
    await prisma.$executeRawUnsafe(`ALTER TABLE "${a.table}" DROP COLUMN IF EXISTS "${a.nom}" CASCADE`);
    console.log(`  ✔ ${a.table}.${a.nom} supprimée`);
  }
}

console.log("Index et clés étrangères…");
await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "game_cle_key" ON "game"("cle")`);
await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "game_titre_idx" ON "game"("titre")`);
await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "list_slug_key" ON "list"("slug")`);
await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "list_ownerId_idx" ON "list"("ownerId")`);
await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "list_item_gameId_idx" ON "list_item"("gameId")`);
for (const [t, c, ref, col, act] of [
  ["list", "ownerId", "user", "id", "SET NULL"],
  ["list_item", "listId", "list", "id", "CASCADE"],
  ["list_item", "gameId", "game", "id", "CASCADE"],
  ["ownership", "userId", "user", "id", "CASCADE"],
  ["ownership", "gameId", "game", "id", "CASCADE"],
]) {
  await prisma.$executeRawUnsafe(`ALTER TABLE "${t}" DROP CONSTRAINT IF EXISTS "${t}_${c}_fkey"`);
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "${t}" ADD CONSTRAINT "${t}_${c}_fkey" FOREIGN KEY ("${c}") REFERENCES "${ref}"("${col}") ON DELETE ${act} ON UPDATE CASCADE`
  );
}

console.log("\n✅ Schéma aligné sur schema.prisma.");
await prisma.$disconnect();
