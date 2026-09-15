"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/dal";
import { prisma } from "@/lib/prisma";
import { CreateUserSchema, UpdateUserSchema } from "@/lib/validation";

export type ActionState = { error?: string } | undefined;

export async function createUser(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireAdmin();

  const parsed = CreateUserSchema.safeParse({
    name: formData.get("name"),
    adUsername: formData.get("adUsername"),
    roleId: formData.get("roleId"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const existing = await prisma.user.findUnique({ where: { adUsername: parsed.data.adUsername } });
  if (existing) {
    return { error: "A user with that AD username already exists." };
  }

  await prisma.user.create({
    data: {
      name: parsed.data.name,
      adUsername: parsed.data.adUsername,
      roleId: parsed.data.roleId,
    },
  });

  revalidatePath("/settings/users");
}

export async function updateUser(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireAdmin();

  const parsed = UpdateUserSchema.safeParse({
    id: formData.get("id"),
    name: formData.get("name"),
    adUsername: formData.get("adUsername"),
    roleId: formData.get("roleId"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const conflict = await prisma.user.findFirst({
    where: { adUsername: parsed.data.adUsername, NOT: { id: parsed.data.id } },
  });
  if (conflict) {
    return { error: "A user with that AD username already exists." };
  }

  await prisma.user.update({
    where: { id: parsed.data.id },
    data: {
      name: parsed.data.name,
      adUsername: parsed.data.adUsername,
      roleId: parsed.data.roleId,
    },
  });

  revalidatePath("/settings/users");
}

export async function setUserActive(userId: string, isActive: boolean): Promise<void> {
  const session = await requireAdmin();

  // Guardrail: a user can never deactivate their own currently-logged-in account.
  // The UI already omits this action for the current user; this is the backstop.
  if (!isActive && userId === session.user.id) return;

  await prisma.user.update({ where: { id: userId }, data: { isActive } });
  revalidatePath("/settings/users");
}

export async function deleteUser(userId: string): Promise<void> {
  const session = await requireAdmin();

  // Guardrail: a user can never delete their own currently-logged-in account.
  // The UI already omits this action for the current user; this is the backstop.
  if (userId === session.user.id) return;

  await prisma.user.delete({ where: { id: userId } });
  revalidatePath("/settings/users");
}
