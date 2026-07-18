-- CreateTable
CREATE TABLE "game" (
    "id" TEXT NOT NULL,
    "titre" TEXT NOT NULL,
    "igdbId" TEXT,
    "steamAppId" TEXT,
    "image" TEXT,
    "genre" TEXT,
    "univers" TEXT,
    "plateformes" TEXT[],
    "sortieISO" TEXT,
    "sortiePrec" TEXT,
    "dispo" BOOLEAN NOT NULL DEFAULT false,
    "gratuit" BOOLEAN NOT NULL DEFAULT false,
    "gratuitMention" TEXT,
    "bonPlan" BOOLEAN NOT NULL DEFAULT false,
    "bienNote" BOOLEAN NOT NULL DEFAULT false,
    "comingSoon" BOOLEAN,
    "prix" JSONB,
    "prixSteam" DOUBLE PRECISION,
    "reducPct" INTEGER NOT NULL DEFAULT 0,
    "note" INTEGER,
    "noteSource" TEXT,
    "metacritic" INTEGER,
    "steamPct" INTEGER,
    "modes" JSONB,
    "modesDetail" JSONB,
    "nbJoueurs" TEXT,
    "nbJoueursMax" INTEGER,
    "urlSteam" TEXT,
    "urlStore" TEXT,
    "urlPsn" TEXT,
    "reel" TEXT,
    "createur" TEXT,
    "ajouteLe" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "game_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "game_titre_key" ON "game"("titre");
