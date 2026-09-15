"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/dal";
import { prisma } from "@/lib/prisma";
import { ListItemSchema, RenameListItemSchema } from "@/lib/validation";

export type ListActionState = { error?: string } | undefined;

// The three reference lists are structurally identical (id + unique name), so the work
// lives in one helper and each entity just gets thin exported wrappers — a "use server"
// module can only export async actions, but private helpers are fine.
type ListModel =
  | "sampleFunction"
  | "physicalForm"
  | "supplier"
  | "chemicalFamily"
  | "regulatoryFunction"
  | "project";

type SimpleListDelegate = {
  findFirst(args: { where: { name: string } }): Promise<{ id: string; name: string } | null>;
  create(args: { data: { name: string } }): Promise<unknown>;
  update(args: { where: { id: string }; data: { name: string } }): Promise<unknown>;
  delete(args: { where: { id: string } }): Promise<unknown>;
};

function delegateFor(model: ListModel): SimpleListDelegate {
  switch (model) {
    case "sampleFunction":
      return prisma.sampleFunction as unknown as SimpleListDelegate;
    case "physicalForm":
      return prisma.physicalForm as unknown as SimpleListDelegate;
    case "supplier":
      return prisma.supplier as unknown as SimpleListDelegate;
    case "chemicalFamily":
      return prisma.chemicalFamily as unknown as SimpleListDelegate;
    case "regulatoryFunction":
      return prisma.regulatoryFunction as unknown as SimpleListDelegate;
    case "project":
      return prisma.project as unknown as SimpleListDelegate;
  }
}

const LABELS: Record<ListModel, string> = {
  sampleFunction: "Function",
  physicalForm: "Physical form",
  supplier: "Supplier",
  chemicalFamily: "Chemical family",
  regulatoryFunction: "Regulatory function",
  project: "Project",
};

// Samples and ingredients store these as names, not FKs, so "still in use" has to be
// checked by value against whichever table consumes the list.
async function countSamplesUsing(model: ListModel, name: string): Promise<number> {
  switch (model) {
    case "sampleFunction":
      return prisma.sample.count({ where: { function: name } });
    case "physicalForm":
      return prisma.sample.count({ where: { physicalForm: name } });
    case "supplier":
      return prisma.sample.count({ where: { supplier: name } });
    case "chemicalFamily":
      return prisma.ingredientListEntry.count({ where: { chemicalFamily: name } });
    case "regulatoryFunction":
      return prisma.ingredientListEntry.count({ where: { regulatoryFunction: name } });
    case "project":
      return prisma.sample.count({ where: { projectName: name } });
  }
}

async function createItem(model: ListModel, formData: FormData): Promise<ListActionState> {
  await requireAdmin();

  const parsed = ListItemSchema.safeParse({ name: formData.get("name") });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const delegate = delegateFor(model);
  // SQL Server's default collation is case-insensitive, so this also catches "liquid"
  // colliding with an existing "Liquid".
  const existing = await delegate.findFirst({ where: { name: parsed.data.name } });
  if (existing) {
    return { error: `"${existing.name}" is already in the ${LABELS[model].toLowerCase()} list.` };
  }

  try {
    await delegate.create({ data: { name: parsed.data.name } });
  } catch {
    return { error: "Could not save. Try again." };
  }

  revalidatePath("/settings/lists");
}

async function renameItem(model: ListModel, formData: FormData): Promise<ListActionState> {
  await requireAdmin();

  const parsed = RenameListItemSchema.safeParse({
    id: formData.get("id"),
    name: formData.get("name"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const delegate = delegateFor(model);
  const clash = await delegate.findFirst({ where: { name: parsed.data.name } });
  if (clash && clash.id !== parsed.data.id) {
    return { error: `"${clash.name}" is already in the ${LABELS[model].toLowerCase()} list.` };
  }

  try {
    await delegate.update({ where: { id: parsed.data.id }, data: { name: parsed.data.name } });
  } catch {
    return { error: "Could not save. Try again." };
  }

  revalidatePath("/settings/lists");
}

// Deleting a value that samples still reference would leave those samples pointing at a
// name that no longer exists in the list, so it's blocked rather than silently orphaned.
async function deleteItem(model: ListModel, id: string, name: string): Promise<void> {
  await requireAdmin();

  const inUse = await countSamplesUsing(model, name);
  if (inUse > 0) return;

  await delegateFor(model).delete({ where: { id } });
  revalidatePath("/settings/lists");
}

export async function createFunction(_p: ListActionState, fd: FormData) {
  return createItem("sampleFunction", fd);
}
export async function renameFunction(_p: ListActionState, fd: FormData) {
  return renameItem("sampleFunction", fd);
}
export async function deleteFunction(id: string, name: string) {
  return deleteItem("sampleFunction", id, name);
}

export async function createPhysicalForm(_p: ListActionState, fd: FormData) {
  return createItem("physicalForm", fd);
}
export async function renamePhysicalForm(_p: ListActionState, fd: FormData) {
  return renameItem("physicalForm", fd);
}
export async function deletePhysicalForm(id: string, name: string) {
  return deleteItem("physicalForm", id, name);
}

export async function createSupplier(_p: ListActionState, fd: FormData) {
  return createItem("supplier", fd);
}
export async function renameSupplier(_p: ListActionState, fd: FormData) {
  return renameItem("supplier", fd);
}
export async function deleteSupplier(id: string, name: string) {
  return deleteItem("supplier", id, name);
}

export async function createChemicalFamily(_p: ListActionState, fd: FormData) {
  return createItem("chemicalFamily", fd);
}
export async function renameChemicalFamily(_p: ListActionState, fd: FormData) {
  return renameItem("chemicalFamily", fd);
}
export async function deleteChemicalFamily(id: string, name: string) {
  return deleteItem("chemicalFamily", id, name);
}

export async function createRegulatoryFunction(_p: ListActionState, fd: FormData) {
  return createItem("regulatoryFunction", fd);
}
export async function renameRegulatoryFunction(_p: ListActionState, fd: FormData) {
  return renameItem("regulatoryFunction", fd);
}
export async function deleteRegulatoryFunction(id: string, name: string) {
  return deleteItem("regulatoryFunction", id, name);
}

export async function createProject(_p: ListActionState, fd: FormData) {
  return createItem("project", fd);
}
export async function renameProject(_p: ListActionState, fd: FormData) {
  return renameItem("project", fd);
}
export async function deleteProject(id: string, name: string) {
  return deleteItem("project", id, name);
}
