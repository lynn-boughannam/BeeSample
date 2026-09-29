import "server-only";

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { CreateSampleWithPiecesSchema } from "@/lib/validation";
import { centsToGrams, distributeCents, toCents } from "@/lib/pieces";
import { assignSublevel, shelfAddress } from "@/lib/categories";
import { cellOccupancyAt } from "@/lib/shelf";

/**
 * Everything that turns a filled-in sample form into a row: validation, the checks the
 * reference lists can't enforce, sublevel assignment, and the piece split.
 *
 * Shared because a sample can now be born two ways — entered directly by an Admin, or
 * created when an order is received — and they have to be the same sample afterwards. A
 * second implementation would drift, and the one that drifted would be the one nobody
 * looks at: the sample nobody typed.
 *
 * It stops short of writing. Direct entry commits the sample alone; reception commits it in
 * the same transaction as the order it came from. Same payload, different commit scope.
 */
export type PreparedSample =
  | { ok: true; data: Prisma.SampleUncheckedCreateInput }
  | { ok: false; fieldErrors?: Record<string, string>; formError?: string };

export async function prepareSampleCreate(
  formData: FormData,
  createdById: string
): Promise<PreparedSample> {
  const parsed = CreateSampleWithPiecesSchema.safeParse({
    pieceMode: formData.get("pieceMode"),
    pieceWeights: formData.getAll("pieceWeights"),
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
    // One message per field so the form can render each error against its own input,
    // rather than a single generic "invalid input" at the top (design.md).
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const field = String(issue.path[0] ?? "form");
      fieldErrors[field] ??= issue.message;
    }
    return { ok: false, fieldErrors };
  }

  const data = parsed.data;

  // Guard against a stale/tampered ingredient id list — the checklist is populated from
  // IngredientListEntry, so every submitted id must still resolve to a real row.
  const foundIngredients = await prisma.ingredientListEntry.count({
    where: { id: { in: data.ingredientIds } },
  });
  if (foundIngredients !== data.ingredientIds.length) {
    return {
      ok: false,
      fieldErrors: {
        ingredientIds: "One or more selected ingredients no longer exist. Reselect and try again.",
      },
    };
  }

  // Function / Physical Form / Supplier are stored as names rather than foreign keys, so
  // the reference lists can't enforce this for us — check each submitted value still
  // exists in case the list changed while the form was open.
  const [fnExists, pfExists, supExists] = await Promise.all([
    prisma.sampleFunction.findFirst({ where: { name: data.function }, select: { id: true } }),
    prisma.physicalForm.findFirst({ where: { name: data.physicalForm }, select: { id: true } }),
    prisma.supplier.findFirst({ where: { name: data.supplier }, select: { id: true } }),
  ]);

  const staleFieldErrors: Record<string, string> = {};
  if (!fnExists) staleFieldErrors.function = "That function is no longer in the list. Reselect it.";
  if (!pfExists) {
    staleFieldErrors.physicalForm = "That physical form is no longer in the list. Reselect it.";
  }
  if (!supExists) staleFieldErrors.supplier = "That supplier is no longer in the list. Reselect it.";
  if (Object.keys(staleFieldErrors).length > 0) {
    return { ok: false, fieldErrors: staleFieldErrors };
  }

  // Auto-generation is paused: the Admin supplies the code, so uniqueness has to be
  // checked here rather than guaranteed by the sequence.
  const codeTaken = await prisma.sample.findUnique({
    where: { sampleCode: data.sampleCode },
    select: { id: true },
  });
  if (codeTaken) {
    return {
      ok: false,
      fieldErrors: { sampleCode: `Sample code "${data.sampleCode}" is already in use.` },
    };
  }

  // The Orientation dropdown stays populated if the Admin picks Fragrance and then moves
  // to another Category, so null it here rather than storing a fragrance trait on a wax.
  const fragranceOrientation =
    data.category === "Fragrance" ? data.fragranceOrientation : null;

  // Sublevel defaults to None and is only a tie-breaker: a cell can hold several samples,
  // and the number is what keeps their addresses apart once it does (SLT-19). So the first
  // sample in H4 is stored as plain "H4", the second as "H4-1". An explicit choice is kept
  // but must still be free.
  //
  // There's no unique index behind this — samples created before SLT-19 have no sublevel
  // at all, and SQL Server treats those NULLs as equal, so the constraint couldn't be
  // added without rewriting existing rows first.
  const occupancy = await cellOccupancyAt(data.shelfLetter, data.shelfLevel);
  const cell = shelfAddress(data.shelfLetter, data.shelfLevel);
  let shelfSublevel = data.shelfSublevel;

  if (shelfSublevel === null) {
    // None is the default and stays None while the sample is the only one in the cell.
    // A number is taken only once something else is already there, so two samples can't
    // end up at the same address.
    const assigned = assignSublevel(occupancy);
    if (assigned.kind === "full") {
      return {
        ok: false,
        fieldErrors: {
          shelfSublevel: `${cell} is full — it holds a sample plus sublevels 1–5. Choose another level or row.`,
        },
      };
    }
    shelfSublevel = assigned.kind === "number" ? assigned.sublevel : null;
  } else if (occupancy.sublevels.includes(shelfSublevel)) {
    return {
      ok: false,
      fieldErrors: {
        shelfSublevel: `${cell}-${shelfSublevel} is already taken. Leave this on None to be given the next free sublevel.`,
      },
    };
  }

  // Auto mode is computed here rather than trusted from the form, so the stored pieces
  // always reconcile to the total. Manual weights already passed the exact-sum check in
  // the schema.
  const pieceCents =
    data.pieceMode === "AUTO"
      ? distributeCents(toCents(data.receivedQtyG), data.receivedQtyPcs)
      : data.pieceWeights.map(toCents);

  return {
    ok: true,
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
      createdById,
      ingredients: {
        create: data.ingredientIds.map((ingredientId) => ({ ingredientId })),
      },
      pieces: {
        // Decimal columns take the value as a string so it lands at exactly 2dp rather
        // than via a float that can't represent it.
        // A new piece is wholly intact and on the shelf: remaining starts equal to
        // original, and only logged usage moves it (SLT-29).
        create: pieceCents.map((cents, i) => ({
          pieceIndex: i + 1,
          originalWeightG: centsToGrams(cents),
          remainingWeightG: centsToGrams(cents),
          status: "IN_STOCK",
        })),
      },
      // movedAt tracks the Reception Date the Admin entered, not the save time — the
      // two can legitimately differ now that Reception Date is manually entered.
      locationHistory: {
        create: {
          shelfLetter: data.shelfLetter,
          shelfLevel: data.shelfLevel,
          shelfSublevel,
          movedAt: data.receptionDate,
          movedById: createdById,
          note: "Initial location on sample creation",
        },
      },
    },
  };
}
