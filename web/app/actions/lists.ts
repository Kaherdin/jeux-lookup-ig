"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { authActionClient } from "@/lib/safe-action";
import { prisma } from "@/lib/prisma";
import { createList } from "@/lib/store";

function slugify(s: string) {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
}

export const createNewList = authActionClient
  .inputSchema(
    z.object({
      name: z.string().min(2, "Nom trop court").max(60),
      description: z.string().max(300).optional(),
      isPublic: z.boolean().default(true),
    })
  )
  .action(async ({ parsedInput: { name, description, isPublic }, ctx }) => {
    const base = slugify(name) || "liste";
    let slug = base;
    let i = 1;
    while (await prisma.list.findUnique({ where: { slug } })) slug = `${base}-${i++}`;
    const list = await createList({ name, slug, description: description || null, isPublic, ownerId: ctx.user.id });
    revalidatePath("/");
    return { slug: list.slug, name: list.name };
  });

export const deleteList = authActionClient
  .inputSchema(z.object({ slug: z.string() }))
  .action(async ({ parsedInput: { slug }, ctx }) => {
    const list = await prisma.list.findUnique({ where: { slug } });
    if (!list) throw new Error("Liste introuvable.");
    if (list.ownerId !== ctx.user.id) throw new Error("Cette liste ne t'appartient pas.");
    await prisma.list.delete({ where: { id: list.id } });
    revalidatePath("/");
    return { ok: true };
  });
