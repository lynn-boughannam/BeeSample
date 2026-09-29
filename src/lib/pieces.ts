export const PIECE_MODES = ["AUTO", "MANUAL"] as const;
export type PieceMode = (typeof PIECE_MODES)[number];

// Manual entry renders one input per piece, so a pathological count would lock up the
// browser. Auto-calculate has no such limit — it never renders a field per piece.
export const MANUAL_PIECE_LIMIT = 500;

// Weights are handled as integer hundredths of a gram everywhere in this module. The
// requirement is that piece weights sum *exactly* to the received total, and binary
// floating point can't hold that: 33.33 + 33.33 + 33.34 evaluates to 100.00000000000001.
export function toCents(grams: number): number {
  return Math.round(grams * 100);
}

export function centsToGrams(cents: number): string {
  return (cents / 100).toFixed(2);
}

/**
 * Splits `totalCents` across `pieces`, giving the rounding remainder to the LAST piece so
 * the parts always add back to exactly the total.
 *
 * 100g over 3 pieces → 33.33, 33.33, 33.34 — not 33.33 three times, which would lose a
 * cent and leave the sample's pieces short of its recorded total.
 */
export function distributeCents(totalCents: number, pieces: number): number[] {
  if (pieces < 1) return [];
  const base = Math.floor(totalCents / pieces);
  const remainder = totalCents - base * pieces;
  const split = new Array<number>(pieces).fill(base);
  split[pieces - 1] = base + remainder;
  return split;
}

// Shared by the form's live feedback and the server's hard validation so the two can't
// disagree about what "adds up" means.
export function sumCents(weights: number[]): number {
  return weights.reduce((total, w) => total + w, 0);
}

export function pieceSumMessage(sumInCents: number, expectedInCents: number): string {
  return `Piece weights sum to ${centsToGrams(sumInCents)}g, expected ${centsToGrams(expectedInCents)}g.`;
}

/**
 * How what arrived compares with what was asked for, when a sample is created by receiving
 * an order.
 *
 * A difference is a fact to be shown, never an error to be blocked on: suppliers ship what
 * they ship, and refusing to record 240 g because 250 g was requested would leave the
 * library not knowing about material that is physically on the shelf. So this reports, and
 * the screen shows a shortfall or an excess in red.
 *
 * Compared in cents for the same reason everything else here is — 0.1 + 0.2 is not 0.3, and
 * a match that reads as a 0.00 g difference would be worse than no comparison at all.
 */
export type QuantityComparison =
  | { kind: "UNKNOWN" }
  | { kind: "MATCH" }
  | { kind: "SHORT" | "OVER"; differenceG: string };

export function compareQuantities(
  requestedG: string | null | undefined,
  receivedG: string | null | undefined
): QuantityComparison {
  // Older requests were raised before a quantity was asked for, and a blank received box is
  // simply a form not filled in yet. Neither is a mismatch.
  const requested = Number(requestedG);
  const received = Number(receivedG);
  if (
    requestedG == null || String(requestedG).trim() === "" || !Number.isFinite(requested) ||
    receivedG == null || String(receivedG).trim() === "" || !Number.isFinite(received)
  ) {
    return { kind: "UNKNOWN" };
  }

  const diff = toCents(received) - toCents(requested);
  if (diff === 0) return { kind: "MATCH" };
  return { kind: diff < 0 ? "SHORT" : "OVER", differenceG: centsToGrams(Math.abs(diff)) };
}
