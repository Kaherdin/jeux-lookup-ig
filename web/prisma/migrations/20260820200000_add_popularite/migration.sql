-- Popularité : avis Steam cumulés, joueurs connectés au moment du scan,
-- et votes IGDB pour les jeux qui ne sont pas sur Steam (bibliothèque PSN).
ALTER TABLE "game" ADD COLUMN IF NOT EXISTS "steamAvis" INTEGER;
ALTER TABLE "game" ADD COLUMN IF NOT EXISTS "joueursSteam" INTEGER;
ALTER TABLE "game" ADD COLUMN IF NOT EXISTS "igdbVotes" INTEGER;
