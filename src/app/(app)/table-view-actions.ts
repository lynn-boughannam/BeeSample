"use server";

import { revalidatePath } from "next/cache";
import { verifySession } from "@/lib/dal";
import { prisma } from "@/lib/prisma";
import { isTableKey, sanitiseColumnKeys } from "@/lib/table-views";

export type TableViewResult = { ok: true } | { ok: false; error: string };

// Saving a column layout is scoped to the signed-in user by construction — the userId
// comes from the session, never from the caller — so one user can't write another's view.
export async function saveTableView(
  tableKey: string,
  columns: string
): Promise<TableViewResult> {
  const session = await verifySession();

  if (!isTableKey(tableKey)) {
    return { ok: false, error: "Unknown table." };
  }

  const cleaned = sanitiseColumnKeys(columns);
  if (!cleaned) {
    return { ok: false, error: "Choose at least one column before saving." };
  }

  await prisma.savedTableView.upsert({
    where: { userId_tableKey: { userId: session.user.id, tableKey } },
    update: { columns: cleaned },
    create: { userId: session.user.id, tableKey, columns: cleaned },
  });

  revalidatePath(`/${tableKey}`);
  return { ok: true };
}

export async function clearTableView(tableKey: string): Promise<TableViewResult> {
  const session = await verifySession();

  if (!isTableKey(tableKey)) {
    return { ok: false, error: "Unknown table." };
  }

  // deleteMany rather than delete: clearing a view that was already cleared (a double
  // click, a stale tab) should be a no-op, not a "record not found" crash.
  await prisma.savedTableView.deleteMany({
    where: { userId: session.user.id, tableKey },
  });

  revalidatePath(`/${tableKey}`);
  return { ok: true };
}
