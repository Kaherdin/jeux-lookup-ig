// Test du moteur de « Trouve-moi un jeu », à lancer avec un runner qui lit du TypeScript :
//   npx tsx lib/selection.test.mjs
//
// Ce qui est vérifié n'est pas « le score vaut 73 » — ce chiffre changera au premier
// réglage — mais les PROMESSES faites à l'utilisateur : on ne lui propose jamais un jeu
// injouable dans sa configuration, l'ordre suit vraiment la pertinence, les surprises
// sont annoncées comme telles, et deux fois les mêmes réponses donnent la même file.
import { proposer, noter, tropPeu } from './selection.ts';
import { critereDe, CRITERES_VIDES, questionsPertinentes, QUESTIONS } from './quiz.ts';

/** générateur déterministe : les tests ne doivent pas dépendre du hasard */
function alea(graine) {
  let a = graine;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FAMILLES = [['action'], ['aventure', 'rpg'], ['reflexion'], ['fun'], ['horreur'], ['sport'], ['survie']];
const PLATEFORMES = [['PC'], ['PS5', 'PC'], ['Switch'], ['XONE', 'PC'], ['PS4', 'Switch', 'PC'], ['Stadia']];

// 400 jeux : modes, joueurs, durées et notes variés, avec des trous partout —
// c'est l'état réel du catalogue, où une donnée sur trois manque.
const jeux = Array.from({ length: 400 }, (_, i) => ({
  id: `g${i}`,
  titre: `Jeu ${String(i).padStart(3, '0')}`,
  note: i % 7 === 0 ? null : 40 + ((i * 13) % 61),
  metacritic: null, steamPct: null,
  prix: null, prixSteam: (i * 7) % 90, prixPsn: null,
  dispo: i % 3 === 0, gratuit: i % 23 === 0, bonPlan: i % 11 === 0, bienNote: false,
  dureeVie: i % 4 === 0 ? null : `~${3 + (i % 90)}h`,
  nbJoueursMax: i % 6 === 0 ? null : 1 + (i % 8),
  joueursLocalMax: i % 5 === 0 ? 4 : null,
  joueursOnlineMax: i % 3 === 0 ? 8 : null,
  modes: { solo: i % 4 !== 0, coop: i % 3 === 0, pvp: i % 5 === 0, multi: i % 3 === 0 || i % 5 === 0 },
  modesDetail: i % 5 === 0 ? { coopCouch: true } : i % 3 === 0 ? { coopOnline: true } : {},
  plateformes: PLATEFORMES[i % PLATEFORMES.length],
  cats: FAMILLES[i % FAMILLES.length],
  genre: 'Divers', themes: null, univers: null, sortieISO: '2020-01-01', sortiePrec: '',
  envergure: '', comingSoon: null, ajouteLe: '2026-01-01',
}));

let echecs = 0;
const verifier = (nom, cond, detail = '') => {
  if (!cond) { echecs++; console.log(`  ✗ ${nom} ${detail}`); }
};

console.log(`${jeux.length} jeux de test\n`);

// 1. Ce qui est IMPOSSIBLE ne doit jamais être proposé --------------------
{
  const c = { ...CRITERES_VIDES, joueurs: 4, plateforme: 'playstation' };
  const props = proposer(jeux, c, { taille: 40, alea: alea(1) });
  const surPS = props.every((p) => p.jeu.plateformes.some((x) => /^ps\d/i.test(x)));
  verifier('plateforme : que des jeux PlayStation', surPS);
  const aQuatre = props.filter((p) => !p.surprise).every((p) => {
    const max = Math.max(p.jeu.nbJoueursMax ?? 0, p.jeu.joueursLocalMax ?? 0, p.jeu.joueursOnlineMax ?? 0);
    return max === 0 || max >= 4; // 0 = inconnu, et l'inconnu ne doit pas écarter
  });
  verifier('joueurs : aucun jeu qui ne monte pas à 4', aQuatre);
  const soloSeul = props.some((p) => {
    const m = p.jeu.modes;
    return m.solo && !m.coop && !m.pvp && !m.multi;
  });
  verifier('joueurs : aucun jeu strictement solo dans une soirée à 4', !soloSeul);
}

// 2. L'ordre suit la pertinence ------------------------------------------
{
  const c = { ...CRITERES_VIDES, joueurs: 2, ensemble: 'coop', familles: ['aventure'] };
  const props = proposer(jeux, c, { taille: 30, alea: alea(2) });
  const scores = props.filter((p) => !p.surprise).map((p) => p.score);
  const decroissant = scores.every((s, i) => i === 0 || scores[i - 1] >= s);
  verifier('ordre : scores décroissants hors surprises', decroissant, `→ ${scores.slice(0, 8).join(', ')}…`);
  verifier('ordre : la première carte est la plus pertinente', !props[0]?.surprise);
}

// 3. Les surprises sont annoncées, et minoritaires ------------------------
{
  const c = { ...CRITERES_VIDES, joueurs: 4, ensemble: 'coop', local: true, familles: ['fun'] };
  const props = proposer(jeux, c, { taille: 30, alea: alea(3) });
  const s = props.filter((p) => p.surprise);
  verifier('surprises : jamais plus d\'une carte sur quatre', s.length <= props.length / 4, `${s.length}/${props.length}`);
  verifier('surprises : toutes marquées', s.every((p) => p.surprise === true));
  console.log(`  ${props.length} cartes dont ${s.length} surprise(s)`);
}

// 4. Ce qu'on possède déjà ne revient pas comme découverte ----------------
{
  const possedes = new Set(jeux.slice(0, 120).map((g) => g.titre.toLowerCase()));
  const props = proposer(jeux, { ...CRITERES_VIDES }, { possedes, taille: 40, alea: alea(4) });
  verifier('possédés : aucun ne remonte', props.every((p) => !possedes.has(p.jeu.titre.toLowerCase())));
  const sans = proposer(jeux, { ...CRITERES_VIDES, ecarterPossedes: false }, { possedes, taille: 40, alea: alea(4) });
  verifier('possédés : réintégrés quand on le demande', sans.some((p) => possedes.has(p.jeu.titre.toLowerCase())));
}

// 5. Mêmes réponses, même file -------------------------------------------
{
  const c = { ...CRITERES_VIDES, joueurs: 2, familles: ['action'] };
  const a = proposer(jeux, c, { taille: 20, alea: alea(7) }).map((p) => p.jeu.id).join(',');
  const b = proposer(jeux, c, { taille: 20, alea: alea(7) }).map((p) => p.jeu.id).join(',');
  verifier('déterminisme : deux appels identiques donnent la même file', a === b);
}

// 6. Le questionnaire ne pose que des questions utiles --------------------
{
  const solo = critereDe({ joueurs: ['solo'], envie: ['cerveau'], temps: ['soiree'] });
  verifier('critères : le solo est bien lu', solo.joueurs === 1 && solo.familles.includes('reflexion'));
  verifier('critères : une soirée = moins de 10 h', solo.dureeMax === 10 && solo.dureeMin === null);
  const posees = questionsPertinentes(solo).map((q) => q.id);
  verifier('questions : pas de « coop ou versus » quand on joue seul', !posees.includes('ensemble') && !posees.includes('local'));

  const groupe = critereDe({ joueurs: ['groupe'], ensemble: ['coop'], local: ['canape'] });
  verifier('critères : la tablée est bien lue', groupe.joueurs === 4 && groupe.ensemble === 'coop' && groupe.local === true);
  verifier('questions : « coop ou versus » revient dès qu\'on est plusieurs',
    questionsPertinentes(groupe).map((q) => q.id).includes('ensemble'));

  // revenir en arrière doit EFFACER ce que l'ancienne réponse impliquait
  const change = critereDe({ joueurs: ['solo'], ensemble: ['coop'] });
  verifier('critères : repasser en solo annule le mode de jeu', change.joueurs === 1 && change.ensemble === null);

  // plusieurs envies cumulables
  const deux = critereDe({ envie: ['adrenaline', 'peur'] });
  verifier('critères : les envies se cumulent', deux.familles.includes('action') && deux.familles.includes('horreur'));
  verifier('questionnaire : toutes les questions ont au moins deux choix',
    QUESTIONS.every((q) => q.choix.length >= 2));
}

// 7. Le cul-de-sac est détecté -------------------------------------------
{
  // iOS n'existe dans aucun jeu de test : le cul-de-sac est garanti, c'est le but
  const impossible = { ...CRITERES_VIDES, joueurs: 5, plateforme: 'ios', familles: ['horreur'] };
  const props = proposer(jeux, impossible, { taille: 30, alea: alea(9) });
  console.log(`  combinaison pointue → ${props.filter((p) => !p.surprise).length} vrais résultats` +
    `${tropPeu(props) ? ' → bascule IGDB' : ''}`);
  verifier('cul-de-sac : tropPeu() répond juste',
    tropPeu(props) === (props.filter((p) => !p.surprise).length < 5));
}

// 8. Le score sait pourquoi il propose ------------------------------------
{
  const c = { ...CRITERES_VIDES, joueurs: 4, ensemble: 'coop', local: true, familles: ['fun'] };
  const avecRaisons = proposer(jeux, c, { taille: 10, alea: alea(11) }).filter((p) => p.raisons.length);
  verifier('raisons : les meilleures cartes savent se justifier', avecRaisons.length >= 5);
  const { raisons } = noter(jeux[15], c);
  verifier('raisons : au plus trois, pour tenir sur une carte', raisons.length <= 3);
}

console.log(echecs === 0 ? `\n✅ TOUT PASSE` : `\n❌ ${echecs} échec(s)`);
process.exit(echecs ? 1 : 0);
