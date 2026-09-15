import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaMssql } from "@prisma/adapter-mssql";
import { parseMssqlUrl } from "./src/lib/mssql-url";
import { stockFromPieces, stockLevel } from "./src/lib/stock";
import { centsToGrams, toCents } from "./src/lib/pieces";
import { AddReceivedStockSchema } from "./src/lib/validation";

// SLT-25 acceptance criteria. Mirrors addReceivedStock() in stock-actions.ts against real
// rows, including the zero-stock recovery path the story calls out.

const prisma = new PrismaClient({
  adapter: new PrismaMssql(parseMssqlUrl(process.env.DATABASE_URL!)),
});

const PREFIX = "ZZ-RESTOCK-VERIFY-";
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

// Mirrors addReceivedStock().
async function addStock(sampleId: string, amountG: number, adminId: string) {
  const sample = await prisma.sample.findUniqueOrThrow({ where: { id: sampleId } });
  if (sample.isDiscarded) throw new Error("DISCARDED");

  const addedCents = toCents(amountG);
  const added = centsToGrams(addedCents);
  const newTotal = centsToGrams(toCents(Number(sample.totalQtyG)) + addedCents);

  await prisma.$transaction(async (tx) => {
    const last = await tx.samplePiece.findFirst({
      where: { sampleId },
      orderBy: { pieceIndex: "desc" },
      select: { pieceIndex: true },
    });
    await tx.samplePiece.create({
      data: {
        sampleId,
        pieceIndex: (last?.pieceIndex ?? 0) + 1,
        originalWeightG: added,
        remainingWeightG: added,
        status: "IN_STOCK",
      },
    });
    await tx.sample.update({
      where: { id: sampleId },
      data: {
        totalQtyG: newTotal,
        receivedQtyPcs: sample.receivedQtyPcs != null ? sample.receivedQtyPcs + 1 : null,
        receptionDate: new Date(),
      },
    });
    await tx.locationHistory.create({
      data: {
        sampleId,
        shelfLetter: sample.shelfLetter,
        shelfLevel: sample.shelfLevel,
        shelfSublevel: sample.shelfSublevel,
        movedAt: new Date(),
        movedById: adminId,
        note: `+${added}g received`,
      },
    });
    await tx.transaction.create({
      data: {
        sampleId,
        type: "RECEIPT",
        quantityG: added,
        performedById: adminId,
        note: `Restock: +${added} g received`,
      },
    });
  });
}

async function main() {
  const admin = await prisma.user.findFirstOrThrow({ where: { role: { name: "ADMIN" } } });
  const base = {
    rmName: "restock sample",
    category: "Wax",
    function: "n/a",
    physicalForm: "Solid",
    source: "Synthetic",
    supplier: "n/a",
    expiryDate: new Date("2030-01-01"),
    shelfLetter: "G",
    shelfLevel: 3,
    createdById: admin.id,
  };

  // Starts fully depleted — the zero-stock recovery case the story is explicitly for.
  const zero = await prisma.sample.create({
    data: {
      ...base,
      sampleCode: PREFIX + "ZERO",
      totalQtyG: 10,
      receivedQtyPcs: 1,
      receptionDate: new Date("2020-01-01"),
      pieces: {
        create: [{ pieceIndex: 1, originalWeightG: "10.00", remainingWeightG: "0.00", status: "DEPLETED" }],
      },
    },
  });

  const discarded = await prisma.sample.create({
    data: {
      ...base,
      sampleCode: PREFIX + "DISCARDED",
      totalQtyG: 10,
      receivedQtyPcs: 1,
      isDiscarded: true,
      discardedById: admin.id,
      discardedAt: new Date(),
      pieces: {
        create: [{ pieceIndex: 1, originalWeightG: "10.00", remainingWeightG: "4.00", status: "IN_STOCK" }],
      },
    },
  });

  try {
    console.log("\n=== AC2: 0, blank and negative are rejected ===");
    for (const [label, raw] of [["blank", ""], ["zero", "0"], ["negative", "-5"]] as const) {
      const r = AddReceivedStockSchema.safeParse({ sampleId: zero.id, amountG: raw });
      check(`${label} rejected`, r.success, false);
      if (!r.success) console.log(`        ${r.error.issues[0].message}`);
    }
    const before = await stockOf(zero.id);
    check("no change occurred (still 0 g)", before.remainingQtyG, "0.00");

    console.log("\n=== AC3 + AC1: restocking a zero-stock sample ===");
    check("starts at ZERO", stockLevel(before, 10), "ZERO");
    check("starts with 0 pcs", before.remainingQtyPcs, 0);

    await addStock(zero.id, 25, admin.id);

    const after = await stockOf(zero.id);
    const reloaded = await prisma.sample.findUniqueOrThrow({ where: { id: zero.id } });
    check("remaining increased by 25", after.remainingQtyG, "25.00");
    check("total increased by 25", reloaded.totalQtyG.toString(), "35");
    check("zero-stock flag cleared", stockLevel(after, reloaded.totalQtyG), "HEALTHY");
    check("pcs back above 0", after.remainingQtyPcs, 1);
    check(
      "reception date updated to today",
      reloaded.receptionDate.toISOString().slice(0, 10),
      new Date().toISOString().slice(0, 10)
    );
    check("received pcs kept in step", reloaded.receivedQtyPcs, 2);

    const pieces = await prisma.samplePiece.findMany({
      where: { sampleId: zero.id },
      orderBy: { pieceIndex: "asc" },
      select: { pieceIndex: true, originalWeightG: true, remainingWeightG: true, status: true },
    });
    console.table(
      pieces.map((p) => ({
        piece: `#${p.pieceIndex}`,
        original: Number(p.originalWeightG).toFixed(2),
        remaining: Number(p.remainingWeightG).toFixed(2),
        status: p.status,
      }))
    );
    check("new piece continues the index sequence", pieces.at(-1)?.pieceIndex, 2);
    check("depleted piece untouched", pieces[0].status, "DEPLETED");
    check("new piece is in stock", pieces.at(-1)?.status, "IN_STOCK");

    const history = await prisma.locationHistory.findMany({
      where: { sampleId: zero.id },
      orderBy: { movedAt: "desc" },
    });
    check("location history appended", history.length, 1);
    check("history note", history[0].note, "+25.00g received");
    check("history carries the shelf address", `${history[0].shelfLetter}${history[0].shelfLevel}`, "G3");

    const receipts = await prisma.transaction.findMany({
      where: { sampleId: zero.id, type: "RECEIPT" },
    });
    check("RECEIPT transaction logged", receipts.length, 1);
    check("receipt amount", Number(receipts[0].quantityG).toFixed(2), "25.00");

    console.log("\n=== second restock stacks on the first ===");
    await addStock(zero.id, 5.5, admin.id);
    const third = await stockOf(zero.id);
    const reloaded2 = await prisma.sample.findUniqueOrThrow({ where: { id: zero.id } });
    check("remaining now 30.50", third.remainingQtyG, "30.50");
    check("total now 40.50", reloaded2.totalQtyG.toString(), "40.5");
    check("pcs now 2", third.remainingQtyPcs, 2);

    console.log("\n=== AC4: a discarded sample cannot be restocked ===");
    let blocked = false;
    try {
      await addStock(discarded.id, 10, admin.id);
    } catch (e) {
      blocked = (e as Error).message === "DISCARDED";
    }
    check("restock rejected on discarded sample", blocked, true);
    const dStock = await stockOf(discarded.id);
    check("discarded sample unchanged", dStock.remainingQtyG, "4.00");
  } finally {
    await prisma.transaction.deleteMany({ where: { sample: { sampleCode: { startsWith: PREFIX } } } });
    await prisma.locationHistory.deleteMany({ where: { sample: { sampleCode: { startsWith: PREFIX } } } });
    await prisma.samplePiece.deleteMany({ where: { sample: { sampleCode: { startsWith: PREFIX } } } });
    await prisma.sample.deleteMany({ where: { sampleCode: { startsWith: PREFIX } } });
    console.log(`\ncleanup done — real samples: ${await prisma.sample.count()}`);
    await prisma.$disconnect();
  }

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}
main();
