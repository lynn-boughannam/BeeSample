"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/dal";
import { prisma } from "@/lib/prisma";
import { prepareSampleCreate } from "@/lib/sample-creation";
import {
  canReceiveOrder,
  checkReceiptReady,
  orderStatusAfterReceipt,
  receptionMode,
} from "@/lib/orders";
import { ReceiveIntoStockSchema } from "@/lib/validation";
import { centsToGrams, distributeCents, toCents } from "@/lib/pieces";

// Phase 9 — the material arrives and becomes a real sample.
//
// Not a status change with a sample tacked on: the order produces a Sample row with its own
// pieces and its own shelf slot, identical to one an Admin types in directly, because from
// here on nothing in the library cares where it came from. That identity is why this goes
// through prepareSampleCreate rather than writing its own create.

export type ReceiveState =
  | { fieldErrors?: Record<string, string>; formError?: string }
  | undefined;

export async function receiveOrder(
  _prev: ReceiveState,
  formData: FormData
): Promise<ReceiveState> {
  const session = await requireAdmin();
  if (!canReceiveOrder(session.user.role)) {
    return { formError: "Only an Admin can record a reception." };
  }

  const orderId = String(formData.get("orderId") ?? "");
  if (!orderId) return { formError: "Which request?" };

  const order = await prisma.sampleOrder.findUnique({
    where: { id: orderId },
    select: { id: true, status: true, producedSampleId: true },
  });
  if (!order) return { formError: "That request no longer exists." };

  // Re-checked against the stored row: the page may have been open since before someone
  // else received it, and receiving twice would put two samples on the shelf for one
  // delivery.
  const ready = checkReceiptReady(order);
  if (!ready.ok) return { formError: ready.reason };

  const prepared = await prepareSampleCreate(formData, session.user.id);
  if (!prepared.ok) {
    return { fieldErrors: prepared.fieldErrors, formError: prepared.formError };
  }

  let sampleId: string;
  try {
    sampleId = await prisma.$transaction(async (tx) => {
      const sample = await tx.sample.create({
        data: prepared.data,
        select: { id: true },
      });

      // The order is closed against the sample it produced in the same transaction. A
      // sample with no order pointing at it would look like direct entry; an order marked
      // received with no sample would be a delivery nobody can find.
      await tx.sampleOrder.update({
        where: { id: orderId },
        data: {
          status: orderStatusAfterReceipt(),
          receivedAt: prepared.data.receptionDate,
          receivedSampleCode: prepared.data.sampleCode,
          producedSampleId: sample.id,
        },
      });

      return sample.id;
    });
  } catch (error) {
    console.error("receiveOrder failed", error);
    return { formError: "Could not record that reception. Try again." };
  }

  revalidatePath("/library");
  revalidatePath("/orders");
  revalidatePath(`/orders/${orderId}`);
  revalidatePath("/dashboard");
  // Onto the sample itself: it is what the reception produced, and seeing its pieces and
  // shelf slot is how Rawan knows the delivery landed where she put it.
  redirect(`/library/${sampleId}`);
}

// A repeat order of the same material from the same supplier is more of what is already on
// the shelf, so it joins that sample's stock rather than creating a second library entry
// for one pile. Same piece rules as creation — auto-split or exact manual weights — because
// the pieces are just as real; there is simply nothing new to describe or place.
export async function receiveIntoExistingStock(
  _prev: ReceiveState,
  formData: FormData
): Promise<ReceiveState> {
  const session = await requireAdmin();
  if (!canReceiveOrder(session.user.role)) {
    return { formError: "Only an Admin can record a reception." };
  }

  const parsed = ReceiveIntoStockSchema.safeParse({
    orderId: formData.get("orderId"),
    receptionDate: formData.get("receptionDate"),
    receivedQtyG: formData.get("receivedQtyG"),
    receivedQtyPcs: formData.get("receivedQtyPcs"),
    pieceMode: formData.get("pieceMode"),
    pieceWeights: formData.getAll("pieceWeights"),
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

  const order = await prisma.sampleOrder.findUnique({
    where: { id: data.orderId },
    select: {
      id: true,
      status: true,
      requestType: true,
      existingSampleId: true,
      producedSampleId: true,
    },
  });
  if (!order) return { formError: "That request no longer exists." };

  const ready = checkReceiptReady(order);
  if (!ready.ok) return { formError: ready.reason };
  // Which way a reception goes is decided from the stored request, not from which form was
  // rendered — otherwise a stale page could restock a request that needs its own sample.
  if (receptionMode(order) !== "RESTOCK" || !order.existingSampleId) {
    return { formError: "This request needs a new sample rather than a restock." };
  }

  const sample = await prisma.sample.findUnique({
    where: { id: order.existingSampleId },
    select: {
      id: true,
      sampleCode: true,
      isDiscarded: true,
      totalQtyG: true,
      receivedQtyPcs: true,
      shelfLetter: true,
      shelfLevel: true,
      shelfSublevel: true,
    },
  });
  if (!sample) return { formError: "The sample this request restocks no longer exists." };
  if (sample.isDiscarded) {
    return {
      formError: `${sample.sampleCode} is discarded. Restore it before adding stock to it.`,
    };
  }

  // Auto is computed here rather than trusted from the form, so the stored pieces always
  // reconcile to the delivery. Manual weights already passed the exact-sum check.
  const pieceCents =
    data.pieceMode === "AUTO"
      ? distributeCents(toCents(data.receivedQtyG), data.receivedQtyPcs)
      : data.pieceWeights.map(toCents);

  const addedCents = pieceCents.reduce((sum, c) => sum + c, 0);
  // Integer hundredths, so a restock can't introduce float drift into the running total.
  const newTotal = centsToGrams(toCents(Number(sample.totalQtyG)) + addedCents);

  try {
    await prisma.$transaction(async (tx) => {
      // Pieces are numbered per sample, so these continue the sequence rather than
      // colliding with a depleted piece's index.
      const last = await tx.samplePiece.findFirst({
        where: { sampleId: sample.id },
        orderBy: { pieceIndex: "desc" },
        select: { pieceIndex: true },
      });
      let nextIndex = (last?.pieceIndex ?? 0) + 1;

      for (const cents of pieceCents) {
        const weight = centsToGrams(cents);
        const piece = await tx.samplePiece.create({
          data: {
            sampleId: sample.id,
            pieceIndex: nextIndex,
            originalWeightG: weight,
            remainingWeightG: weight,
            status: "IN_STOCK",
          },
        });
        // A receipt is a stock movement: without it the sample's history would show
        // consumption with no matching intake.
        await tx.transaction.create({
          data: {
            sampleId: sample.id,
            type: "RECEIPT",
            quantityG: weight,
            performedById: session.user.id,
            pieceId: piece.id,
            note: `Order receipt: +${weight} g received as piece #${nextIndex}`,
          },
        });
        nextIndex++;
      }

      await tx.sample.update({
        where: { id: sample.id },
        data: {
          // totalQtyG is the ever-increasing record of everything ever received, and
          // receivedQtyPcs its piece-count counterpart, so the two move together.
          totalQtyG: newTotal,
          receivedQtyPcs:
            sample.receivedQtyPcs != null
              ? sample.receivedQtyPcs + data.receivedQtyPcs
              : null,
          receptionDate: data.receptionDate,
        },
      });

      await tx.locationHistory.create({
        data: {
          sampleId: sample.id,
          shelfLetter: sample.shelfLetter,
          shelfLevel: sample.shelfLevel,
          shelfSublevel: sample.shelfSublevel,
          movedAt: data.receptionDate,
          movedById: session.user.id,
          note: `+${centsToGrams(addedCents)}g received against a repeat order`,
        },
      });

      // producedSampleId points at the sample the request put material into, which for a
      // restock is one several requests can share — the column is deliberately not unique.
      await tx.sampleOrder.update({
        where: { id: order.id },
        data: {
          status: orderStatusAfterReceipt(),
          receivedAt: data.receptionDate,
          receivedSampleCode: sample.sampleCode,
          producedSampleId: sample.id,
        },
      });
    });
  } catch (error) {
    console.error("receiveIntoExistingStock failed", error);
    return { formError: "Could not record that reception. Try again." };
  }

  revalidatePath("/library");
  revalidatePath(`/library/${sample.id}`);
  revalidatePath("/locations");
  revalidatePath("/orders");
  revalidatePath(`/orders/${order.id}`);
  revalidatePath("/dashboard");
  redirect(`/library/${sample.id}`);
}
