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

// Stock flagging (SLT-26). Two states only: a sample either has stock or it doesn't.
// The amber "low stock" tier and its remaining/total percentage threshold were removed at
// the 2026-09-15 sprint review — a proportional warning told people less than the plain
// fact of whether anything is left.
export type StockLevel = "ZERO" | "HEALTHY";

export function stockLevel(stock: SampleStock): StockLevel {
  return toCents(Number(stock.remainingQtyG)) <= 0 ? "ZERO" : "HEALTHY";
}

// How overdue a checked-out piece is (SLT-57, shown by SLT-38 / SLT-40 / SLT-30).
// Computed from checkedOutAt on every read — nothing is stored, so no job has to keep a
// flag up to date and the state can never be stale.
//
// Defined once and imported by all three screens that show a since-date. Three copies of
// "10" and "14" would drift apart the first time the policy changed.
export const CHECKOUT_WARNING_DAYS = 10;
export const CHECKOUT_OVERDUE_DAYS = 14;

export type CheckoutWarningLevel = "NONE" | "WARNING" | "OVERDUE";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Whole days elapsed. `now` is injectable so the thresholds can be tested without waiting
// two weeks.
export function daysSinceCheckout(checkedOutAt: Date | null, now: Date = new Date()): number {
  if (!checkedOutAt) return 0;
  return Math.floor((now.getTime() - checkedOutAt.getTime()) / MS_PER_DAY);
}

export function getCheckoutWarningLevel(
  checkedOutAt: Date | null,
  now: Date = new Date()
): CheckoutWarningLevel {
  if (!checkedOutAt) return "NONE";
  const days = daysSinceCheckout(checkedOutAt, now);
  if (days >= CHECKOUT_OVERDUE_DAYS) return "OVERDUE";
  if (days >= CHECKOUT_WARNING_DAYS) return "WARNING";
  return "NONE";
}

// Shared presentation, so the same piece can't look amber on one screen and red on another.
export const CHECKOUT_WARNING_CLASS: Record<CheckoutWarningLevel, string> = {
  NONE: "text-neutral-dark/55",
  WARNING: "font-medium text-warning",
  OVERDUE: "font-semibold text-danger",
};

// Row-level treatment for a checked-out piece. The left border carries the signal even
// where a tint is hard to see, and the tints stay light enough for the row's own text to
// keep its contrast.
export const CHECKOUT_ROW_CLASS: Record<CheckoutWarningLevel, string> = {
  NONE: "",
  WARNING: "border-l-4 border-l-warning bg-warning/10",
  OVERDUE: "border-l-4 border-l-danger bg-danger/10",
};

export function checkoutWarningLabel(
  level: CheckoutWarningLevel,
  days: number
): string | null {
  if (level === "OVERDUE") return `${days} days out — overdue`;
  if (level === "WARNING") return `${days} days out`;
  return null;
}
