import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis;

export const prisma =
  globalForPrisma.__prisma ??
  new PrismaClient({
    datasources: { db: { url: process.env.POSTGRES_URL } },
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.__prisma = prisma;
