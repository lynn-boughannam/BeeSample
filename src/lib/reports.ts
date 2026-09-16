import "server-only";
import { prisma } from "@/lib/prisma";
import { colorKeyFor, FRAGRANCE_ORIENTATIONS } from "@/lib/categories";
import { loadSampleStock } from "@/lib/stock-queries";
import { stockLevel, EMPTY_STOCK } from "@/lib/stock";

// Admin reports, modelled on the 2026 exec review deck.
//
// Scope decided 2026-09-16: cost-based reporting (deck slides 2 and 5) is not built,
// because no cost is recorded anywhere yet. The disposal recommendation half of slide 4 is
// not built either — it needs a reason taxonomy and a classification rule that don't exist
// and shouldn't be guessed at. What's here is what the current data can honestly answer.

export type DateRange = { from: Date | null; to: Date | null };

// A report is a snapshot of a moving library, so every one of these carries the moment it
// was taken — a number without one invites being pasted into a deck months later.
export type ReportMeta = { generatedAt: Date; range: DateRange };

export type Slice = { label: string; count: number; percent: number };

const pct = (part: number, whole: number) => (whole === 0 ? 0 : (part / whole) * 100);

// Sorted biggest-first and capped, with the tail folded into one entry rather than
// dropped — a "top suppliers" chart that silently loses 40% of the library is a lie.
function topSlices(counts: Map<string, number>, total: number, limit: number): Slice[] {
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const head = sorted.slice(0, limit);
  const tailCount = sorted.slice(limit).reduce((sum, [, n]) => sum + n, 0);

  const slices = head.map(([label, count]) => ({ label, count, percent: pct(count, total) }));
  if (tailCount > 0) {
    slices.push({
      label: `Other (${sorted.length - limit})`,
      count: tailCount,
      percent: pct(tailCount, total),
    });
  }
  return slices;
}

function tally<T>(rows: T[], key: (row: T) => string | null | undefined): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const k = (key(row) ?? "").trim();
    if (!k) continue;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return counts;
}

// "Used by formulators" = at least one logged usage, ever, of any amount — including a 0 g
// return, since a formulator still took the sample and brought it back (decided
// 2026-09-16). Checkouts with no usage logged against them don't count.
async function usedSampleIds(): Promise<Set<string>> {
  const rows = await prisma.transaction.findMany({
    where: { type: "RETURN_USAGE" },
    select: { sampleId: true },
    distinct: ["sampleId"],
  });
  return new Set(rows.map((r) => r.sampleId));
}

function rangeWhere(range: DateRange) {
  if (!range.from && !range.to) return undefined;
  return {
    ...(range.from ? { gte: range.from } : {}),
    ...(range.to ? { lte: range.to } : {}),
  };
}

// ---------------------------------------------------------------------------
// Report 2 — RM Sample Library, current status
// ---------------------------------------------------------------------------

export type LibraryStatusReport = {
  meta: ReportMeta;
  total: number;
  available: { count: number; percent: number };
  // "Empty" is the Zero Stock definition already built (SLT-26), relabelled to match the
  // deck. Available and Empty partition the library, as they do there.
  empty: { count: number; percent: number };
  usedByFormulators: { count: number; percent: number };
  byCategory: Slice[];
  topSuppliers: Slice[];
  topLocationCategories: Slice[];
  findings: {
    topFunction: Slice | null;
    topSupplier: Slice | null;
    topLocationCategory: Slice | null;
    topCategory: Slice | null;
  };
};

export async function loadLibraryStatusReport(): Promise<LibraryStatusReport> {
  // Current status means the live library: a discarded sample has left it.
  const samples = await prisma.sample.findMany({
    where: { isDiscarded: false },
    select: {
      id: true,
      category: true,
      subcategory1: true,
      fragranceOrientation: true,
      function: true,
      supplier: true,
      source: true,
    },
  });

  const [stock, used] = await Promise.all([
    loadSampleStock(samples.map((s) => s.id)),
    usedSampleIds(),
  ]);

  const total = samples.length;
  let empty = 0;
  for (const s of samples) {
    if (stockLevel(stock[s.id] ?? EMPTY_STOCK) === "ZERO") empty++;
  }
  const usedCount = samples.filter((s) => used.has(s.id)).length;

  // Location category is the shelf zone a sample sits in — the Source for Natural and
  // Organic, the orientation for a fragrance, the category otherwise. Exactly the existing
  // colorKeyFor() key, which is what the deck's "Men-Fragrance" style labels are.
  const locations = tally(samples, (s) =>
    locationCategoryLabel(s.source, s.category, s.fragranceOrientation)
  );

  const categories = tally(samples, (s) => s.category);
  const suppliers = tally(samples, (s) => s.supplier);
  const functions = tally(samples, (s) => s.function);

  const first = (counts: Map<string, number>): Slice | null => {
    const top = topSlices(counts, total, 1)[0];
    return top && !top.label.startsWith("Other (") ? top : null;
  };

  return {
    meta: { generatedAt: new Date(), range: { from: null, to: null } },
    total,
    available: { count: total - empty, percent: pct(total - empty, total) },
    empty: { count: empty, percent: pct(empty, total) },
    usedByFormulators: { count: usedCount, percent: pct(usedCount, total) },
    byCategory: topSlices(categories, total, 8),
    topSuppliers: topSlices(suppliers, total, 6),
    topLocationCategories: topSlices(locations, total, 6),
    findings: {
      topFunction: first(functions),
      topSupplier: first(suppliers),
      topLocationCategory: first(locations),
      topCategory: first(categories),
    },
  };
}

// The deck writes a fragrance zone as "Men-Fragrance"; the underlying key is just "Men".
// Suffixed here for display so the label says which shelf it means.
//
// The suffix is decided by the resolved key, NOT by how the row happens to be stored.
// Older rows keep an orientation in the category column ("Nut", "Woody") rather than
// Fragrance + orientation, and keying off the storage shape split one shelf zone into two
// buckets — "Woody" and "Woody-Fragrance" counted separately in the same chart.
export function locationCategoryLabel(
  source: string,
  category: string,
  orientation: string | null
): string {
  const key = colorKeyFor(source, category, orientation);
  const isOrientation = (FRAGRANCE_ORIENTATIONS as readonly string[]).includes(key);
  return isOrientation ? `${key}-Fragrance` : key;
}

// ---------------------------------------------------------------------------
// Report 3 — Expired samples (expiry half only)
// ---------------------------------------------------------------------------

export type CohortBar = {
  category: string;
  olderCount: number;
  recentCount: number;
};

export type ExpiryReport = {
  meta: ReportMeta;
  splitYear: number;
  total: number;
  expired: { count: number; percent: number };
  expiringSoon: { count: number; percent: number };
  // Expired samples by the shelf zone they sit in, so the list can be walked shelf by
  // shelf rather than sample by sample.
  expiredByLocation: Slice[];
  expiredByCategory: Slice[];
  // Hazard class is recorded per sample, so this much of the deck's disposal slide is
  // answerable today — what's missing is the dispose/remain recommendation itself.
  expiredByHazard: Slice[];
  cohorts: CohortBar[];
  olderTotal: number;
  recentTotal: number;
};

const SOON_DAYS = 90;

export async function loadExpiryReport(
  range: DateRange,
  splitYear: number
): Promise<ExpiryReport> {
  const receivedAt = rangeWhere(range);
  const samples = await prisma.sample.findMany({
    where: { isDiscarded: false, ...(receivedAt ? { receptionDate: receivedAt } : {}) },
    select: {
      id: true,
      category: true,
      source: true,
      fragranceOrientation: true,
      expiryDate: true,
      receptionDate: true,
      hazardClass: true,
    },
  });

  const now = new Date();
  const soonCutoff = new Date(now.getTime() + SOON_DAYS * 24 * 60 * 60 * 1000);

  const expired = samples.filter((s) => s.expiryDate < now);
  const soon = samples.filter((s) => s.expiryDate >= now && s.expiryDate <= soonCutoff);
  const total = samples.length;

  // The cohort split is configurable rather than fixed to the deck's 2012-2018 / 2019-2026,
  // so the comparison stays meaningful as years pass.
  const older = samples.filter((s) => s.receptionDate.getFullYear() < splitYear);
  const recent = samples.filter((s) => s.receptionDate.getFullYear() >= splitYear);

  const categoriesInPlay = [...new Set(samples.map((s) => s.category))].sort();
  const cohorts: CohortBar[] = categoriesInPlay
    .map((category) => ({
      category,
      olderCount: older.filter((s) => s.category === category).length,
      recentCount: recent.filter((s) => s.category === category).length,
    }))
    .sort((a, b) => b.olderCount + b.recentCount - (a.olderCount + a.recentCount));

  return {
    meta: { generatedAt: now, range },
    splitYear,
    total,
    expired: { count: expired.length, percent: pct(expired.length, total) },
    expiringSoon: { count: soon.length, percent: pct(soon.length, total) },
    expiredByLocation: topSlices(
      tally(expired, (s) => locationCategoryLabel(s.source, s.category, s.fragranceOrientation)),
      expired.length,
      6
    ),
    expiredByCategory: topSlices(tally(expired, (s) => s.category), expired.length, 8),
    expiredByHazard: topSlices(
      tally(expired, (s) => s.hazardClass ?? "Not recorded"),
      expired.length,
      4
    ),
    cohorts,
    olderTotal: older.length,
    recentTotal: recent.length,
  };
}

// ---------------------------------------------------------------------------
// Report 5 — Category deep-dive
// ---------------------------------------------------------------------------

export type SubcategoryRow = {
  label: string;
  count: number;
  usedCount: number;
  usedPercent: number;
};

export type CategoryReport = {
  meta: ReportMeta;
  category: string;
  libraryTotal: number;
  total: number;
  shareOfLibrary: number;
  receiptsInRange: { count: number; percent: number };
  used: { count: number; percent: number };
  // Both charts are driven by this one list, sorted by count, so the two bars sit in the
  // same order and can be read across — the comparison is the whole point.
  subcategories: SubcategoryRow[];
  findings: { overStocked: string[]; underStocked: string[] };
};

// Fragrance is split by orientation; every other category by its first subcategory. Falls
// back to a single bucket so a category with no subdivision still renders.
export function subcategoryOf(sample: {
  category: string;
  subcategory1: string | null;
  fragranceOrientation: string | null;
}): string {
  if (sample.category === "Fragrance") return sample.fragranceOrientation ?? "Unspecified";
  return sample.subcategory1 ?? "Unspecified";
}

export async function loadCategoryReport(
  category: string,
  range: DateRange
): Promise<CategoryReport> {
  const receivedAt = rangeWhere(range);

  const [inCategory, libraryTotal, used] = await Promise.all([
    prisma.sample.findMany({
      where: { isDiscarded: false, category },
      select: {
        id: true,
        category: true,
        subcategory1: true,
        fragranceOrientation: true,
        receptionDate: true,
      },
    }),
    prisma.sample.count({ where: { isDiscarded: false } }),
    usedSampleIds(),
  ]);

  const total = inCategory.length;

  // Receipts in range: how much of what arrived in the window was this category.
  const receiptsWhere = { isDiscarded: false, ...(receivedAt ? { receptionDate: receivedAt } : {}) };
  const [receiptsInCategory, receiptsAll] = await Promise.all([
    prisma.sample.count({ where: { ...receiptsWhere, category } }),
    prisma.sample.count({ where: receiptsWhere }),
  ]);

  const buckets = new Map<string, { count: number; used: number }>();
  for (const s of inCategory) {
    const label = subcategoryOf(s);
    const bucket = buckets.get(label) ?? { count: 0, used: 0 };
    bucket.count++;
    if (used.has(s.id)) bucket.used++;
    buckets.set(label, bucket);
  }

  const subcategories: SubcategoryRow[] = [...buckets.entries()]
    .map(([label, b]) => ({
      label,
      count: b.count,
      usedCount: b.used,
      usedPercent: pct(b.used, b.count),
    }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

  const usedInCategory = inCategory.filter((s) => used.has(s.id)).length;

  return {
    meta: { generatedAt: new Date(), range },
    category,
    libraryTotal,
    total,
    shareOfLibrary: pct(total, libraryTotal),
    receiptsInRange: { count: receiptsInCategory, percent: pct(receiptsInCategory, receiptsAll) },
    used: { count: usedInCategory, percent: pct(usedInCategory, total) },
    subcategories,
    findings: stockVersusUseFindings(subcategories),
  };
}

/**
 * Which subcategories hold the most stock while converting the least of it into formulator
 * use, and which do the reverse.
 *
 * Worked out by comparing each subcategory's rank by sample count against its rank by
 * usage rate, so the answer follows the data rather than a hardcoded list of names. Only
 * subcategories with enough samples to mean anything are considered — one sample used once
 * is a 100% usage rate and would otherwise dominate the finding.
 */
export function stockVersusUseFindings(rows: SubcategoryRow[]): {
  overStocked: string[];
  underStocked: string[];
} {
  const MIN_SAMPLES = 5;
  const eligible = rows.filter((r) => r.count >= MIN_SAMPLES);
  if (eligible.length < 3) return { overStocked: [], underStocked: [] };

  const byCount = [...eligible].sort((a, b) => b.count - a.count);
  const byUse = [...eligible].sort((a, b) => b.usedPercent - a.usedPercent);

  const countRank = new Map(byCount.map((r, i) => [r.label, i]));
  const useRank = new Map(byUse.map((r, i) => [r.label, i]));

  // A positive gap means it ranks far higher for stock than for use.
  const gaps = eligible.map((r) => ({
    label: r.label,
    gap: (useRank.get(r.label) ?? 0) - (countRank.get(r.label) ?? 0),
  }));

  const overStocked = gaps
    .filter((g) => g.gap > 0)
    .sort((a, b) => b.gap - a.gap)
    .slice(0, 3)
    .map((g) => g.label);

  const underStocked = gaps
    .filter((g) => g.gap < 0)
    .sort((a, b) => a.gap - b.gap)
    .slice(0, 3)
    .map((g) => g.label);

  return { overStocked, underStocked };
}
