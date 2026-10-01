"use server";

import { revalidatePath } from "next/cache";
import { verifySession } from "@/lib/dal";
import { prisma } from "@/lib/prisma";
import {
  canDecidePieceRequest,
  canRequestPiece,
  checkCancellable,
  checkDecidable,
  pieceUnavailableReason,
} from "@/lib/piece-requests";

// Asking for a piece, and answering. Every one of these re-checks the role and the stored
// state on the server: the piece list hides what it can't offer, but hiding a button is not
// a rule (AC B4).

export type PieceRequestState = { error?: string; ok?: string } | undefined;

/** AC A1 — a Formulator picks a piece and asks for it. */
export async function requestPiece(
  _prev: PieceRequestState,
  formData: FormData
): Promise<PieceRequestState> {
  const session = await verifySession();
  if (!canRequestPiece(session.user.role)) {
    return { error: "Only a Formulator raises a request for a piece." };
  }

  const pieceId = String(formData.get("pieceId") ?? "");
  if (!pieceId) return { error: "Which piece?" };

  const piece = await prisma.samplePiece.findUnique({
    where: { id: pieceId },
    select: {
      id: true,
      pieceIndex: true,
      status: true,
      sampleId: true,
      sample: { select: { sampleCode: true, isDiscarded: true } },
      checkedOutToUser: { select: { name: true } },
      requests: {
        where: { status: "PENDING" },
        select: { id: true, requestedBy: { select: { name: true } } },
      },
    },
  });
  if (!piece) return { error: "That piece no longer exists." };
  if (piece.sample.isDiscarded) {
    return { error: `${piece.sample.sampleCode} is discarded.` };
  }

  // Re-checked against the stored rows: the page may have been open since before someone
  // else asked for this piece, or since an Admin handed it to them.
  const unavailable = pieceUnavailableReason({
    status: piece.status,
    checkedOutToName: piece.checkedOutToUser?.name ?? null,
    pendingRequestByName: piece.requests[0]?.requestedBy.name ?? null,
  });
  if (unavailable) {
    return { error: `Piece #${piece.pieceIndex} isn't available — ${unavailable.toLowerCase()}.` };
  }

  const purpose = String(formData.get("purpose") ?? "").trim();

  try {
    await prisma.sampleRequest.create({
      data: {
        sampleId: piece.sampleId,
        pieceId: piece.id,
        requestedById: session.user.id,
        purpose: purpose || null,
        status: "PENDING",
      },
    });
  } catch (error) {
    console.error("requestPiece failed", error);
    return { error: "Could not raise that request. Try again." };
  }

  revalidatePath(`/library/${piece.sampleId}`);
  revalidatePath("/requests");
  revalidatePath("/dashboard");
  return { ok: `Asked for piece #${piece.pieceIndex}. An Admin will hand it over.` };
}

/** AC A3 — the requester changes their mind, and the piece is free again. */
export async function cancelPieceRequest(
  _prev: PieceRequestState,
  formData: FormData
): Promise<PieceRequestState> {
  const session = await verifySession();

  const requestId = String(formData.get("requestId") ?? "");
  if (!requestId) return { error: "Which request?" };

  const request = await prisma.sampleRequest.findUnique({
    where: { id: requestId },
    select: { id: true, status: true, requestedById: true, sampleId: true },
  });
  if (!request) return { error: "That request no longer exists." };

  const allowed = checkCancellable(request, { id: session.user.id });
  if (!allowed.ok) return { error: allowed.reason };

  try {
    // Nothing to undo on the piece: a pending request never moved it. Availability is
    // computed from "is there a pending request", so closing this one frees it.
    await prisma.sampleRequest.update({
      where: { id: requestId },
      data: { status: "CANCELLED", decidedAt: new Date(), decidedById: session.user.id },
    });
  } catch (error) {
    console.error("cancelPieceRequest failed", error);
    return { error: "Could not cancel that request. Try again." };
  }

  revalidatePath(`/library/${request.sampleId}`);
  revalidatePath("/requests");
  revalidatePath("/dashboard");
  return { ok: "Request cancelled. The piece is available again." };
}

/** AC B2 — the Admin hands the piece over, and SLT records who holds it. */
export async function givePiece(
  _prev: PieceRequestState,
  formData: FormData
): Promise<PieceRequestState> {
  const session = await verifySession();
  if (!canDecidePieceRequest(session.user.role)) {
    return { error: "Only an Admin can hand a piece over." };
  }

  const requestId = String(formData.get("requestId") ?? "");
  if (!requestId) return { error: "Which request?" };

  const request = await prisma.sampleRequest.findUnique({
    where: { id: requestId },
    select: {
      id: true,
      status: true,
      requestedById: true,
      sampleId: true,
      requestedBy: { select: { name: true } },
      piece: {
        select: { id: true, pieceIndex: true, status: true, checkedOutToUser: { select: { name: true } } },
      },
    },
  });
  if (!request) return { error: "That request no longer exists." };

  const decidable = checkDecidable(request);
  if (!decidable.ok) return { error: decidable.reason };
  if (!request.piece) return { error: "This request names no piece, so there is nothing to give." };

  // The piece has to still be on the shelf. Between the request and now an Admin may have
  // checked it out to somebody else directly, and handing it over twice would overwrite who
  // actually has it.
  if (request.piece.status !== "IN_STOCK") {
    const holder = request.piece.checkedOutToUser?.name;
    return {
      error: holder
        ? `Piece #${request.piece.pieceIndex} is already with ${holder}.`
        : `Piece #${request.piece.pieceIndex} is no longer on the shelf.`,
    };
  }

  const now = new Date();
  try {
    await prisma.$transaction(async (tx) => {
      // The same state a direct checkout produces, so nothing downstream has to learn a
      // new one: computed stock, the overdue bell and the Checked Out page all read this.
      await tx.samplePiece.update({
        where: { id: request.piece!.id },
        data: {
          status: "CHECKED_OUT",
          checkedOutToUserId: request.requestedById,
          checkedOutAt: now,
        },
      });
      await tx.sampleRequest.update({
        where: { id: requestId },
        data: { status: "GIVEN", decidedAt: now, decidedById: session.user.id },
      });
      // A handover is a stock movement, so the sample's history shows it.
      await tx.transaction.create({
        data: {
          sampleId: request.sampleId,
          pieceId: request.piece!.id,
          requestId,
          type: "CHECKOUT",
          performedById: session.user.id,
          note: `Piece #${request.piece!.pieceIndex} given to ${request.requestedBy.name} against their request`,
        },
      });
    });
  } catch (error) {
    console.error("givePiece failed", error);
    return { error: "Could not record that handover. Try again." };
  }

  revalidatePath(`/library/${request.sampleId}`);
  revalidatePath("/requests");
  revalidatePath("/library");
  revalidatePath("/dashboard");
  return {
    ok: `Piece #${request.piece.pieceIndex} given to ${request.requestedBy.name}.`,
  };
}

/** AC B3 — the Admin says no, with a reason the formulator will read. */
export async function rejectPieceRequest(
  _prev: PieceRequestState,
  formData: FormData
): Promise<PieceRequestState> {
  const session = await verifySession();
  if (!canDecidePieceRequest(session.user.role)) {
    return { error: "Only an Admin can reject a request for a piece." };
  }

  const requestId = String(formData.get("requestId") ?? "");
  if (!requestId) return { error: "Which request?" };

  // Required. "No" with no reason leaves the formulator to ask again for the same piece.
  const reason = String(formData.get("rejectionReason") ?? "").trim();
  if (!reason) return { error: "Give a reason so the formulator knows why." };

  const request = await prisma.sampleRequest.findUnique({
    where: { id: requestId },
    select: { id: true, status: true, sampleId: true },
  });
  if (!request) return { error: "That request no longer exists." };

  const decidable = checkDecidable(request);
  if (!decidable.ok) return { error: decidable.reason };

  try {
    // The piece was never moved, so rejecting only closes the request — which is what makes
    // the piece available again.
    await prisma.sampleRequest.update({
      where: { id: requestId },
      data: {
        status: "REJECTED",
        rejectionReason: reason,
        decidedAt: new Date(),
        decidedById: session.user.id,
      },
    });
  } catch (error) {
    console.error("rejectPieceRequest failed", error);
    return { error: "Could not record that. Try again." };
  }

  revalidatePath(`/library/${request.sampleId}`);
  revalidatePath("/requests");
  revalidatePath("/dashboard");
  return { ok: "Request rejected. The formulator will see your reason." };
}
