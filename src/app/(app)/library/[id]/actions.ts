"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/dal";
import { prisma } from "@/lib/prisma";
import { DiscardSampleSchema, UpdateSampleSchema } from "@/lib/validation";
import { assignSublevel, shelfAddress } from "@/lib/categories";
import { cellOccupancyAt } from "@/lib/shelf";

export type SampleActionState =
  | { fieldErrors?: Record<string, string>; formError?: string }
  | undefined;

export async function updateSample(
  _prev: SampleActionState,
  formData: FormData
): Promise<SampleActionState> {
  const session = await requireAdmin();

  const parsed = UpdateSampleSchema.safeParse({
    id: formData.get("id"),
    sampleCode: formData.get("sampleCode"),
    rmName: formData.get("rmName"),
    category: formData.get("category"),
    fragranceOrientation: formData.get("fragranceOrientation"),
    function: formData.get("function"),
    physicalForm: formData.get("physicalForm"),
    source: formData.get("source"),
    supplier: formData.get("supplier"),
    projectName: formData.get("projectName"),
    hazardClass: formData.get("hazardClass"),
    expiryDate: formData.get("expiryDate"),
    receptionDate: formData.get("receptionDate"),
    receivedQtyG: formData.get("receivedQtyG"),
    receivedQtyPcs: formData.get("receivedQtyPcs"),
    netWeightG: formData.get("netWeightG"),
    batchLot: formData.get("batchLot"),
    documentAvailability: formData.get("documentAvailability"),
    ingredientIds: formData.getAll("ingredientIds"),
    shelfLetter: formData.get("shelfLetter"),
    shelfLevel: formData.get("shelfLevel"),
    shelfSublevel: formData.get("shelfSublevel"),
  });

  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const field = String(issue.path[0] ?? "form");
      fieldErrors[field] ??= issue.message;
    }
    return { fieldErrors };
  }

  const data = parsed.data;

  const existing = await prisma.sample.findUnique({ where: { id: data.id } });
  if (!existing) return { formError: "That sample no longer exists." };
  if (existing.isDiscarded) {
    return { formError: "This sample has been discarded and can no longer be edited." };
  }

  const foundIngredients = await prisma.ingredientListEntry.count({
    where: { id: { in: data.ingredientIds } },
  });
  if (foundIngredients !== data.ingredientIds.length) {
    return {
      fieldErrors: {
        ingredientIds: "One or more selected ingredients no longer exist. Reselect and try again.",
      },
    };
  }

  // Current stock is computed from the pieces (SLT-29), so correcting the received total
  // no longer has to be reconciled against a stored remaining figure — totalQtyG is a
  // historical record and moves on its own.

  // The code is Admin-entered now, so an edit can collide with another sample.
  if (data.sampleCode !== existing.sampleCode) {
    const codeTaken = await prisma.sample.findUnique({
      where: { sampleCode: data.sampleCode },
      select: { id: true },
    });
    if (codeTaken) {
      return { fieldErrors: { sampleCode: `Sample code "${data.sampleCode}" is already in use.` } };
    }
  }

  // The Orientation dropdown stays populated if the Admin picks Fragrance and then moves
  // to another Category, so null it here rather than storing a fragrance trait on a wax.
  const fragranceOrientation =
    data.category === "Fragrance" ? data.fragranceOrientation : null;

  // Same sublevel rule as creation (SLT-19) — None unless the cell already holds another
  // sample — minus this sample itself, since it never collides with where it already is
  // and re-saving an unrelated field must not move it.
  const occupancy = await cellOccupancyAt(data.shelfLetter, data.shelfLevel, data.id);
  const cell = shelfAddress(data.shelfLetter, data.shelfLevel);
  let shelfSublevel = data.shelfSublevel;

  if (shelfSublevel === null) {
    // None is the default and stays None while the sample is the only one in the cell.
    // A letter is taken only once something else is already there, so two samples can't
    // end up at the same address.
    const assigned = assignSublevel(occupancy);
    if (assigned.kind === "full") {
      return {
        fieldErrors: {
          shelfSublevel: `${cell} is full — it holds a sample plus sublevels a–e. Choose another level or row.`,
        },
      };
    }
    shelfSublevel = assigned.kind === "letter" ? assigned.sublevel : null;
  } else if (occupancy.sublevels.includes(shelfSublevel)) {
    return {
      fieldErrors: {
        shelfSublevel: `${cell}${shelfSublevel} is already taken. Leave this on None to be given the next free sublevel.`,
      },
    };
  }

  const shelfChanged =
    existing.shelfLetter !== data.shelfLetter ||
    existing.shelfLevel !== data.shelfLevel ||
    (existing.shelfSublevel ?? null) !== shelfSublevel;

  try {
    await prisma.$transaction(async (tx) => {
      await tx.sample.update({
        where: { id: data.id },
        data: {
          sampleCode: data.sampleCode,
          rmName: data.rmName,
          category: data.category,
          fragranceOrientation,
          function: data.function,
          physicalForm: data.physicalForm,
          source: data.source,
          supplier: data.supplier,
          projectName: data.projectName,
          hazardClass: data.hazardClass,
          batchLot: data.batchLot,
          documentAvailability: data.documentAvailability,
          expiryDate: data.expiryDate,
          receptionDate: data.receptionDate,
          totalQtyG: data.receivedQtyG,
          receivedQtyPcs: data.receivedQtyPcs,
          netWeightG: data.netWeightG,
          shelfLetter: data.shelfLetter,
          shelfLevel: data.shelfLevel,
          shelfSublevel,
        },
      });

      // Simplest correct way to reconcile the checklist: clear the join rows and rewrite
      // them from what was submitted.
      await tx.sampleIngredient.deleteMany({ where: { sampleId: data.id } });
      await tx.sampleIngredient.createMany({
        data: data.ingredientIds.map((ingredientId) => ({ sampleId: data.id, ingredientId })),
      });

      // A location correction is still a location change, so it gets its own history row
      // rather than silently rewriting where the sample has been.
      if (shelfChanged) {
        await tx.locationHistory.create({
          data: {
            sampleId: data.id,
            shelfLetter: data.shelfLetter,
            shelfLevel: data.shelfLevel,
            shelfSublevel,
            movedAt: new Date(),
            movedById: session.user.id,
            note: "Location corrected via sample edit",
          },
        });
      }
    });
  } catch {
    return { formError: "Could not save the changes. Try again." };
  }

  revalidatePath("/library");
  revalidatePath(`/library/${data.id}`);
  redirect(`/library/${data.id}`);
}

// Soft delete: the sample leaves the library but its transactions, feedback and location
// history stay intact and attributable.
export async function discardSample(
  _prev: SampleActionState,
  formData: FormData
): Promise<SampleActionState> {
  const session = await requireAdmin();

  const parsed = DiscardSampleSchema.safeParse({
    id: formData.get("id"),
    reason: formData.get("reason"),
  });
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      fieldErrors[String(issue.path[0] ?? "form")] ??= issue.message;
    }
    return { fieldErrors };
  }

  try {
    await prisma.sample.update({
      where: { id: parsed.data.id },
      data: {
        isDiscarded: true,
        discardReason: parsed.data.reason,
        discardedAt: new Date(),
        discardedById: session.user.id,
      },
    });
  } catch {
    return { formError: "Could not discard the sample. Try again." };
  }

  revalidatePath("/library");
  revalidatePath(`/library/${parsed.data.id}`);
  redirect(`/library/${parsed.data.id}`);
}

export async function restoreSample(id: string): Promise<void> {
  await requireAdmin();
  await prisma.sample.update({
    where: { id },
    data: { isDiscarded: false, discardReason: null, discardedAt: null, discardedById: null },
  });
  revalidatePath("/library");
  revalidatePath(`/library/${id}`);
}

// Permanent delete, for genuine data-entry mistakes. Only allowed while nothing else
// references the sample: requests, feedback and transactions are audit records, and the
// FKs to Sample are NoAction, so the database would reject the delete anyway — this
// turns that into a clear message instead of a failed write.
export async function deleteSample(id: string): Promise<void> {
  await requireAdmin();

  const [requests, feedback, transactions, orders] = await Promise.all([
    prisma.sampleRequest.count({ where: { sampleId: id } }),
    prisma.feedback.count({ where: { sampleId: id } }),
    prisma.transaction.count({ where: { sampleId: id } }),
    prisma.sampleOrder.count({ where: { existingSampleId: id } }),
  ]);
  if (requests + feedback + transactions + orders > 0) return;

  // SampleIngredient and LocationHistory cascade from Sample, so they go with it.
  await prisma.sample.delete({ where: { id } });

  revalidatePath("/library");
  redirect("/library");
}
