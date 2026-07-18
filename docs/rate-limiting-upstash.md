# Sécuriser une app Next.js contre le spam — Rate limiting avec Upstash

Guide réutilisable (Next.js App Router + Server Actions / next-safe-action + Vercel).
Objectif : empêcher le spam d'actions coûteuses (appels LLM, enrichissement via APIs
externes, écritures DB) sans casser l'expérience des utilisateurs légitimes.

## TL;DR — le modèle en 3 couches

| Couche | Rôle | Contourne­able ? | Ce qu'on y met |
|---|---|---|---|
| **Frontend** | Confort UX | ✅ Oui (jamais une sécurité) | Boutons désactivés pendant l'appel, debounce, `confirm()` |
| **Backend** | **La vraie barrière** | ❌ Non | Rate-limit dans le middleware des server actions (Upstash) |
| **Infra / serveur** | Défense en profondeur | ❌ Non | Vercel Firewall (WAF) + Spend Management |

> Règle d'or : **le frontend n'est jamais une sécurité.** Tout ce qui protège
> l'argent/les données doit être appliqué **côté serveur**, keyé par utilisateur/IP.

---

## 1. Backend — Upstash Redis + `@upstash/ratelimit` (le cœur)

Upstash = Redis serverless (REST), parfait pour Vercel (pas de connexion TCP
persistante). Le rate-limit y est distribué (marche sur toutes les lambdas).

### Install

```bash
npm install @upstash/ratelimit @upstash/redis
```

### Créer la base (gratuit)

**Option A — via Vercel (recommandé).** Vercel → onglet **Storage** → **Upstash**
(Serverless DB). Ça crée la base **et injecte automatiquement les variables d'env**
dans le projet — pas de copier-coller de tokens. Pense juste à `vercel env pull
.env.local` (ou copie les 2 vars) pour le dev local.

**Option B — Upstash direct.** https://console.upstash.com → **Create Database** →
Redis → région proche de Vercel (ex. `us-east-1` / `iad1`) → onglet **REST API** →
copie l'URL + le token, ajoute-les en `.env.local` **et** dans Vercel.

> ⚠️ **Nom des variables selon la méthode :** l'intégration Vercel peut nommer les
> variables `UPSTASH_REDIS_REST_URL`/`_TOKEN` **ou** `KV_REST_API_URL`/`KV_REST_API_TOKEN`
> (ancienne convention Vercel KV). Rends le code tolérant aux deux :
> ```ts
> const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
> const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
> ```

**Coût :** plan Free = 500 000 commandes/mois + 256 Mo, sans CB. Un check de
rate-limit ≈ 1 commande → un petit projet reste gratuit. Au-delà : $0.20 /
100 000 commandes (pay-as-you-go), et tu peux fixer un **plafond mensuel** dans
le dashboard pour ne jamais être surpris.

### La couche `lib/ratelimit.ts` (gracieuse)

Point clé : **si les env vars sont absentes, on ne bloque rien** (l'app tourne
sans Upstash, pratique en dev / avant setup).

```ts
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

const url = process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN;
const redis = url && token ? new Redis({ url, token }) : null;

type Window = `${number} ${"s" | "m" | "h" | "d"}`;
function make(limit: number, window: Window, prefix: string) {
  if (!redis) return null;
  return new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(limit, window), prefix });
}

// Paliers selon le coût de l'action
const limiters = {
  general: make(40, "1 m", "rl:gen"),   // garde-fou global
  enrich:  make(15, "1 m", "rl:enrich"), // actions qui tapent des APIs externes
  heavy:   make(4, "10 m", "rl:heavy"),  // actions très coûteuses (batch/LLM massif)
};
export type RateTier = keyof typeof limiters;

export async function allow(tier: RateTier, key: string): Promise<boolean> {
  const l = limiters[tier];
  if (!l) return true;              // pas d'Upstash → no-op
  try { return (await l.limit(key)).success; }
  catch { return true; }           // Redis down → on ne bloque pas
}

export function ipFrom(h: Headers): string {
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
}
```

**Choix du `limiter` :**
- `slidingWindow(n, "1 m")` — le plus juste (pas d'effet de bord au changement de
  fenêtre). Recommandé par défaut.
- `fixedWindow` — moins cher en commandes mais permet des bursts à la frontière.
- `tokenBucket` — pour autoriser des rafales contrôlées.

### Brancher dans le middleware next-safe-action

Un seul endroit → **toutes** les actions protégées. On keye par `userId`
(connecté) ou IP (anonyme).

```ts
// lib/safe-action.ts
export const authActionClient = actionClient.use(async ({ next }) => {
  const h = await headers();
  const session = await auth.api.getSession({ headers: h });
  if (!session?.user) throw new Error("Tu dois être connecté.");
  if (!(await allow("general", `u:${session.user.id}`)))
    throw new Error("Trop de requêtes — patiente une minute.");
  return next({ ctx: { user: session.user, ip: ipFrom(h) } });
});
```

Puis, dans les actions **coûteuses**, un palier plus strict en plus du global :

```ts
export const detectGames = authActionClient
  .inputSchema(...)
  .action(async ({ parsedInput, ctx }) => {
    if (!(await allow("enrich", `u:${ctx.user.id}`)))
      throw new Error("Analyse limitée — réessaie dans une minute.");
    // ...
  });
```

**Stratégie de clé (`key`) :**
- Connecté → `u:<userId>` (suit l'utilisateur, même s'il change d'IP).
- Anonyme → `ip:<ip>` (moins fiable — VPN/CGNAT — mais suffisant en garde-fou).
- Sensible (LLM, budget $) → combine : bloque si l'un **ou** l'autre dépasse.
- Par ressource → `u:<userId>:list:<listId>` pour limiter par liste, pas par user.

---

## 2. Infra — Vercel (défense en profondeur)

- **Firewall / WAF** (Vercel → Firewall) : règles de rate-limit par IP au bord du
  réseau (avant même d'atteindre ta lambda), + **Attack Challenge Mode** en cas
  d'attaque. Bloque le trafic brut/bot que le rate-limit applicatif ne voit pas.
- **Spend Management** (Vercel → Settings → Billing) : plafond $ qui **coupe les
  fonctions** si la conso explose. Le vrai filet anti-facture-surprise.
- **`maxDuration`** raisonnable sur les routes coûteuses (évite les lambdas qui
  tournent trop longtemps).

---

## 3. Frontend — confort seulement

- Désactive le bouton pendant l'appel (`disabled={action.isPending}`).
- `confirm()` avant une action lourde (rescan complet).
- Debounce la recherche / les inputs qui déclenchent des requêtes.
- Affiche un message clair quand le serveur renvoie l'erreur de rate-limit.

> Ces mesures **réduisent les erreurs accidentelles** mais ne protègent de rien :
> un client malveillant appelle l'action directement. Ne t'y fie jamais.

---

## Spécial LLM (coûts qui grimpent vite)

- **N'appelle le LLM que quand nécessaire** (fallback : seulement si la donnée
  manque après les sources gratuites).
- **Palier dédié** `heavy` sur les actions qui font N appels LLM (ex. rescan de
  toute une liste).
- **Budget quotidien par utilisateur** : un compteur Redis
  `llm:<userId>:<jour>` incrémenté à chaque appel, bloqué au-delà d'un seuil.
- **Kill-switch global** : une env var `LLM_ENABLED=0` pour tout couper sans redeploy majeur.
- **Cap le nombre d'items** par requête (ex. 40 max par analyse) — garde-fou avant même le rate-limit.

---

## Checklist de mise en place

- [ ] `npm i @upstash/ratelimit @upstash/redis`
- [ ] `lib/ratelimit.ts` gracieux (no-op sans env vars)
- [ ] Base Upstash créée → `UPSTASH_REDIS_REST_URL` + `_TOKEN` en local **et** Vercel
- [ ] Garde-fou `general` dans le middleware auth (par user)
- [ ] Palier strict (`enrich`/`heavy`) dans chaque action coûteuse
- [ ] Cap du nombre d'items par requête
- [ ] Vercel Firewall (règle rate-limit IP) activé
- [ ] Vercel Spend Management (plafond $) configuré
- [ ] Frontend : boutons désactivés pendant l'appel + message d'erreur clair
- [ ] (LLM) budget quotidien / kill-switch si coûts sensibles
