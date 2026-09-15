import "dotenv/config";
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { PrismaMssql } from "@prisma/adapter-mssql";
import { parseMssqlUrl } from "./src/lib/mssql-url";
import { centsToGrams, toCents } from "./src/lib/pieces";

// Step 2 of the SamplePiece migration, run after `prisma db push`. Rebuilds the piece
// rows from the snapshot:
//
//   - pieces that already existed keep their weight, as both original and remaining
//     (nothing had been consumed — the old isUsed flag was a placeholder nothing wrote)
//   - samples that had no pieces at all get exactly one, carrying the remaining quantity
//     that used to live on Sample.remainingQtyG. Without this they'd compute to 0 g,
//     since current stock is now derived from pieces only.
type Snapshot = {
  pieces: Array<{ sampleId: string; pieceIndex: number; weightG: string }>;
  pieceless: Array<{ sampleId: string; sampleCode: string; remainingQtyG: string }>;
};

const grams = (raw: string) => centsToGrams(toCents(Number(raw)));

async function main() {
  const prisma = new PrismaClient({
    adapter: new PrismaMssql(parseMssqlUrl(process.env.DATABASE_URL!)),
  });

  const snapshot: Snapshot = JSON.parse(readFileSync("_stock_migrate_snapshot.json", "utf8"));

  const existing = await prisma.samplePiece.count();
  if (existing > 0) {
    console.log(`sample_pieces already has ${existing} rows — nothing to restore, exiting.`);
    await prisma.$disconnect();
    return;
  }

  for (const p of snapshot.pieces) {
    await prisma.samplePiece.create({
      data: {
        sampleId: p.sampleId,
        pieceIndex: p.pieceIndex,
        originalWeightG: grams(p.weightG),
        remainingWeightG: grams(p.weightG),
        status: "IN_STOCK",
      },
    });
  }
  console.log(`restored ${snapshot.pieces.length} pre-existing piece rows`);

  for (const s of snapshot.pieceless) {
    await prisma.samplePiece.create({
      data: {
        sampleId: s.sampleId,
        pieceIndex: 1,
        originalWeightG: grams(s.remainingQtyG),
        remainingWeightG: grams(s.remainingQtyG),
        status: "IN_STOCK",
      },
    });
  }
  console.log(`backfilled ${snapshot.pieceless.length} single-piece samples`);

  const check = await prisma.sample.findMany({
    select: {
      sampleCode: true,
      totalQtyG: true,
      pieces: { select: { originalWeightG: true, remainingWeightG: true, status: true } },
    },
    orderBy: { sampleCode: "asc" },
  });
  console.table(
    check.map((s) => ({
      sample: s.sampleCode,
      totalG: s.totalQtyG.toString(),
      pieces: s.pieces.length,
      remainingG: s.pieces
        .reduce((t, p) => t + Number(p.remainingWeightG), 0)
        .toFixed(2),
    }))
  );

  await prisma.$disconnect();
}
main();
