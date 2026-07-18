# Brief — App « Game Backlog Enricher »

## 🎯 Objectif
Prendre ta liste de jeux (extraite de tes saves Instagram) et l'enrichir **automatiquement** :
date de sortie ISO, **dispo ou pas**, **prix multi-boutiques (CHF)**, **gratuit / bon plan**, **notes critiques**.
Mettre en avant ce qui est **jouable maintenant**, **gratuit**, ou **pas cher**.

---

## 🔌 Sources de données — la vérité sur chacune

| Source | Donne | Accès | Clé | Coût | Verdict |
|---|---|---|---|---|---|
| **Steam Storefront** (`appdetails`, `storesearch`) | prix CHF, gratuit, `coming_soon`, date, **Metacritic**, genres | REST public | ❌ | gratuit | ✅ socle (marche direct) |
| **IGDB** (Twitch) | **dates fiables** (timestamp), plateformes, note critiques agrégée, genres, statut | REST + OAuth Twitch | ✅ Twitch | gratuit | ✅ backbone metadata |
| **IsThereAnyDeal v2** | **meilleur prix tous stores** (Steam, Instant Gaming, GOG, Epic, Fanatical…), deals, **plus-bas historique** | REST | ✅ `key` | gratuit | ✅ prix + bon plan |
| **OpenCritic** (RapidAPI) | note agrégée, % recommandé | REST | ✅ RapidAPI | freemium | ⚠️ option (sinon Metacritic via Steam) |
| Instant Gaming direct | prix clés | scraping | — | — | ❌ déjà agrégé par ITAD |
| IGN / jeuxvideo.com | notes | scraping | — | — | ❌ fragile → agrégateurs |
| Google search | fallback matching | SerpAPI | payant | — | ❌ inutile si IGDB+ITAD |

**Pourquoi pas ta recherche Google directe :** matcher `nom → jeu` se fait mieux via **IGDB search** (base canonique) + **ITAD lookup** (par titre ou Steam AppID). Zéro captcha, zéro markup cassant. Instant Gaming = couvert par ITAD. Les notes par média (IGN, JV.com) n'ont pas d'API propre → on prend les **agrégateurs** (Metacritic via Steam, OpenCritic) au lieu de scraper 3 sites.

---

## 🧱 Décision d'archi (tranchée)
**3 APIs, zéro scraping :**
- **IGDB** → identité + dates + note critiques + plateformes *(résout tes ~66 dates manquantes)*
- **ITAD** → prix multi-boutiques + gratuit + bon plan + plus-bas historique
- **Steam** → prix CHF + Metacritic + fallback dispo

**Matching :** `titre → IGDB search → (nom canon + Steam AppID) → ITAD lookup(AppID)`.
Le **Steam AppID est la clé de jointure** fiable entre les 3 sources.

---

## 📦 Modèle de données (1 jeu)
```json
{
  "titre": "The Mound: Omen of Cthulhu",
  "igdbId": 123, "steamAppId": 456,
  "sortieISO": "2026-07-15", "sortiePrecision": "jour",
  "dispo": true, "gratuit": false, "bonPlan": true,
  "prix": { "meilleur": 14.5, "devise": "CHF", "store": "Instant Gaming",
            "steam": 19.5, "plusBasHisto": 12.9, "reducPct": 25 },
  "notes": { "metacritic": 78, "opencritic": 80 },
  "coop": "Oui", "multi": "Oui",
  "genre": "Horreur / Extraction", "univers": "Lovecraft",
  "plateformes": ["PC","PS5","Xbox"],
  "url": { "steam": "…", "igdb": "…", "reel": "https://instagram.com/…" }
}
```

---

## 🏷️ Règles de mise en avant (badges)
- **✅ Dispo** : `steam.coming_soon = false` OU `sortieISO ≤ aujourd'hui` OU ITAD a un prix hors-précommande
- **🆓 Gratuit** : `steam.is_free` OU meilleur prix = 0
- **💸 Bon plan** : meilleur prix ≤ **15 CHF** OU réduction ≥ **40 %** OU prix ≤ 110 % du plus-bas historique
- **⭐ Bien noté** : note agrégée ≥ 80

Tri par : `sortieISO`, `prix.meilleur`, `notes`.

---

## 🔄 Pipeline
1. Lire `jeux-liste-unique.csv`
2. Par jeu : IGDB search → ITAD lookup(AppID‖titre) → Steam appdetails
3. Fusionner + calculer flags (dispo / gratuit / bonPlan)
4. Écrire `jeux-enrichi.json` + `.csv`
5. **Cache local** (JSON) → ne pas refrapper les APIs à chaque run

---

## 🏗️ Archi technique (MVP → v1 → v2)
- **MVP (fourni : `enrich.mjs`)** : script **Node CLI**, zéro dépendance, `fetch` natif. Marche direct avec Steam ; IGDB/ITAD s'activent dès que les clés sont en `.env`. Sort JSON + CSV.
- **v1** : petite **API Node (Fastify)** qui sert le JSON enrichi + cache (fichier JSON ou SQLite). Ex. `GET /games?dispo=true&max=15&sort=note`.
- **v2** : **interface Next.js 16** (App Router, Tailwind v4, Shadcn) — table filtrable + badges + tri. Déploiement Vercel.

---

## 🔑 Clés à obtenir (~5 min)
- **Twitch (IGDB)** : `dev.twitch.tv/console/apps` → `client_id` + `client_secret`
- **ITAD** : `isthereanydeal.com/dev/app/` → API key
- **OpenCritic** (option) : via RapidAPI
- **Steam** : rien

`.env` : `TWITCH_ID`, `TWITCH_SECRET`, `ITAD_KEY`, `RAPIDAPI_KEY` (option)

---

## 🖥️ Interface Next.js (esquisse v2)
- **Bloc « À jouer maintenant »** en tête : jeux `dispo && coop && note ≥ 80`
- **Table** (Shadcn DataTable) : Titre · Badges · Prix (CHF) · Note · Sortie · Coop · Genre · Univers
- **Filtres** : Dispo / Gratuit / Bon plan / Coop / Genre / Univers
- **Tri** : prix ↑, note ↓, sortie ↓
- **Ligne** : bouton « voir le reel » (lien Insta source) + lien store au meilleur prix

---

## 🚦 Hors scope (MVP fences)
- ❌ Scraping IGN / JV.com / Instant Gaming
- ❌ Comptes users / wishlist sync *(v3 éventuel via ITAD sync)*
- ❌ Docker

---

## ✅ Roadmap
1. **MVP** : `node enrich.mjs` avec les 3 clés → `jeux-enrichi.csv/json` (dates, prix, notes, badges)
2. **v1** : Fastify + cache → API filtrable
3. **v2** : front Next.js sur Vercel
