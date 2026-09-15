import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaMssql } from "@prisma/adapter-mssql";
import { parseMssqlUrl } from "./src/lib/mssql-url";
import { stockFromPieces, COUNTED_PIECE_STATUSES } from "./src/lib/stock";
import { centsToGrams, toCents } from "./src/lib/pieces";
import { DiscardPiecesSchema } from "./src/lib/validation";

// SLT-55 acceptance criteria. Mirrors discardPieces() in stock-actions.ts.

const prisma = new PrismaClient({
  adapter: new PrismaMssql(parseMssqlUrl(process.env.DATABASE_URL!)),
});

const PREFIX = "ZZ-DISCARD-VERIFY-";
let failures = 0;
const check = (label: string, actual: unknown, expected: unknown) => {
  const ok = String(actual) === String(expected);
  if (!ok) failures++;
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${label.padEnd(54)} ${actual}${ok ? "" : `   (expected ${expected})`}`
  );
};

async function stockOf(sampleId: string) {
  const pieces = await prisma.samplePiece.findMany({
    where: { sampleId },
    select: { remainingWeightG: true, status: true },
  });
  return stockFromPieces(pieces);
}

// Mirrors discardPieces().
async function discard(sampleId: string, pieceIds: string[], reason: string, adminId: string) {
  const pieces = await prisma.samplePiece.findMany({
    where: { id: { in: pieceIds }, sampleId },
    select: { id: true, pieceIndex: true, status: true, remainingWeightG: true },
    orderBy: { pieceIndex: "asc" },
  });
  if (pieces.length !== pieceIds.length) throw new Error("MISSING");
  if (pieces.some((p) => p.status !== "IN_STOCK")) throw new Error("NOT_IN_STOCK");

  await prisma.$transaction(async (tx) => {
    await tx.samplePiece.updateMany({
      where: { id: { in: pieces.map((p) => p.id) } },
      data: {
        status: "DISCARDED",
        discardReason: reason,
        discardedAt: new Date(),
        discardedById: adminId,
      },
    });
    for (const piece of pieces) {
      await tx.transaction.create({
        data: {
          sampleId,
          type: "DISCARD",
          quantityG: centsToGrams(toCents(Number(piece.remainingWeightG))),
          performedById: adminId,
          note: `Piece #${piece.pieceIndex} discarded — ${reason}`,
        },
      });
    }
  });
}

async function main() {
  const admin = await prisma.user.findFirstOrThrow({ where: { role: { name: "ADMIN" } } });
  const formulatorRole = await prisma.role.findFirstOrThrow({ where: { name: "FORMULATOR" } });
  const formulator = await prisma.user.create({
    data: {
      adUsername: PREFIX.toLowerCase() + "f",
      name: "Discard Formulator",
      roleId: formulatorRole.id,
      isActive: true,
    },
  });

  // 4 pieces of 5 g: #1 and #2 in stock, #3 checked out, #4 already depleted.
  const sample = await prisma.sample.create({
    data: {
      sampleCode: PREFIX + "1",
      rmName: "discard sample",
      category: "Wax",
      function: "n/a",
      physicalForm: "Solid",
      source: "Synthetic",
      supplier: "n/a",
      expiryDate: new Date("2030-01-01"),
      totalQtyG: 20,
      receivedQtyPcs: 4,
      shelfLetter: "G",
      shelfLevel: 3,
      createdById: admin.id,
      pieces: {
        create: [
          { pieceIndex: 1, originalWeightG: "5.00", remainingWeightG: "5.00", status: "IN_STOCK" },
          { pieceIndex: 2, originalWeightG: "5.00", remainingWeightG: "5.00", status: "IN_STOCK" },
          {
            pieceIndex: 3, originalWeightG: "5.00", remainingWeightG: "5.00",
            status: "CHECKED_OUT", checkedOutToUserId: formulator.id, checkedOutAt: new Date(),
          },
          { pieceIndex: 4, originalWeightG: "5.00", remainingWeightG: "0.00", status: "DEPLETED" },
        ],
      },
    },
    include: { pieces: { orderBy: { pieceIndex: "asc" } } },
  });
  const [p1, p2, p3] = sample.pieces;

  try {
    console.log("\n=== Start: 2 in stock, 1 checked out, 1 depleted ===");
    let s = await stockOf(sample.id);
    check("remaining g (depleted excluded)", s.remainingQtyG, "15.00");
    check("remaining pcs", s.remainingQtyPcs, 3);

    console.log("\n=== Validation: a reason is required, and something must be selected ===");
    check(
      "blank reason rejected",
      DiscardPiecesSchema.safeParse({ sampleId: sample.id, pieceIds: [p1.id], reason: "   " }).success,
      false
    );
    check(
      "no pieces selected rejected",
      DiscardPiecesSchema.safeParse({ sampleId: sample.id, pieceIds: [], reason: "Expired" }).success,
      false
    );
    check(
      "valid input accepted",
      DiscardPiecesSchema.safeParse({ sampleId: sample.id, pieceIds: [p1.id], reason: "Expired" }).success,
      true
    );

    console.log("\n=== AC2: a checked-out piece is not selectable ===");
    let rejected = false;
    try {
      await discard(sample.id, [p3.id], "Expired", admin.id);
    } catch (e) {
      rejected = (e as Error).message === "NOT_IN_STOCK";
    }
    check("discarding a CHECKED_OUT piece rejected", rejected, true);
    check("mixed selection rejected as a whole", await (async () => {
      try {
        await discard(sample.id, [p1.id, p3.id], "Expired", admin.id);
        return false;
      } catch (e) {
        return (e as Error).message === "NOT_IN_STOCK";
      }
    })(), true);
    s = await stockOf(sample.id);
    check("nothing changed after rejection", s.remainingQtyG, "15.00");

    console.log("\n=== AC1: discarding two in-stock pieces drops g and pcs ===");
    await discard(sample.id, [p1.id, p2.id], "Expired", admin.id);
    s = await stockOf(sample.id);
    check("remaining g", s.remainingQtyG, "5.00");
    check("remaining pcs", s.remainingQtyPcs, 1);

    const after = await prisma.samplePiece.findMany({
      where: { sampleId: sample.id },
      orderBy: { pieceIndex: "asc" },
      include: { discardedBy: { select: { name: true } } },
    });
    console.table(
      after.map((p) => ({
        piece: `#${p.pieceIndex}`,
        status: p.status,
        remaining: Number(p.remainingWeightG).toFixed(2),
        reason: p.discardReason ?? "—",
        by: p.discardedBy?.name ?? "—",
      }))
    );
    check("piece 1 discarded", after[0].status, "DISCARDED");
    check("reason recorded", after[0].discardReason, "Expired");
    check("discardedBy recorded", after[0].discardedBy?.name, admin.name);
    check("discardedAt recorded", after[0].discardedAt !== null, true);
    check("weight preserved on the record", Number(after[0].remainingWeightG).toFixed(2), "5.00");
    check("checked-out piece untouched", after[2].status, "CHECKED_OUT");

    console.log("\n=== AC3: a DISCARD transaction per piece, with reason and admin ===");
    const discards = await prisma.transaction.findMany({
      where: { sampleId: sample.id, type: "DISCARD" },
      include: { performedBy: { select: { name: true } } },
      orderBy: { createdAt: "asc" },
    });
    console.table(
      discards.map((t) => ({
        amount: `${Number(t.quantityG).toFixed(2)} g`,
        by: t.performedBy.name,
        note: t.note,
      }))
    );
    check("one entry per discarded piece", discards.length, 2);
    check("entry names the reason", discards[0].note?.includes("Expired"), true);
    check("entry names the admin", discards[0].performedBy.name, admin.name);

    console.log("\n=== AC4: all pieces gone reads 0 in both g and pcs ===");
    // Return the checked-out piece with everything used, then discard nothing more:
    // every piece is now DEPLETED or DISCARDED.
    await prisma.samplePiece.update({
      where: { id: p3.id },
      data: {
        status: "DEPLETED", remainingWeightG: "0.00",
        checkedOutToUserId: null, checkedOutAt: null,
      },
    });
    s = await stockOf(sample.id);
    check("remaining g", s.remainingQtyG, "0.00");
    check("remaining pcs", s.remainingQtyPcs, 0);
    check("counted statuses exclude DISCARDED", [...COUNTED_PIECE_STATUSES].includes("DISCARDED" as never), false);

    const stillThere = await prisma.samplePiece.count({ where: { sampleId: sample.id } });
    check("all 4 pieces still visible in history", stillThere, 4);
    const reloaded = await prisma.sample.findUniqueOrThrow({ where: { id: sample.id } });
    check("sample NOT auto-flagged as discarded", reloaded.isDiscarded, false);
    check("total received untouched", reloaded.totalQtyG.toString(), "20");
  } finally {
    await prisma.transaction.deleteMany({ where: { sample: { sampleCode: { startsWith: PREFIX } } } });
    await prisma.samplePiece.deleteMany({ where: { sample: { sampleCode: { startsWith: PREFIX } } } });
    await prisma.sample.deleteMany({ where: { sampleCode: { startsWith: PREFIX } } });
    await prisma.user.deleteMany({ where: { adUsername: { startsWith: PREFIX.toLowerCase() } } });
    console.log(`\ncleanup done — real samples: ${await prisma.sample.count()}, users: ${await prisma.user.count()}`);
    await prisma.$disconnect();
  }

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}
main();
