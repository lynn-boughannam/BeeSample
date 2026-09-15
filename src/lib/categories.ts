import type { ShelfClassification } from "@/lib/shelf";

// Category is the 8 real top-level values from the taxonomy. The 13 fragrance values
// that used to sit in this list are now Fragrance Orientation — they were always
// sub-values under "Fragrance" in the pixel-verified shelf plan, so Category +
// Orientation now map straight onto the seeded ShelfSlotConfig rows.
export const SAMPLE_CATEGORIES = [
  "Chemicals",
  "Wax",
  "Colorant",
  "Extract",
  "Oils",
  "Herbs",
  "Essential Oils",
  "Fragrance",
] as const;

export type SampleCategory = (typeof SAMPLE_CATEGORIES)[number];

export const FRAGRANCE_ORIENTATIONS = [
  "Woody",
  "Sweet",
  "Fruity",
  "Floral",
  "Refreshing",
  "Aquatic",
  "Men",
  "Spicy",
  "Oriental",
  "Herbal",
  "Citrus",
  "Nuts",
  "Powdery",
] as const;

export type FragranceOrientation = (typeof FRAGRANCE_ORIENTATIONS)[number];

export const SAMPLE_SOURCES = ["Natural", "Organic", "Synthetic"] as const;

// Natural and Organic own a shelf zone outright, so for those two the Category never
// reaches the shelf lookup at all (SLT-19). Every other Source — Synthetic, and the
// free-text values on samples predating the fixed list — is placed by what the sample
// is instead.
export const ZONE_SOURCES: readonly string[] = ["Natural", "Organic"];

export const isZoneSource = (source: string) => ZONE_SOURCES.includes(source);

export const HAZARD_CLASSES = ["Hazardous", "Non-Hazardous"] as const;

export const DOCUMENT_AVAILABILITY = ["YES", "NO"] as const;

export const SHELF_LETTERS = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"] as const;
export const SHELF_LEVELS = [1, 2, 3, 4, 5] as const;
// Numeric since the 2026-09-15 sprint review — a cell's occupants read 1, 2, 3 rather
// than a, b, c, so the whole address is digits and sorts naturally.
export const SHELF_SUBLEVELS = [1, 2, 3, 4, 5] as const;

export type ShelfSublevel = (typeof SHELF_SUBLEVELS)[number];

// Shelf placement is keyed on Source first: Natural and Organic each take a whole zone
// whatever the sample is, and only Synthetic falls through to Category (and, for
// Fragrance, to Orientation).
export function shelfClassificationFor(
  source: string,
  category: string,
  fragranceOrientation: string | null | undefined
): ShelfClassification {
  if (isZoneSource(source)) {
    return { source, category: "", fragranceOrientation: null };
  }
  return {
    source,
    category,
    fragranceOrientation: category === "Fragrance" ? fragranceOrientation ?? null : null,
  };
}

// Key used to look up a precomputed shelf default on the client. Natural and Organic
// collapse to a single key each, since neither reads Category or Orientation.
export function shelfKey(
  source: string,
  category: string,
  fragranceOrientation: string | null | undefined
) {
  if (isZoneSource(source)) return source;
  if (category === "Fragrance") return `${source}|Fragrance|${fragranceOrientation ?? ""}`;
  return `${source}|${category}`;
}

// Every combination the form can produce — 22 of them, since Natural and Organic each
// collapse to one — so the client can re-default the shelf row instantly without a
// round-trip.
export function allShelfCombinations(): Record<string, ShelfClassification> {
  const out: Record<string, ShelfClassification> = {};

  for (const source of SAMPLE_SOURCES) {
    if (isZoneSource(source)) {
      out[shelfKey(source, "", null)] = shelfClassificationFor(source, "", null);
      continue;
    }
    for (const category of SAMPLE_CATEGORIES) {
      if (category === "Fragrance") {
        for (const orientation of FRAGRANCE_ORIENTATIONS) {
          out[shelfKey(source, category, orientation)] = shelfClassificationFor(
            source,
            category,
            orientation
          );
        }
      } else {
        out[shelfKey(source, category, null)] = shelfClassificationFor(source, category, null);
      }
    }
  }

  return out;
}

// The swatch colour follows the same resolution as the shelf slot, so the colour on a
// row always matches the zone the sample is actually filed in: a Natural or Organic
// sample takes its Source's colour, a fragrance its Orientation's, everything else its
// Category's.
export function colorKeyFor(
  source: string,
  category: string,
  fragranceOrientation: string | null | undefined
) {
  if (isZoneSource(source)) return source;
  if (category === "Fragrance" && fragranceOrientation) return fragranceOrientation;
  return category;
}

// Formats a full shelf address, e.g. "H4" or "H4a".
// "G3" on its own, "G3-2" once a cell holds more than one sample. The dash is load-bearing
// now that the sublevel is numeric: "G32" would read as level 32.
export function shelfAddress(
  letter: string,
  level: number,
  sublevel?: number | null
): string {
  return `${letter}${level}${sublevel != null ? `-${sublevel}` : ""}`;
}

// Key for one shelf cell, used to look up which sublevels in it are already taken.
export function shelfCellKey(letter: string, level: number | string): string {
  return `${letter}${level}`;
}

// What a shelf cell currently holds: how many samples sit there at all, and which
// sublevel numbers among them are spoken for.
export type ShelfCellOccupancy = { total: number; sublevels: number[] };

// The next sublevel free in a cell. Null once 1–5 are all in use, which the caller
// surfaces as "this cell is full" rather than silently reusing a number.
export function nextFreeSublevel(used: readonly number[]): ShelfSublevel | null {
  const taken = new Set(used);
  return SHELF_SUBLEVELS.find((s) => !taken.has(s)) ?? null;
}

// What gets stored when the Admin leaves Sublevel on None. A sublevel is a tie-breaker,
// not an address component every sample needs (SLT-13: "optional, auto-suggested … used
// when multiple samples share the same computed cell+level"), so the first sample in a
// cell is just "H4". Only once something is already there does the next one take a
// number, which is what keeps two samples off the same address (SLT-19).
export type SublevelAssignment =
  | { kind: "none" }
  | { kind: "number"; sublevel: ShelfSublevel }
  | { kind: "full" };

export function assignSublevel(cell: ShelfCellOccupancy | undefined): SublevelAssignment {
  if (!cell || cell.total === 0) return { kind: "none" };
  const next = nextFreeSublevel(cell.sublevels);
  return next ? { kind: "number", sublevel: next } : { kind: "full" };
}
