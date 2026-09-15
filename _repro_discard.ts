import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaMssql } from "@prisma/adapter-mssql";
import { parseMssqlUrl } from "./src/lib/mssql-url";
import { centsToGrams, toCents } from "./src/lib/pieces";

// Runs the exact database work discardPieces() does, against a REAL sample and its REAL
// in-stock piece, then throws to roll the whole thing back. Surfaces the error the
// action's catch block swallows.

async function main() {
  const prisma = new PrismaClient({
    adapter: new PrismaMssql(parseMssqlUrl(process.env.DATABASE_URL!)),
  });

  const admin = await prisma.user.findFirstOrThrow({ where: { role: { name: "ADMIN" } } });
  const piece = await prisma.samplePiece.findFirst({
    where: { status: "IN_STOCK", sample: { isDiscarded: false } },
    include: { sample: { select: { id: true, sampleCode: true } } },
  });

  if (!piece) {
    console.log("no in-stock piece on a live sample to test with");
    await prisma.$disconnect();
    return;
  }

  console.log(`target: ${piece.sample.sampleCode} piece #${piece.pieceIndex} (${piece.id})`);
  console.log(`admin:  ${admin.name} (${admin.id})`);

  const reason = "Expired";
  const discardedAt = new Date();

  try {
    await prisma.$transaction(async (tx) => {
      console.log("\n-> samplePiece.updateMany");
      const updated = await tx.samplePiece.updateMany({
        where: { id: { in: [piece.id] } },
        data: {
          status: "DISCARDED",
          discardReason: reason,
          discardedAt,
          discardedById: admin.id,
        },
      });
      console.log("   ok, rows:", updated.count);

      console.log("-> transaction.create");
      await tx.transaction.create({
        data: {
          sampleId: piece.sample.id,
          type: "DISCARD",
          quantityG: centsToGrams(toCents(Number(piece.remainingWeightG))),
          performedById: admin.id,
          note: `Piece #${piece.pieceIndex} discarded — ${reason}`,
        },
      });
      console.log("   ok");

      throw new Error("__ROLLBACK__");
    });
  } catch (e) {
    const err = e as Error;
    if (err.message === "__ROLLBACK__") {
      console.log("\nBOTH STEPS SUCCEEDED — rolled back, nothing persisted.");
    } else {
      console.log("\n!!! THIS IS THE REAL ERROR THE ACTION SWALLOWS:\n");
      console.log(err.message);
    }
  }

  const check = await prisma.samplePiece.findUniqueOrThrow({ where: { id: piece.id } });
  console.log(`\nrollback check — piece status is still: ${check.status}`);

  await prisma.$disconnect();
}
main();
