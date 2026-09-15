import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaMssql } from "@prisma/adapter-mssql";
import { parseMssqlUrl } from "./src/lib/mssql-url";
import { stockFromPieces, stockLevel, COUNTED_PIECE_STATUSES } from "./src/lib/stock";
import { centsToGrams, toCents } from "./src/lib/pieces";

// The full SLT-56 / SLT-29 lifecycle on one sample with 2 pieces, exercising every state
// transition in one pass. Drives the same logic the server actions do, against real rows,
// and cleans up everything it creates.

const prisma = new PrismaClient({
  adapter: new PrismaMssql(parseMssqlUrl(process.env.DATABASE_URL!)),
});

const PREFIX = "ZZ-STOCK-VERIFY-";
let failures = 0;
const check = (label: string, actual: unknown, expected: unknown) => {
  const ok = String(actual) === String(expected);
  if (!ok) failures++;
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${label.padEnd(52)} ${actual}${ok ? "" : `   (expected ${expected})`}`
  );
};

async function stockOf(sampleId: string) {
  const pieces = await prisma.samplePiece.findMany({
    where: { sampleId },
    select: { remainingWeightG: true, status: true },
  });
  return stockFromPieces(pieces);
}

// Mirrors checkoutPiece() in stock-actions.ts.
async function checkout(pieceId: string, formulatorId: string, adminId: string) {
  const piece = await prisma.samplePiece.findUniqueOrThrow({ where: { id: pieceId } });
  if (piece.status !== "IN_STOCK") throw new Error(`piece #${piece.pieceIndex} is not IN_STOCK`);

  await prisma.$transaction(async (tx) => {
    await tx.samplePiece.update({
      where: { id: pieceId },
      data: { status: "CHECKED_OUT", checkedOutToUserId: formulatorId, checkedOutAt: new Date() },
    });
    await tx.transaction.create({
      data: {
        sampleId: piece.sampleId,
        type: "CHECKOUT",
        quantityG: null,
        performedById: adminId,
        note: `Piece #${piece.pieceIndex} checked out`,
      },
    });
  });
}

// Mirrors logPieceUsage() in stock-actions.ts.
async function logUsage(pieceId: string, amountUsedG: number, adminId: string) {
  const piece = await prisma.samplePiece.findUniqueOrThrow({ where: { id: pieceId } });
  if (piece.status !== "CHECKED_OUT") throw new Error("piece is not checked out");

  const remainingCents = toCents(Number(piece.remainingWeightG));
  const usedCents = toCents(amountUsedG);
  if (usedCents > remainingCents) throw new Error("OVER_LIMIT");

  const leftCents = remainingCents - usedCents;
  await prisma.$transaction(async (tx) => {
    await tx.samplePiece.update({
      where: { id: pieceId },
      data: {
        remainingWeightG: centsToGrams(leftCents),
        status: leftCents === 0 ? "DEPLETED" : "IN_STOCK",
        checkedOutToUserId: null,
        checkedOutAt: null,
      },
    });
    await tx.transaction.create({
      data: {
        sampleId: piece.sampleId,
        type: "RETURN_USAGE",
        quantityG: centsToGrams(usedCents),
        performedById: adminId,
        note: `Piece #${piece.pieceIndex} — ${centsToGrams(usedCents)} g used`,
      },
    });
  });
}

async function main() {
  const admin = await prisma.user.findFirstOrThrow({ where: { role: { name: "ADMIN" } } });
  const formulatorRole = await prisma.role.findFirstOrThrow({ where: { name: "FORMULATOR" } });

  // A dedicated formulator so the test never depends on who happens to exist.
  const formulator = await prisma.user.create({
    data: {
      adUsername: PREFIX.toLowerCase() + "formulator",
      name: "Verify Formulator",
      roleId: formulatorRole.id,
      isActive: true,
    },
  });

  const sample = await prisma.sample.create({
    data: {
      sampleCode: PREFIX + "1",
      rmName: "stock lifecycle sample",
      category: "Wax",
      function: "n/a",
      physicalForm: "Solid",
      source: "Synthetic",
      supplier: "n/a",
      expiryDate: new Date("2030-01-01"),
      totalQtyG: 10,
      receivedQtyPcs: 2,
      shelfLetter: "G",
      shelfLevel: 3,
      createdById: admin.id,
      // pcs = 2, 5 g each.
      pieces: {
        create: [
          { pieceIndex: 1, originalWeightG: "5.00", remainingWeightG: "5.00", status: "IN_STOCK" },
          { pieceIndex: 2, originalWeightG: "5.00", remainingWeightG: "5.00", status: "IN_STOCK" },
        ],
      },
    },
    include: { pieces: { orderBy: { pieceIndex: "asc" } } },
  });
  const [p1, p2] = sample.pieces;

  try {
    console.log("\n=== Start: 2 pieces, 5 g each ===");
    let s = await stockOf(sample.id);
    check("remaining g", s.remainingQtyG, "10.00");
    check("remaining pcs", s.remainingQtyPcs, 2);

    console.log("\n=== SLT-56: check out piece 1 — quantities must NOT move ===");
    await checkout(p1.id, formulator.id, admin.id);
    s = await stockOf(sample.id);
    check("remaining g UNCHANGED", s.remainingQtyG, "10.00");
    check("remaining pcs UNCHANGED", s.remainingQtyPcs, 2);
    const after = await prisma.samplePiece.findUniqueOrThrow({ where: { id: p1.id } });
    check("piece 1 status", after.status, "CHECKED_OUT");
    check("custody recorded", after.checkedOutToUserId, formulator.id);
    check("checkedOutAt set", after.checkedOutAt !== null, true);
    check(
      "CHECKOUT transaction logged",
      await prisma.transaction.count({ where: { sampleId: sample.id, type: "CHECKOUT" } }),
      1
    );
    check(
      "CHECKOUT has no quantity",
      (await prisma.transaction.findFirstOrThrow({ where: { sampleId: sample.id, type: "CHECKOUT" } }))
        .quantityG,
      "null"
    );

    console.log("\n=== Only IN_STOCK pieces are checkoutable ===");
    let rejected = false;
    try {
      await checkout(p1.id, formulator.id, admin.id);
    } catch {
      rejected = true;
    }
    check("re-checkout of a CHECKED_OUT piece rejected", rejected, true);

    console.log("\n=== Over-limit usage is blocked ===");
    let blocked = false;
    try {
      await logUsage(p1.id, 5.01, admin.id);
    } catch (e) {
      blocked = (e as Error).message === "OVER_LIMIT";
    }
    check("logging 5.01 g against 5 g blocked", blocked, true);

    console.log("\n=== SLT-29: partial usage on piece 1 — g drops, pcs holds ===");
    await logUsage(p1.id, 2, admin.id);
    s = await stockOf(sample.id);
    check("remaining g", s.remainingQtyG, "8.00");
    check("remaining pcs UNCHANGED", s.remainingQtyPcs, 2);
    const p1b = await prisma.samplePiece.findUniqueOrThrow({ where: { id: p1.id } });
    check("piece 1 weight", Number(p1b.remainingWeightG).toFixed(2), "3.00");
    check("piece 1 back IN_STOCK", p1b.status, "IN_STOCK");
    check("custody cleared", p1b.checkedOutToUserId, "null");
    check("checkedOutAt cleared", p1b.checkedOutAt, "null");
    check("originalWeightG immutable", Number(p1b.originalWeightG).toFixed(2), "5.00");

    console.log("\n=== 0 g used still logs a transaction and returns the piece ===");
    await checkout(p1.id, formulator.id, admin.id);
    await logUsage(p1.id, 0, admin.id);
    const p1c = await prisma.samplePiece.findUniqueOrThrow({ where: { id: p1.id } });
    check("weight unchanged at 3 g", Number(p1c.remainingWeightG).toFixed(2), "3.00");
    check("status IN_STOCK", p1c.status, "IN_STOCK");
    check("custody cleared", p1c.checkedOutToUserId, "null");
    check(
      "a 0 g RETURN_USAGE row exists",
      await prisma.transaction.count({
        where: { sampleId: sample.id, type: "RETURN_USAGE", quantityG: 0 },
      }),
      1
    );

    console.log("\n=== SLT-29: full usage on piece 2 — g AND pcs both drop ===");
    await checkout(p2.id, formulator.id, admin.id);
    await logUsage(p2.id, 5, admin.id);
    s = await stockOf(sample.id);
    check("remaining g", s.remainingQtyG, "3.00");
    check("remaining pcs DECREASED", s.remainingQtyPcs, 1);
    const p2b = await prisma.samplePiece.findUniqueOrThrow({ where: { id: p2.id } });
    check("piece 2 DEPLETED", p2b.status, "DEPLETED");
    check("piece 2 weight exactly 0", Number(p2b.remainingWeightG).toFixed(2), "0.00");

    console.log("\n=== A DEPLETED piece can't be checked out again ===");
    let depletedRejected = false;
    try {
      await checkout(p2.id, formulator.id, admin.id);
    } catch {
      depletedRejected = true;
    }
    check("checkout of DEPLETED piece rejected", depletedRejected, true);

    console.log("\n=== Counted statuses / stock flags ===");
    check("counted statuses", [...COUNTED_PIECE_STATUSES].join(","), "IN_STOCK,CHECKED_OUT");
    check("3 of 10 g is LOW? (30%)", stockLevel(s, 10), "HEALTHY");
    check("1 of 10 g is LOW (10%)", stockLevel({ remainingQtyG: "1.00", remainingQtyPcs: 1 }, 10), "LOW");
    check("0 g is ZERO", stockLevel({ remainingQtyG: "0.00", remainingQtyPcs: 0 }, 10), "ZERO");

    console.log("\n=== Transaction history ===");
    const txs = await prisma.transaction.findMany({
      where: { sampleId: sample.id },
      orderBy: { createdAt: "asc" },
      select: { type: true, quantityG: true },
    });
    console.table(txs.map((t) => ({ type: t.type, quantityG: t.quantityG?.toString() ?? "—" })));
    check("total transactions", txs.length, 6);
    check("CHECKOUT count", txs.filter((t) => t.type === "CHECKOUT").length, 3);
    check("RETURN_USAGE count", txs.filter((t) => t.type === "RETURN_USAGE").length, 3);
  } finally {
    await prisma.transaction.deleteMany({ where: { sample: { sampleCode: { startsWith: PREFIX } } } });
    await prisma.samplePiece.deleteMany({ where: { sample: { sampleCode: { startsWith: PREFIX } } } });
    const { count } = await prisma.sample.deleteMany({ where: { sampleCode: { startsWith: PREFIX } } });
    await prisma.user.deleteMany({ where: { adUsername: { startsWith: PREFIX.toLowerCase() } } });
    console.log(`\ncleanup: removed ${count} verification sample(s), pieces, transactions and the test user`);
    console.log(`real samples still present: ${await prisma.sample.count()}`);
    console.log(`real users still present: ${await prisma.user.count()}`);
    await prisma.$disconnect();
  }

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}
main();
