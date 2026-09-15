import { prisma } from "@/lib/prisma";
import { SHELF_LETTERS, SHELF_LEVELS, shelfCellKey, type ShelfCellOccupancy } from "@/lib/categories";

// What a sample has to say about itself before it can be placed. Source leads, because
// Natural and Organic each claim a shelf zone outright regardless of what the sample
// actually is; Category (and, for Fragrance, Orientation) only decide placement for
// Synthetic samples. See the ShelfSlotConfig comment in prisma/schema.prisma.
export type ShelfClassification = {
  source: string;
  category: string;
  fragranceOrientation?: string | null;
};

// A resolved placement is always a set of candidate cells — one letter × one level for
// the fixed slots, a band of letters for Chemicals/Natural, a band of levels for the two
// values the plan gives two cells (Colorant G4–G5, Organic F1–F2). letters[0] + levels[0]
// is the default the Add/Edit form pre-fills; the Admin can still override both.
export type ShelfSlotResult = {
  letters: string[];
  levels: number[];
  colorHex: string;
  // Chemicals and Natural reserve whole columns and the plan says nothing about which
  // level a given sample belongs on, so Level stays a manual choice within the band
  // (mapping doc §5, interpretation (a) — still unconfirmed with Rawan).
  isManualLevel: boolean;
};

export async function resolveShelfSlot(
  classification: ShelfClassification
): Promise<ShelfSlotResult | null> {
  const all = await prisma.shelfSlotConfig.findMany();
  return matchShelfSlot(all, classification);
}

type ShelfSlotConfigRow = Awaited<ReturnType<typeof prisma.shelfSlotConfig.findMany>>[number];

// Pure matching step, split out from resolveShelfSlot so callers that need to resolve
// many classifications (e.g. the Add Sample form precomputing a default for every
// Source/Category/Orientation combination) can do it off a single findMany instead of
// one query each.
function matchShelfSlot(
  configs: ShelfSlotConfigRow[],
  classification: ShelfClassification
): ShelfSlotResult | null {
  const { source, category, fragranceOrientation } = classification;

  let best: ShelfSlotConfigRow | null = null;
  let bestScore = -1;

  for (const config of configs) {
    // Source is the one key that is never a wildcard: no row applies across sources.
    if (config.source !== source) continue;
    if (config.category != null && config.category !== category) continue;
    if (
      config.fragranceOrientation != null &&
      config.fragranceOrientation !== fragranceOrientation
    ) {
      continue;
    }

    // Most specific row wins, Orientation outranking Category. Nothing seeded today
    // matches two rows at once, but scoring means a fallback row (say Synthetic +
    // Fragrance with no Orientation) could be added later as data without shadowing the
    // 13 per-orientation rows.
    const score =
      (config.category != null ? 1 : 0) + (config.fragranceOrientation != null ? 2 : 0);

    if (score > bestScore) {
      best = config;
      bestScore = score;
    }
  }

  if (!best) return null;

  const letters = expandLetters(best);
  const levels = expandLevels(best);
  // A row that names neither a letter nor a band can't place anything — treat it as no
  // match rather than handing the form a half-empty default.
  if (letters.length === 0 || levels.length === 0) return null;

  return { letters, levels, colorHex: best.colorHex, isManualLevel: best.isManualLevel };
}

function expandLetters(config: ShelfSlotConfigRow): string[] {
  if (config.letterRangeStart && config.letterRangeEnd) {
    const out: string[] = [];
    const start = config.letterRangeStart.charCodeAt(0);
    const end = config.letterRangeEnd.charCodeAt(0);
    for (let c = start; c <= end; c++) out.push(String.fromCharCode(c));
    return out;
  }
  return config.letter ? [config.letter] : [];
}

function expandLevels(config: ShelfSlotConfigRow): number[] {
  if (config.levelRangeStart != null && config.levelRangeEnd != null) {
    const out: number[] = [];
    for (let l = config.levelRangeStart; l <= config.levelRangeEnd; l++) out.push(l);
    return out;
  }
  if (config.level != null) return [config.level];
  // A letter band with no level of its own spans the whole column: every level in it is
  // a legitimate placement, and the Admin picks which.
  return config.isManualLevel ? [...SHELF_LEVELS] : [];
}

// What the Add/Edit form pre-fills for one Source/Category/Orientation combination. Both
// letter and level are only ever defaults — the Admin can override them (SLT-13 AC-3).
export type ShelfDefault = {
  letter: string | null;
  // Null for the Chemicals/Natural bands, where the plan genuinely doesn't specify a
  // level and leaving the field blank is more honest than inventing one.
  level: number | null;
  colorHex: string | null;
  isManualLevel: boolean;
  zoneLetters: string[];
  zoneLevels: number[];
};

const NO_SHELF_DEFAULT: ShelfDefault = {
  letter: null,
  level: null,
  colorHex: null,
  isManualLevel: false,
  zoneLetters: [],
  zoneLevels: [],
};

export async function resolveShelfDefaults(
  classifications: Record<string, ShelfClassification>
): Promise<Record<string, ShelfDefault>> {
  const configs = await prisma.shelfSlotConfig.findMany();
  const out: Record<string, ShelfDefault> = {};

  for (const [key, classification] of Object.entries(classifications)) {
    const match = matchShelfSlot(configs, classification);

    out[key] = match
      ? {
          letter: match.letters[0] ?? null,
          level: match.isManualLevel ? null : match.levels[0] ?? null,
          colorHex: match.colorHex,
          isManualLevel: match.isManualLevel,
          zoneLetters: match.letters,
          zoneLevels: match.levels,
        }
      : NO_SHELF_DEFAULT;
  }

  return out;
}

// The colour of each physical shelf cell, keyed "H4". Built by expanding every config
// row across its letters and levels, so a sample's swatch can follow the address it
// actually sits at rather than the zone its category computes to — the two differ
// whenever an Admin overrides the placement, and legacy rows have no resolvable zone at
// all. Cells the plan leaves empty (F4, F5, J5) are simply absent.
//
// No two seeded rows claim the same cell; if one ever did, first-written wins.
export type ShelfCellColors = Record<string, string>;

export async function loadShelfCellColors(): Promise<ShelfCellColors> {
  const configs = await prisma.shelfSlotConfig.findMany();

  const out: ShelfCellColors = {};
  for (const config of configs) {
    for (const letter of expandLetters(config)) {
      for (const level of expandLevels(config)) {
        out[shelfCellKey(letter, level)] ??= config.colorHex;
      }
    }
  }
  return out;
}

// One cell can hold several samples, and the Sublevel letter is what keeps their
// addresses apart once that happens (SLT-19). These two helpers report what a cell
// already holds; assignSublevel() in categories.ts decides what a new sample gets.
//
// Both count total occupants, not just lettered ones: a lone "H4" with no sublevel still
// occupies the cell, so the next sample there has to take a letter.
//
// Discarded samples are excluded throughout: the sample is gone and its shelf space is
// physically free again, even though the record keeps the address it had.
export async function cellOccupancyAt(
  letter: string,
  level: number,
  excludeSampleId?: string
): Promise<ShelfCellOccupancy> {
  const rows = await prisma.sample.findMany({
    where: {
      shelfLetter: letter,
      shelfLevel: level,
      isDiscarded: false,
      ...(excludeSampleId ? { id: { not: excludeSampleId } } : {}),
    },
    select: { shelfSublevel: true },
  });

  return {
    total: rows.length,
    sublevels: rows.map((r) => r.shelfSublevel).filter((s): s is string => s != null),
  };
}

// The same thing for every cell at once, keyed by cell ("H4"), so the form can show what
// a sample will be stored as without a round-trip per cell. Small by construction: at
// most 10 letters × 5 levels.
export type ShelfOccupancy = Record<string, ShelfCellOccupancy>;

export async function loadShelfOccupancy(excludeSampleId?: string): Promise<ShelfOccupancy> {
  const rows = await prisma.sample.findMany({
    where: {
      isDiscarded: false,
      ...(excludeSampleId ? { id: { not: excludeSampleId } } : {}),
    },
    select: { shelfLetter: true, shelfLevel: true, shelfSublevel: true },
  });

  const out: ShelfOccupancy = {};
  for (const row of rows) {
    const key = shelfCellKey(row.shelfLetter, row.shelfLevel);
    const cell = (out[key] ??= { total: 0, sublevels: [] });
    cell.total++;
    if (row.shelfSublevel) cell.sublevels.push(row.shelfSublevel);
  }
  return out;
}

// What each cell of the plan is *for*, so the rack can label a drawer and the legend can
// name what a column holds (SLT-24). Derived from the same seeded ShelfSlotConfig rows as
// the colours, so the two can never describe different plans.
//
// A letter is not one category: H alone spans five fragrance orientations, each its own
// colour. So this reports per cell, and the legend groups cells by letter rather than
// assuming one row per letter.
export type ShelfCellMeaning = { label: string; colorHex: string };
export type ShelfCellMeanings = Record<string, ShelfCellMeaning>;

// Natural and Organic own their zones outright, with no category of their own — their
// Source *is* the label. Fragrance splits by orientation, so the orientation is the
// meaningful half.
function meaningLabel(config: ShelfSlotConfigRow): string {
  if (config.fragranceOrientation) return `Fragrance · ${config.fragranceOrientation}`;
  if (config.category) return config.category;
  return config.source;
}

export async function loadShelfCellMeanings(): Promise<ShelfCellMeanings> {
  const configs = await prisma.shelfSlotConfig.findMany();

  const out: ShelfCellMeanings = {};
  for (const config of configs) {
    for (const letter of expandLetters(config)) {
      for (const level of expandLevels(config)) {
        // First-written wins, matching loadShelfCellColors().
        out[shelfCellKey(letter, level)] ??= {
          label: meaningLabel(config),
          colorHex: config.colorHex,
        };
      }
    }
  }
  return out;
}

// One legend row per letter: the distinct colour/label pairs that letter's cells carry,
// in level order, so "H" reads as its five fragrance orientations rather than one colour.
export type ShelfLegendRow = {
  letter: string;
  entries: Array<{ label: string; colorHex: string; levels: number[] }>;
};

export function shelfLegendFrom(meanings: ShelfCellMeanings): ShelfLegendRow[] {
  return SHELF_LETTERS.map((letter) => {
    const entries: ShelfLegendRow["entries"] = [];

    for (const level of SHELF_LEVELS) {
      const cell = meanings[shelfCellKey(letter, level)];
      if (!cell) continue;

      // Merge adjacent levels that mean the same thing (F1-F2 Organic is one entry, not two).
      const existing = entries.find(
        (e) => e.label === cell.label && e.colorHex === cell.colorHex
      );
      if (existing) existing.levels.push(level);
      else entries.push({ label: cell.label, colorHex: cell.colorHex, levels: [level] });
    }

    return { letter, entries };
  });
}

// One colour per Category, for charts that group by category rather than by shelf cell
// (SLT-59). Taken from the same seeded plan as everything else.
//
// Fragrance is the awkward one: the plan gives it thirteen colours, one per orientation,
// and no category-level colour of its own. The lowest cell in letter/level order wins, so
// the choice is at least deterministic rather than whatever the database returns first.
export async function loadCategoryColors(): Promise<Record<string, string>> {
  const configs = await prisma.shelfSlotConfig.findMany({
    where: { category: { not: null } },
  });

  const ordered = [...configs].sort((a, b) => {
    const letterA = a.letter ?? a.letterRangeStart ?? "Z";
    const letterB = b.letter ?? b.letterRangeStart ?? "Z";
    if (letterA !== letterB) return letterA.localeCompare(letterB);
    return (a.level ?? a.levelRangeStart ?? 0) - (b.level ?? b.levelRangeStart ?? 0);
  });

  const out: Record<string, string> = {};
  for (const config of ordered) {
    if (config.category) out[config.category] ??= config.colorHex;
  }
  return out;
}
