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
