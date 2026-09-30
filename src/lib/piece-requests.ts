// A formulator asks for a specific piece; an Admin hands it over or says no.
//
// Pure rules, no prisma — the piece list on a sample page is a client component and needs
// to know which pieces it may offer.
//
// Giving a piece is the same act the Admin could already perform directly (checkoutPiece):
// the piece becomes CHECKED_OUT and held by that formulator. Nothing downstream is taught a
// new state, so computed stock, the overdue-checkout warnings and the Checked Out page keep
// working unchanged. What this adds is the asking.

export const PIECE_REQUEST_STATUSES = ["PENDING", "GIVEN", "REJECTED", "CANCELLED"] as const;
export type PieceRequestStatus = (typeof PIECE_REQUEST_STATUSES)[number];

export const PIECE_REQUEST_STATUS_LABELS: Record<PieceRequestStatus, string> = {
  PENDING: "Pending",
  GIVEN: "Given",
  REJECTED: "Rejected",
  CANCELLED: "Cancelled",
};

/** Only a pending request is waiting on anyone. The other three are over. */
export function isPieceRequestOpen(status: string): boolean {
  return status === "PENDING";
}

/**
 * Why a piece can't be asked for, or null if it can.
 *
 * Two separate reasons, and the message says which: the piece is already out with someone,
 * or somebody else got their request in first. Returning the reason rather than a bare
 * false is what lets the list say "requested by Mohammad" instead of greying a row out with
 * no explanation (AC A2).
 */
export function pieceUnavailableReason(piece: {
  status: string;
  checkedOutToName?: string | null;
  pendingRequestByName?: string | null;
}): string | null {
  if (piece.status === "CHECKED_OUT") {
    return piece.checkedOutToName
      ? `With ${piece.checkedOutToName}`
      : "Already checked out";
  }
  if (piece.status === "DEPLETED") return "Nothing left of it";
  if (piece.status === "DISCARDED") return "Discarded";
  if (piece.status !== "IN_STOCK") return "Not available";
  if (piece.pendingRequestByName) {
    return `Requested by ${piece.pendingRequestByName}`;
  }
  return null;
}

export function pieceIsRequestable(piece: {
  status: string;
  checkedOutToName?: string | null;
  pendingRequestByName?: string | null;
}): boolean {
  return pieceUnavailableReason(piece) === null;
}

/**
 * Deciding a request is the Admin's: they are the ones physically handing the jar over.
 *
 * A Formulator reaching the action another way is refused here, on the server, not merely
 * shown no button (AC B4).
 */
export function canDecidePieceRequest(role: string): boolean {
  return role === "ADMIN";
}

/** Asking is the Formulator's. An Admin hands pieces out directly and needs no request. */
export function canRequestPiece(role: string): boolean {
  return role === "FORMULATOR";
}

/**
 * Whether this request can still be answered, and if not, why.
 *
 * Answered once. Two Admins with the page open would otherwise both hand over the same
 * piece, and the second would quietly overwrite who holds it.
 */
export function checkDecidable(request: {
  status: string;
}): { ok: true } | { ok: false; reason: string } {
  if (isPieceRequestOpen(request.status)) return { ok: true };
  const label = PIECE_REQUEST_STATUS_LABELS[request.status as PieceRequestStatus];
  return {
    ok: false,
    reason: label
      ? `This request was already ${label.toLowerCase()}.`
      : "This request is no longer pending.",
  };
}

/**
 * Whether the person asking may cancel this request.
 *
 * Only whoever raised it, and only while it is still pending — cancelling something already
 * given would say the piece is free while it sits on someone's bench.
 */
export function checkCancellable(
  request: { status: string; requestedById: string },
  user: { id: string }
): { ok: true } | { ok: false; reason: string } {
  if (request.requestedById !== user.id) {
    return { ok: false, reason: "Only the person who asked for this piece can cancel it." };
  }
  if (!isPieceRequestOpen(request.status)) {
    const label = PIECE_REQUEST_STATUS_LABELS[request.status as PieceRequestStatus];
    return {
      ok: false,
      reason: label
        ? `This request was already ${label.toLowerCase()}.`
        : "This request is no longer pending.",
    };
  }
  return { ok: true };
}

export const PIECE_REQUEST_STATUS_VARIANT: Record<
  PieceRequestStatus,
  "info" | "success" | "danger" | "neutral"
> = {
  PENDING: "info",
  GIVEN: "success",
  REJECTED: "danger",
  CANCELLED: "neutral",
};
