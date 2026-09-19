"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin, verifySession } from "@/lib/dal";
import { prisma } from "@/lib/prisma";
import { CreateSampleOrderSchema, UpdateSampleOrderSchema } from "@/lib/validation";
import {
  canEditOrder,
  isTerminal,
  needsExistingSample,
  needsShortSupplierListConfirmation,
} from "@/lib/orders";
import type { OrderStatus } from "@/lib/types";
import { nextIngredientCode } from "@/lib/ingredient-code";

export type OrderFormState =
  | { fieldErrors?: Record<string, string>; formError?: string }
  | undefined;

function fieldErrorsFrom(issues: { path: PropertyKey[]; message: string }[]) {
  const fieldErrors: Record<string, string> = {};
  for (const issue of issues) {
    const field = String(issue.path[0] ?? "form");
    fieldErrors[field] ??= issue.message;
  }
  return fieldErrors;
}

const text = (fd: FormData, name: string) => fd.get(name);

// Shared by raising and editing a request, so the two can't drift on what a typed INCI or
// an unknown supplier does.

// Only ids that still exist are linked: a form held open while someone deletes an
// ingredient would otherwise fail on the insert.
async function existingIngredientIds(ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const rows = await prisma.ingredientListEntry.findMany({
    where: { id: { in: ids } },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

// INCI typed into "Other INCI not in the list" becomes a real record, so the request links
// to something rather than restating a name as text. A stub carries only the name, which
// is what isIncomplete() flags (SLT-18): it arrives in the Ingredient List already marked
// as needing its safety data. Matching is case-insensitive via the collation, so
// "limonene" finds "Limonene" and no duplicate is made.
async function resolveTypedInci(raw: string | null | undefined): Promise<string[]> {
  const names = (raw ?? "").split(",").map((n) => n.trim()).filter(Boolean);
  const ids: string[] = [];
  for (const name of names) {
    const existing = await prisma.ingredientListEntry.findFirst({
      where: { inciName: name },
      select: { id: true },
    });
    if (existing) {
      ids.push(existing.id);
      continue;
    }
    const created = await prisma.ingredientListEntry.create({
      data: { uid: await nextIngredientCode(), inciName: name },
      select: { id: true },
    });
    ids.push(created.id);
  }
  return ids;
}

// Suppliers named on a request join the managed list if they aren't on it already, so the
// reference data grows from real use. A failure here is logged rather than thrown: the
// name is still recorded on the order, and losing the request over it would be worse.
async function ensureSupplierNamed(raw: string | null | undefined) {
  const name = (raw ?? "").trim();
  if (!name) return;
  const existing = await prisma.supplier.findFirst({ where: { name }, select: { id: true } });
  if (existing) return;
  try {
    await prisma.supplier.create({ data: { name } });
  } catch (error) {
    console.error("could not add supplier to the list", name, error);
  }
}


// SLT-58 step 1. Both Formulators and Admins raise requests, so this is verifySession
// rather than requireAdmin.
export async function createSampleOrder(
  _prev: OrderFormState,
  formData: FormData
): Promise<OrderFormState> {
  const session = await verifySession();

  const parsed = CreateSampleOrderSchema.safeParse({
    requestType: text(formData, "requestType"),
    existingSampleId: text(formData, "existingSampleId"),
    ingredientIds: formData.getAll("ingredientIds").map(String).filter(Boolean),
    inciName: text(formData, "inciName"),
    physicalForm: text(formData, "physicalForm"),
    category: text(formData, "category"),
    source: text(formData, "source"),
    function: text(formData, "function"),
    projectName: text(formData, "projectName"),
    mainCharacteristic: text(formData, "mainCharacteristic"),
    application: text(formData, "application"),
    productFormat: text(formData, "productFormat"),
    dosageOfUse: text(formData, "dosageOfUse"),
    requiredQuantityG: text(formData, "requiredQuantityG"),
    referenceLink: text(formData, "referenceLink"),
    requiredDocuments: text(formData, "requiredDocuments"),
    supplierName: text(formData, "supplierName"),
    supplier1: text(formData, "supplier1"),
    supplier2: text(formData, "supplier2"),
    supplier3: text(formData, "supplier3"),
    directorApprovalConfirmed: formData.get("directorApprovalConfirmed") === "on",
    shortSupplierListAcknowledged: formData.get("shortSupplierListAcknowledged") === "on",
    shortSupplierListReason: text(formData, "shortSupplierListReason"),
  });

  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error.issues) };

  const data = parsed.data;
  const suppliers = [data.supplier1, data.supplier2, data.supplier3];

  // AC5/AC6. Re-checked here rather than trusted from the dialog: the browser decides when
  // to show the prompt, but only the server decides whether an unacknowledged short list
  // is allowed to save. Types 2 and 3 never reach this branch at all.
  if (
    needsShortSupplierListConfirmation(data.requestType, suppliers) &&
    !data.shortSupplierListAcknowledged
  ) {
    return {
      fieldErrors: {
        supplier1: "Confirm you want to proceed with fewer than 3 supplier options.",
      },
    };
  }

  const ingredientIds = await existingIngredientIds(data.ingredientIds);
  const typedIds = await resolveTypedInci(data.inciName);

  // The sample has to exist and still be in the library — a request pointing at a deleted
  // row would be unactionable for procurement.
  let existingSampleId: string | null = null;
  if (needsExistingSample(data.requestType)) {
    const sample = await prisma.sample.findUnique({
      where: { id: data.existingSampleId ?? "" },
      select: { id: true },
    });
    if (!sample) {
      return { fieldErrors: { existingSampleId: "That sample no longer exists." } };
    }
    existingSampleId = sample.id;
  }

  // Suppliers are stored per the request type rather than for both shapes at once, so a
  // type switch in the form can't leave stale boxes behind on the saved record.
  const isNew = data.requestType === "NEW";

  try {
    await prisma.sampleOrder.create({
      data: {
        requestType: data.requestType,
        existingSampleId,

        // Cleared: every typed name is now one of the links above.
        inciName: null,
        physicalForm: data.physicalForm ?? null,
        category: data.category ?? null,
        source: data.source ?? null,
        function: data.function ?? null,
        projectName: data.projectName ?? null,

        mainCharacteristic: data.mainCharacteristic ?? null,
        application: data.application ?? null,
        productFormat: data.productFormat ?? null,
        dosageOfUse: data.dosageOfUse ?? null,
        requiredQuantityG: data.requiredQuantityG ?? null,
        referenceLink: data.referenceLink ?? null,
        requiredDocuments: data.requiredDocuments ?? null,

        supplierName: isNew ? null : (data.supplierName ?? null),
        supplier1: isNew ? (data.supplier1 ?? null) : null,
        supplier2: isNew ? (data.supplier2 ?? null) : null,
        supplier3: isNew ? (data.supplier3 ?? null) : null,

        directorApprovalConfirmed: true,
        shortSupplierListAcknowledged: Boolean(data.shortSupplierListAcknowledged),
        // Only meaningful alongside the acknowledgement it explains, and only on a
        // new-material request — the other types never see the prompt.
        shortSupplierListReason:
          isNew && data.shortSupplierListAcknowledged
            ? (data.shortSupplierListReason ?? null)
            : null,

        // AC7: both taken from the server, never from the form.
        orderedById: session.user.id,

        // Deduplicated: a name might be typed that was also ticked in the picker.
        ingredients: {
          create: [...new Set([...ingredientIds, ...typedIds])].map((id) => ({
            ingredientId: id,
          })),
        },
      },
    });
  } catch (error) {
    console.error("createSampleOrder failed", error);
    return { formError: "Could not submit that request. Try again." };
  }

  // Done after the request is safely stored: a supplier that didn't make it onto the
  // reference list is a tidiness problem, not a reason to lose the request.
  if (isNew) {
    await ensureSupplierNamed(data.supplier1);
    await ensureSupplierNamed(data.supplier2);
    await ensureSupplierNamed(data.supplier3);
  } else {
    await ensureSupplierNamed(data.supplierName);
  }

  revalidatePath("/orders");
  revalidatePath("/dashboard");
  revalidatePath("/settings/lists");
  redirect("/orders?submitted=1");
}

// Phase 1 — an Admin editing a request while reviewing it. Admin-only, and only while the
// request is still awaiting review: once approved it has been handed to Supply Chain, and
// changing it underneath them would be worse than asking for a fresh request.
export async function updateSampleOrder(
  _prev: OrderFormState,
  formData: FormData
): Promise<OrderFormState> {
  await requireAdmin();

  const parsed = UpdateSampleOrderSchema.safeParse({
    orderId: text(formData, "orderId"),
    requestType: text(formData, "requestType"),
    existingSampleId: text(formData, "existingSampleId"),
    ingredientIds: formData.getAll("ingredientIds").map(String).filter(Boolean),
    inciName: text(formData, "inciName"),
    physicalForm: text(formData, "physicalForm"),
    category: text(formData, "category"),
    source: text(formData, "source"),
    function: text(formData, "function"),
    projectName: text(formData, "projectName"),
    mainCharacteristic: text(formData, "mainCharacteristic"),
    application: text(formData, "application"),
    productFormat: text(formData, "productFormat"),
    dosageOfUse: text(formData, "dosageOfUse"),
    requiredQuantityG: text(formData, "requiredQuantityG"),
    referenceLink: text(formData, "referenceLink"),
    requiredDocuments: text(formData, "requiredDocuments"),
    supplierName: text(formData, "supplierName"),
    supplier1: text(formData, "supplier1"),
    supplier2: text(formData, "supplier2"),
    supplier3: text(formData, "supplier3"),
  });

  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error.issues) };
  const data = parsed.data;

  const existing = await prisma.sampleOrder.findUnique({
    where: { id: data.orderId },
    select: { id: true, status: true },
  });
  if (!existing) return { formError: "That request no longer exists." };

  // Checked against the stored status, not the page, which may have been open since
  // before someone else decided it.
  if (!canEditOrder(existing.status as OrderStatus)) {
    return {
      formError: isTerminal(existing.status as OrderStatus)
        ? "This request was rejected and can no longer be edited."
        : "This request has already been approved and is with Supply Chain.",
    };
  }

  const isNew = data.requestType === "NEW";

  let existingSampleId: string | null = null;
  if (needsExistingSample(data.requestType)) {
    const sample = await prisma.sample.findUnique({
      where: { id: data.existingSampleId ?? "" },
      select: { id: true },
    });
    if (!sample) return { fieldErrors: { existingSampleId: "That sample no longer exists." } };
    existingSampleId = sample.id;
  }

  const typedIds = await resolveTypedInci(data.inciName);
  const pickedIds = await existingIngredientIds(data.ingredientIds);
  const linkIds = [...new Set([...pickedIds, ...typedIds])];

  try {
    await prisma.$transaction(async (tx) => {
      // Links are replaced wholesale rather than diffed: the form posts the complete set,
      // so anything absent was deliberately unticked.
      await tx.sampleOrderIngredient.deleteMany({ where: { orderId: data.orderId } });
      await tx.sampleOrder.update({
        where: { id: data.orderId },
        data: {
          requestType: data.requestType,
          existingSampleId,
          inciName: null,
          physicalForm: data.physicalForm ?? null,
          category: data.category ?? null,
          source: data.source ?? null,
          function: data.function ?? null,
          projectName: data.projectName ?? null,
          mainCharacteristic: data.mainCharacteristic ?? null,
          application: data.application ?? null,
          productFormat: data.productFormat ?? null,
          dosageOfUse: data.dosageOfUse ?? null,
          requiredQuantityG: data.requiredQuantityG ?? null,
          referenceLink: data.referenceLink ?? null,
          requiredDocuments: data.requiredDocuments ?? null,
          supplierName: isNew ? null : (data.supplierName ?? null),
          supplier1: isNew ? (data.supplier1 ?? null) : null,
          supplier2: isNew ? (data.supplier2 ?? null) : null,
          supplier3: isNew ? (data.supplier3 ?? null) : null,
          ingredients: { create: linkIds.map((id) => ({ ingredientId: id })) },
        },
      });
    });
  } catch (error) {
    console.error("updateSampleOrder failed", error);
    return { formError: "Could not save those changes. Try again." };
  }

  // Suppliers named during an edit join the list too, same as on submission.
  if (isNew) {
    await ensureSupplierNamed(data.supplier1);
    await ensureSupplierNamed(data.supplier2);
    await ensureSupplierNamed(data.supplier3);
  } else {
    await ensureSupplierNamed(data.supplierName);
  }

  revalidatePath("/orders");
  revalidatePath(`/orders/${data.orderId}`);
  redirect(`/orders/${data.orderId}?saved=1`);
}
