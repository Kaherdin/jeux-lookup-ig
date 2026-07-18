# 🎮 Game Backlog Enricher

Prend ta liste de jeux (saves Instagram) et l'enrichit : date de sortie, dispo,
prix multi-boutiques, gratuit/bon plan, notes critiques, modes (Solo/Coop/PvP),
nombre de joueurs. Trois sources : **Steam** (gratuit, sans clé), **IGDB** (dates + notes),
**IsThereAnyDeal** (meilleur prix + plus-bas historique).

## Structure

```
lib.mjs                 logique partagée (enrichissement + détection de titre)
enrich.mjs              batch CSV  → jeux-enrichi.json / .csv
server.mjs             mini-serveur local (UI + ajout à la volée)
viewer-template.html    gabarit de l'UI
build-viewer.mjs        génère index.html autonome (double-clic, hors-ligne)
web/                    app Next.js v2 (déployable Vercel, persistance Vercel Blob)
```

## Clés (.env à la racine)

```
TWITCH_ID=...
TWITCH_SECRET=...      # → IGDB (dates fiables + notes agrégées)
ITAD_KEY=...           # → prix multi-boutiques + plus-bas historique
```

> ⚠️ ITAD : c'est l'**API Key** (page de ton app ITAD), pas le Client ID/Secret OAuth.

## Usage

```bash
# 1. Enrichir la collection (relit le CSV, dédoublonne, appelle les 3 APIs)
node enrich.mjs           # utilise le cache
node enrich.mjs --force   # rafraîchit tout

# 2a. Consultation simple, hors-ligne
node build-viewer.mjs     # → index.html (double-clic)

# 2b. Serveur local avec ajout à la volée
node server.mjs           # → http://localhost:8787

# 3. App Next.js (v2)
cd web && npm install && npm run dev   # → http://localhost:3000
```

## Ajouter un jeu

Colle un **lien Steam** (match exact), une **vidéo YouTube** (titre nettoyé),
un **reel Instagram** (best-effort) ou un **titre libre**. Détection → enrichissement → ajout.

## Déploiement Vercel (web/)

- Root Directory : `web`
- Env vars : `TWITCH_ID`, `TWITCH_SECRET`, `ITAD_KEY` (+ Blob : `BLOB_READ_WRITE_TOKEN` auto)
- Connecter un **Vercel Blob store** → les ajouts en ligne sont persistés et visibles
  immédiatement (pas de redéploiement).
- Sans Blob : le site lit le `web/data/games.json` commité (lecture seule).

## Badges / règles

- ✅ **Dispo** · 🆓 **Gratuit** · 💸 **Bon plan** (≤ 15 CHF, ou −40 %, ou ≤ 110 % du plus-bas) · ⭐ **Bien noté** (≥ 80)
- Modes : 🎯 Solo · 👥 Coop · ⚔️ PvP (catégories Steam + game_modes IGDB)
