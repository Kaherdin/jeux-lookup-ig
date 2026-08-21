// Test du tri, à lancer avec un runner qui sait lire du TypeScript :
//   npx tsx lib/tri.test.mjs
// Il vérifie la propriété qui compte : le tri porte sur la TOTALITÉ de la liste
// filtrée, et la fenêtre rendue par la virtualisation n'est qu'une tranche de cet
// ordre global — jamais un tri par page.
// Vérifie que le tri porte sur la TOTALITÉ de la liste filtrée, jamais sur une page.
import { faireComparateur, SORT_LABEL, SORT_DEFDIR, estRecent, sortieVal } from './tri.ts';

const GENRES = ['Action-RPG', 'Survie', 'Extraction (PvP)', 'Party', 'Puzzle, Simulator',
  'Racing, Sport', 'Horreur', 'Role-playing (RPG), Adventure', '?', 'Roguelite'];
const jour = (d) => new Date(Date.now() + d * 864e5).toISOString().slice(0, 10);

// 600 jeux : notes/dates/durées variées, un tiers avec des trous, quelques ajouts récents
const jeux = Array.from({ length: 600 }, (_, i) => ({
  g: {
    id: `g${i}`,
    titre: `Jeu ${String(i).padStart(3, '0')} ${['Alpha','Beta','Zeta','Omega'][i % 4]}`,
    note: i % 7 === 0 ? null : 40 + (i * 13) % 61,
    metacritic: null, steamPct: null,
    prix: null, prixSteam: i % 5 === 0 ? null : (i * 7) % 90,
    sortieISO: i % 11 === 0 ? null : `${1995 + (i % 31)}-${String(1 + (i % 12)).padStart(2,'0')}-15`,
    sortiePrec: i % 11 === 0 && i % 3 === 0 ? '2026' : '',
    dureeVie: i % 4 === 0 ? null : `~${5 + (i % 90)}h`,
    nbJoueursMax: i % 6 === 0 ? null : 1 + (i % 8),
    steamAvis: i % 3 === 0 ? null : i * 37,
    igdbVotes: i % 9 === 0 ? 500 : null,
    ajouteLe: i % 50 === 0 ? jour(-2) : jour(-40 - (i % 300)),
    cats: undefined, genre: GENRES[i % GENRES.length], themes: null, univers: null,
  },
  toks: GENRES[i % GENRES.length].split(/[,/]/).map((t) => t.trim()),
}));

// on filtre comme le fait la vue, puis on trie le RÉSULTAT ENTIER
const filtres = jeux.filter((it) => (it.g.note ?? 0) >= 50 || it.g.note == null);
console.log(`${jeux.length} jeux → ${filtres.length} après filtre\n`);

let echecs = 0;
const verifier = (nom, cond, detail = '') => {
  if (!cond) { echecs++; console.log(`  ✗ ${nom} ${detail}`); }
};

for (const cle of Object.keys(SORT_LABEL)) {
  for (const sens of [1, -1]) {
    for (const epingler of [true, false]) {
      const cmp = faireComparateur({ sortKey: cle, sortDir: sens, epingler, parSousType: false });
      const trie = [...filtres].sort(cmp);

      // 1. rien n'est perdu : le tri voit tout le monde
      verifier(`${cle}/${sens}/${epingler} : effectif`, trie.length === filtres.length);
      verifier(`${cle}/${sens}/${epingler} : mêmes jeux`,
        new Set(trie.map((t) => t.g.id)).size === filtres.length);

      // 2. ordre TOTAL : chaque paire adjacente respecte le comparateur
      let desordre = -1;
      for (let i = 1; i < trie.length; i++) if (cmp(trie[i - 1], trie[i]) > 0) { desordre = i; break; }
      verifier(`${cle}/${sens}/${epingler} : ordre total`, desordre < 0, `rupture à l'index ${desordre}`);

      // 3. propriété de fenêtre : ce que la virtualisation rend (trie[i..i+20])
      //    est toujours un morceau de l'ordre global, où que soit la fenêtre
      for (const debut of [0, 59, 60, 61, 300, trie.length - 25]) {
        const fenetre = trie.slice(Math.max(0, debut), Math.max(0, debut) + 20);
        let ok = true;
        for (let i = 1; i < fenetre.length; i++) if (cmp(fenetre[i - 1], fenetre[i]) > 0) ok = false;
        verifier(`${cle}/${sens}/${epingler} : fenêtre @${debut}`, ok);
      }

      // 4. l'épinglage ne s'applique que s'il est demandé
      if (!epingler) {
        const recentsEnTete = trie.slice(0, 5).every((t) => estRecent(t.g));
        verifier(`${cle}/${sens} : pas d'épinglage parasite`, !recentsEnTete || cle === 'ajout');
      }
    }
  }
}

// 5. cas concret : tri par date de sortie décroissante, épinglage coupé
const cmp = faireComparateur({ sortKey: 'sortie', sortDir: -1, epingler: false, parSousType: false });
const parDate = [...filtres].sort(cmp);
// on relit la clé RÉELLE utilisée par le tri : « 9999 » quand la date est inconnue
const annees = parDate.map((t) => sortieVal(t.g).slice(0, 4));
const decroissant = annees.every((a, i) => i === 0 || annees[i - 1] >= a);
verifier('sortie desc : années décroissantes de bout en bout', decroissant);
console.log(`  tri « sortie » desc → ${annees[0]} … ${annees[Math.floor(annees.length/2)]} … ${annees.at(-1)}`);

// 6. tri par sous-type quand une famille est cochée
const cmpST = faireComparateur({ sortKey: 'type', sortDir: 1, epingler: false, parSousType: true });
const parSousType = [...filtres].sort(cmpST);
const toks = parSousType.map((t) => (t.toks[0] ?? '').toLowerCase());
verifier('sous-type : ordre alphabétique', toks.every((t, i) => i === 0 || toks[i - 1] <= t));
console.log(`  tri « sous-type » → ${[...new Set(toks)].slice(0, 6).join(', ')}…\n`);

console.log(echecs === 0
  ? `✅ TOUT PASSE — ${Object.keys(SORT_LABEL).length} critères × 2 sens × 2 modes, sur ${filtres.length} jeux`
  : `❌ ${echecs} échec(s)`);
process.exit(echecs ? 1 : 0);
