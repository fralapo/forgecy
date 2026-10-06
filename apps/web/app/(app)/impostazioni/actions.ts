"use server";

import { assertCan } from "@forgecy/core";
import { eq, getDb, users } from "@forgecy/db";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/session";
import { createPasswordUser } from "@/lib/users";

const newUserSchema = z.object({
  name: z.string().trim().min(1, "Scrivi il nome"),
  email: z.email("Email non valida"),
  password: z.string().min(12, "La password deve avere almeno 12 caratteri"),
  isAdmin: z
    .literal("on")
    .optional()
    .transform((v) => v === "on"),
});

export type NewUserState = { error?: string; ok?: boolean };

export async function createUserAction(_prev: NewUserState, form: FormData): Promise<NewUserState> {
  const admin = await requireUser();
  assertCan(admin.actor, "users.manage");
  const parsed = newUserSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Dati non validi" };
  const exists = await getDb().query.users.findFirst({
    where: eq(users.email, parsed.data.email.toLowerCase()),
    columns: { id: true },
  });
  if (exists) return { error: "Esiste già un utente con questa email." };
  await createPasswordUser({ ...parsed.data, createdBy: admin.id });
  revalidatePath("/impostazioni");
  return { ok: true };
}
