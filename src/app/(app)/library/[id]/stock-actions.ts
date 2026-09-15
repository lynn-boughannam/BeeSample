"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/dal";
import { prisma } from "@/lib/prisma";
import {
  AddReceivedStockSchema,
  CheckoutPieceSchema,
  DiscardPiecesSchema,
  LogPieceUsageSchema,
} from "@/lib/validation";
import { centsToGrams, toCents } from "@/lib/pieces";

export type StockActionState =
  | { fieldErrors?: Record<string, string>; formError?: string; ok?: string }
  | undefined;

function fieldErrorsFrom(error: { issues: { path: PropertyKey[]; message: string }[] }) {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) {
    const field = String(issue.path[0] ?? "form");
    fieldErrors[field] ??= issue.message;
  }
  return fieldErrors;
}

// Turns the form's yyyy-mm-dd into the timestamp to store, or null if the date is in the
// future — which would make the piece look checked out before it happened and read as
// negative days on every overdue warning.
function resolveCheckoutDate(input: string | null): Date | null {
  const now = new Date();
  if (!input) return now;

  const [y, m, d] = input.split("-").map(Number);
  // Constructed field-by-field rather than via Date.parse, which reads a bare yyyy-mm-dd
  // as UTC and can land on the previous day once the server's offset is applied.
  const picked = new Date(y, m - 1, d);

  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (picked.getTime() > startOfToday.getTime()) return null;
  return picked.getTime() === startOfToday.getTime() ? now : picked;
}

// SLT-56. Checkout is a custody record and nothing else: the piece keeps its weight and
// keeps counting toward the sample's stock until usage is actually logged against it.
export async function checkoutPiece(
  _prev: StockActionState,
  formData: FormData
): Promise<StockActionState> {
  const session = await requireAdmin();

  const parsed = CheckoutPieceSchema.safeParse({
    pieceId: formData.get("pieceId"),
    formulatorId: formData.get("formulatorId"),
    checkedOutAt: formData.get("checkedOutAt"),
  });
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };

  const { pieceId, formulatorId } = parsed.data;

  // A date-only input can't say "now", so today keeps the real timestamp — that's what
  // orders same-day checkouts correctly in "Who has what". Any earlier date is stored at
  // local midnight: the piece has been out "since that day".
  const checkedOutAt = resolveCheckoutDate(parsed.data.checkedOutAt);
  if (!checkedOutAt) {
    return { fieldErrors: { checkedOutAt: "A checkout can't be dated in the future." } };
  }

  const piece = await prisma.samplePiece.findUnique({
    where: { id: pieceId },
    include: { sample: { select: { id: true, isDiscarded: true } } },
  });
  if (!piece) return { formError: "That piece no longer exists." };
  if (piece.sample.isDiscarded) {
    return { formError: "This sample has been discarded, so its pieces can't be checked out." };
  }

  // Only an in-stock piece can go out. Re-checked here rather than trusted from the form,
  // which could be stale if someone else moved the piece in the meantime.
  if (piece.status !== "IN_STOCK") {
    return { formError: `Piece #${piece.pieceIndex} isn't in stock, so it can't be checked out.` };
  }

  const formulator = await prisma.user.findFirst({
    where: { id: formulatorId, isActive: true, role: { name: "FORMULATOR" } },
    select: { id: true, name: true },
  });
  if (!formulator) {
    return {
      fieldErrors: { formulatorId: "That formulator is no longer available. Reselect one." },
    };
  }

  try {
    // The custody change and its history entry commit together or not at all.
    await prisma.$transaction(async (tx) => {
      await tx.samplePiece.update({
        where: { id: piece.id },
        data: {
          status: "CHECKED_OUT",
          checkedOutToUserId: formulator.id,
          checkedOutAt,
        },
      });

      await tx.transaction.create({
        data: {
          sampleId: piece.sampleId,
          type: "CHECKOUT",
          // Nothing has been consumed yet — that's what RETURN_USAGE records.
          quantityG: null,
          performedById: session.user.id,
          subjectUserId: formulator.id,
          pieceId: piece.id,
          note: `Piece #${piece.pieceIndex} checked out to ${formulator.name}`,
        },
      });
    });
  } catch (error) {
    // Logged, not swallowed: the user-facing copy is deliberately vague, but the cause
    // has to reach the server output or a failure here is undiagnosable.
    console.error("checkoutPiece failed", error);
    return { formError: "Could not check out that piece. Try again." };
  }

  revalidatePath(`/library/${piece.sampleId}`);
  revalidatePath("/library");
  return { ok: `Piece #${piece.pieceIndex} checked out to ${formulator.name}.` };
}

// SLT-29. The only action that reduces a sample's stock. Admin-entered after physically
// checking the piece — the formulator doesn't report anything.
export async function logPieceUsage(
  _prev: StockActionState,
  formData: FormData
): Promise<StockActionState> {
  const session = await requireAdmin();

  const parsed = LogPieceUsageSchema.safeParse({
    pieceId: formData.get("pieceId"),
    amountUsedG: formData.get("amountUsedG"),
  });
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };

  const { pieceId, amountUsedG } = parsed.data;

  const piece = await prisma.samplePiece.findUnique({
    where: { id: pieceId },
    include: { checkedOutToUser: { select: { name: true } } },
  });
  if (!piece) return { formError: "That piece no longer exists." };
  if (piece.status !== "CHECKED_OUT") {
    return { formError: `Piece #${piece.pieceIndex} isn't checked out, so there's no usage to log.` };
  }

  // Weights are compared and subtracted as integer hundredths of a gram, so "used exactly
  // all of it" is an exact test rather than a float tolerance — 3.00 - 3.00 is 0 here, not
  // 4.44e-16 (same reason src/lib/pieces.ts splits a receipt in cents).
  const remainingCents = toCents(Number(piece.remainingWeightG));
  const usedCents = toCents(amountUsedG);

  if (usedCents > remainingCents) {
    return {
      fieldErrors: {
        amountUsedG: `Piece #${piece.pieceIndex} only has ${centsToGrams(remainingCents)} g left.`,
      },
    };
  }

  const leftCents = remainingCents - usedCents;
  // Nothing left means the piece is gone for good and stops counting as a piece at all;
  // anything left goes back on the shelf, lighter, and can be checked out again.
  const nextStatus = leftCents === 0 ? "DEPLETED" : "IN_STOCK";
  const heldBy = piece.checkedOutToUser?.name ?? "an unknown formulator";

  try {
    await prisma.$transaction(async (tx) => {
      await tx.samplePiece.update({
        where: { id: piece.id },
        data: {
          remainingWeightG: centsToGrams(leftCents),
          status: nextStatus,
          // Custody clears either way — the piece is back with the library.
          checkedOutToUserId: null,
          checkedOutAt: null,
        },
      });

      // Logged even when nothing was used: "returned untouched" is a real event and the
      // 0 g entry is what records it (SLT-29 AC).
      await tx.transaction.create({
        data: {
          sampleId: piece.sampleId,
          type: "RETURN_USAGE",
          quantityG: centsToGrams(usedCents),
          performedById: session.user.id,
          // Captured before custody is cleared above, so the piece's history keeps the
          // formulator it was actually with.
          subjectUserId: piece.checkedOutToUserId,
          pieceId: piece.id,
          note: `Piece #${piece.pieceIndex} returned by ${heldBy} — ${centsToGrams(usedCents)} g used, ${centsToGrams(leftCents)} g left`,
        },
      });
    });
  } catch (error) {
    console.error("logPieceUsage failed", error);
    return { formError: "Could not log that usage. Try again." };
  }

  revalidatePath(`/library/${piece.sampleId}`);
  revalidatePath("/library");
  return {
    ok: `Logged ${centsToGrams(usedCents)} g used on piece #${piece.pieceIndex}.`,
  };
}

// SLT-25. A restock arrives as physical material, so it has to become a physical piece:
// remaining stock is computed from pieces (SLT-29), and adding to a stored total would
// move nothing. One restock becomes one new piece carrying the whole amount — the form
// takes a single weight, with no piece count to split it by.
export async function addReceivedStock(
  _prev: StockActionState,
  formData: FormData
): Promise<StockActionState> {
  const session = await requireAdmin();

  const parsed = AddReceivedStockSchema.safeParse({
    sampleId: formData.get("sampleId"),
    amountG: formData.get("amountG"),
  });
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };

  const { sampleId, amountG } = parsed.data;

  const sample = await prisma.sample.findUnique({
    where: { id: sampleId },
    select: {
      id: true,
      isDiscarded: true,
      totalQtyG: true,
      receivedQtyPcs: true,
      shelfLetter: true,
      shelfLevel: true,
      shelfSublevel: true,
    },
  });
  if (!sample) return { formError: "That sample no longer exists." };
  if (sample.isDiscarded) {
    return { formError: "This sample is discarded. Restore it before adding stock." };
  }

  const addedCents = toCents(amountG);
  const added = centsToGrams(addedCents);
  // Integer hundredths again, so a restock can't introduce float drift into the running
  // received total.
  const newTotal = centsToGrams(toCents(Number(sample.totalQtyG)) + addedCents);

  try {
    await prisma.$transaction(async (tx) => {
      // Pieces are numbered per sample, so the new one continues the sequence rather than
      // colliding with a depleted piece's index.
      const last = await tx.samplePiece.findFirst({
        where: { sampleId: sample.id },
        orderBy: { pieceIndex: "desc" },
        select: { pieceIndex: true },
      });

      const created = await tx.samplePiece.create({
        data: {
          sampleId: sample.id,
          pieceIndex: (last?.pieceIndex ?? 0) + 1,
          originalWeightG: added,
          remainingWeightG: added,
          status: "IN_STOCK",
        },
      });

      await tx.sample.update({
        where: { id: sample.id },
        data: {
          // totalQtyG is the ever-increasing record of everything ever received, and a
          // restock is exactly that. receivedQtyPcs is its piece-count counterpart, so it
          // moves with it — left stale, the library's Received (pcs) column would be wrong.
          totalQtyG: newTotal,
          receivedQtyPcs: sample.receivedQtyPcs != null ? sample.receivedQtyPcs + 1 : null,
          // This batch arrived today (SLT-25 AC-1).
          receptionDate: new Date(),
        },
      });

      await tx.locationHistory.create({
        data: {
          sampleId: sample.id,
          shelfLetter: sample.shelfLetter,
          shelfLevel: sample.shelfLevel,
          shelfSublevel: sample.shelfSublevel,
          movedAt: new Date(),
          movedById: session.user.id,
          note: `+${added}g received`,
        },
      });

      // Not named in SLT-25, but a receipt is a stock movement and the sample's
      // Transaction history would otherwise show consumption with no matching intake.
      await tx.transaction.create({
        data: {
          sampleId: sample.id,
          type: "RECEIPT",
          quantityG: added,
          performedById: session.user.id,
          pieceId: created.id,
          note: `Restock: +${added} g received as piece #${created.pieceIndex}`,
        },
      });
    });
  } catch (error) {
    console.error("addReceivedStock failed", error);
    return { formError: "Could not add that stock. Try again." };
  }

  revalidatePath(`/library/${sample.id}`);
  revalidatePath("/library");
  revalidatePath("/locations");
  return { ok: `Added ${added} g to stock.` };
}

// SLT-55. Discards one or more pieces that are no longer usable. Only IN_STOCK pieces
// qualify: a checked-out piece has to come back through logPieceUsage first, so a piece is
// never checked-out-and-discarded at once and its state transitions stay unambiguous.
//
// This does NOT flag the Sample itself. A sample whose pieces are all gone simply reads
// 0 g / 0 pcs, with every piece still visible in its history (decided 2026-09-14).
export async function discardPieces(
  _prev: StockActionState,
  formData: FormData
): Promise<StockActionState> {
  const session = await requireAdmin();

  const parsed = DiscardPiecesSchema.safeParse({
    sampleId: formData.get("sampleId"),
    pieceIds: formData.getAll("pieceIds").map(String),
    reason: formData.get("reason"),
  });
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };

  const { sampleId, pieceIds, reason } = parsed.data;

  const sample = await prisma.sample.findUnique({
    where: { id: sampleId },
    select: { id: true, isDiscarded: true },
  });
  if (!sample) return { formError: "That sample no longer exists." };
  if (sample.isDiscarded) {
    return { formError: "This sample is discarded, so its pieces can't be discarded individually." };
  }

  const pieces = await prisma.samplePiece.findMany({
    where: { id: { in: pieceIds }, sampleId },
    select: { id: true, pieceIndex: true, status: true, remainingWeightG: true },
    orderBy: { pieceIndex: "asc" },
  });

  // Re-checked against the rows rather than trusted from the form: the list the Admin saw
  // could be stale if someone else moved a piece in the meantime.
  if (pieces.length !== pieceIds.length) {
    return { formError: "Some selected pieces no longer exist. Reload and try again." };
  }
  const notInStock = pieces.filter((p) => p.status !== "IN_STOCK");
  if (notInStock.length > 0) {
    const names = notInStock.map((p) => `#${p.pieceIndex}`).join(", ");
    return {
      formError: `Piece ${names} isn't in stock, so it can't be discarded. Log its usage first.`,
    };
  }

  const discardedAt = new Date();

  try {
    await prisma.$transaction(async (tx) => {
      await tx.samplePiece.updateMany({
        where: { id: { in: pieces.map((p) => p.id) } },
        data: {
          status: "DISCARDED",
          discardReason: reason,
          discardedAt,
          discardedById: session.user.id,
        },
      });

      // One entry per piece, so the log says exactly what left the shelf and why.
      for (const piece of pieces) {
        await tx.transaction.create({
          data: {
            sampleId,
            type: "DISCARD",
            quantityG: centsToGrams(toCents(Number(piece.remainingWeightG))),
            performedById: session.user.id,
            pieceId: piece.id,
            note: `Piece #${piece.pieceIndex} discarded — ${reason}`,
          },
        });
      }
    });
  } catch (error) {
    console.error("discardPieces failed", error);
    return { formError: "Could not discard those pieces. Try again." };
  }

  revalidatePath(`/library/${sampleId}`);
  revalidatePath("/library");
  revalidatePath("/locations");
  const count = pieces.length;
  return { ok: `Discarded ${count} piece${count === 1 ? "" : "s"}.` };
}
