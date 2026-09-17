"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { verifySession } from "@/lib/dal";
import { prisma } from "@/lib/prisma";
import { CreateSampleOrderSchema } from "@/lib/validation";
import { needsExistingSample, needsShortSupplierListConfirmation } from "@/lib/orders";
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

  // Only ids that actually exist are linked: a stale form could name an ingredient
  // someone deleted while the request was being filled in.
  const ingredientIds =
    data.ingredientIds.length > 0
      ? (
          await prisma.ingredientListEntry.findMany({
            where: { id: { in: data.ingredientIds } },
            select: { id: true },
          })
        ).map((i) => i.id)
      : [];

  // INCI typed into "Other INCI not in the list" becomes a real record, so the request
  // links to something rather than restating a name as text. A stub carries only the name,
  // which is exactly what isIncomplete() flags (SLT-18) — it lands in the Ingredient List
  // already marked as needing its safety data, rather than looking finished.
  //
  // Names are matched against the list first: the database collation is case-insensitive,
  // so "limonene" finds "Limonene" and no duplicate is made.
  const typedNames = (data.inciName ?? "")
    .split(",")
    .map((n) => n.trim())
    .filter(Boolean);

  const typedIds: string[] = [];
  for (const name of typedNames) {
    const existing = await prisma.ingredientListEntry.findFirst({
      where: { inciName: name },
      select: { id: true },
    });
    if (existing) {
      typedIds.push(existing.id);
      continue;
    }
    try {
      const created = await prisma.ingredientListEntry.create({
        data: { uid: await nextIngredientCode(), inciName: name },
        select: { id: true },
      });
      typedIds.push(created.id);
    } catch (error) {
      console.error("createSampleOrder: could not add INCI to the list", name, error);
      return {
        fieldErrors: { inciName: `Could not add "${name}" to the ingredient list. Try again.` },
      };
    }
  }

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

  revalidatePath("/orders");
  revalidatePath("/dashboard");
  redirect("/orders?submitted=1");
}
