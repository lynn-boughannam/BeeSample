import "server-only";
import { prisma } from "@/lib/prisma";
import { centsToGrams, toCents } from "@/lib/pieces";
import { COUNTED_PIECE_STATUSES, EMPTY_STOCK, type SampleStock } from "@/lib/stock";

// The database side of stock. Split from src/lib/stock.ts so the pure helpers there stay
// importable from client components — this module pulls in the SQL Server driver and is
// marked server-only so a stray client import fails loudly instead of at build time.

// Current stock for many samples in one grouped query, for list views. Samples with no
// counted pieces are absent from the result; callers fall back to EMPTY_STOCK.
export async function loadSampleStock(sampleIds: string[]): Promise<Record<string, SampleStock>> {
  if (sampleIds.length === 0) return {};

  const rows = await prisma.samplePiece.groupBy({
    by: ["sampleId"],
    where: {
      sampleId: { in: sampleIds },
      status: { in: [...COUNTED_PIECE_STATUSES] },
    },
    _sum: { remainingWeightG: true },
    _count: { _all: true },
  });

  const out: Record<string, SampleStock> = {};
  for (const row of rows) {
    // _sum arrives as a Decimal (null when nothing matched), so it's already exact; the
    // trip through cents just pins it to 2dp for display.
    out[row.sampleId] = {
      remainingQtyG: centsToGrams(toCents(Number(row._sum.remainingWeightG ?? 0))),
      remainingQtyPcs: row._count._all,
    };
  }
  return out;
}

export async function loadOneSampleStock(sampleId: string): Promise<SampleStock> {
  const stock = await loadSampleStock([sampleId]);
  return stock[sampleId] ?? EMPTY_STOCK;
}
