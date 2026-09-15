// Deliberately free of any prisma import: the piece list on a sample page is a client
// component and imports the labels below, so pulling the database driver in here would
// drag it into the browser bundle. The queries live in stock-queries.ts.
import { toCents, centsToGrams } from "@/lib/pieces";

// SQL Server has no native enum, so piece status is a plain string column. This union is
// the source of truth for what's valid (same convention as src/lib/types.ts).
export const PIECE_STATUSES = ["IN_STOCK", "CHECKED_OUT", "DEPLETED", "DISCARDED"] as const;
export type PieceStatus = (typeof PIECE_STATUSES)[number];

// A piece counts toward the sample's current stock while it physically exists and still
// has weight — including while someone has it. Checkout is a custody record, not a
// deduction (SLT-56), so a CHECKED_OUT piece keeps counting until usage is logged
// against it. DEPLETED and DISCARDED pieces have left the stock entirely.
export const COUNTED_PIECE_STATUSES: readonly PieceStatus[] = ["IN_STOCK", "CHECKED_OUT"];

export const PIECE_STATUS_LABELS: Record<PieceStatus, string> = {
  IN_STOCK: "In Stock",
  CHECKED_OUT: "Checked Out",
  DEPLETED: "Depleted",
  DISCARDED: "Discarded",
};

// A sample's current stock. Both numbers are derived from its pieces on every read and
// are never stored, so there is no total that can drift out of step with the piece rows
// behind it (SLT-29).
export type SampleStock = {
  // Grams, as a fixed 2dp string — the same representation the Decimal columns use, so
  // it never picks up float noise on the way to the screen.
  remainingQtyG: string;
  remainingQtyPcs: number;
};

export const EMPTY_STOCK: SampleStock = { remainingQtyG: "0.00", remainingQtyPcs: 0 };

type CountedPiece = { remainingWeightG: unknown; status: string };

// Sums pieces already loaded in memory. Grams are added as integer hundredths because
// binary floating point can't hold a decimal sum exactly — the same reason src/lib/pieces.ts
// works in cents when splitting a receipt.
export function stockFromPieces(pieces: readonly CountedPiece[]): SampleStock {
  const counted = pieces.filter((p) =>
    COUNTED_PIECE_STATUSES.includes(p.status as PieceStatus)
  );

  const cents = counted.reduce((total, p) => total + toCents(Number(p.remainingWeightG)), 0);

  return { remainingQtyG: centsToGrams(cents), remainingQtyPcs: counted.length };
}

// Zero/low-stock thresholds (SLT-26). Kept here so the flags can only ever be derived
// from the computed stock above, never from a stored column.
export type StockLevel = "ZERO" | "LOW" | "HEALTHY";

export function stockLevel(stock: SampleStock, totalQtyG: unknown): StockLevel {
  const remaining = toCents(Number(stock.remainingQtyG));
  if (remaining <= 0) return "ZERO";

  const total = toCents(Number(totalQtyG));
  if (total > 0 && remaining * 100 <= total * 15) return "LOW";
  return "HEALTHY";
}
