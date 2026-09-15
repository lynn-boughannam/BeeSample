import "dotenv/config";
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { PrismaMssql } from "@prisma/adapter-mssql";
import { parseMssqlUrl } from "./src/lib/mssql-url";
import { shelfAddress } from "./src/lib/categories";

// SLT-57 acceptance criteria. Runs the page's own queries, plus a static check that the
// page really is action-free (AC4 is about what ISN'T there, which no query can prove).

const prisma = new PrismaClient({
  adapter: new PrismaMssql(parseMssqlUrl(process.env.DATABASE_URL!)),
});

const PREFIX = "ZZ-MYCO-VERIFY-";
let failures = 0;
const check = (label: string, actual: unknown, expected: unknown) => {
  const ok = String(actual) === String(expected);
  if (!ok) failures++;
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${label.padEnd(54)} ${actual}${ok ? "" : `   (expected ${expected})`}`
  );
};

// The two queries in src/app/(app)/my-checkouts/page.tsx.
const loadCurrent = (userId: string) =>
  prisma.samplePiece.findMany({
    where: { status: "CHECKED_OUT", checkedOutToUserId: userId },
    include: {
      sample: {
        select: {
          id: true, sampleCode: true, rmName: true,
          shelfLetter: true, shelfLevel: true, shelfSublevel: true,
        },
      },
    },
    orderBy: { checkedOutAt: "desc" },
  });

const loadHistory = (userId: string) =>
  prisma.transaction.findMany({
    where: { type: "RETURN_USAGE", subjectUserId: userId },
    include: {
      sample: { select: { id: true, sampleCode: true, rmName: true } },
      piece: { select: { pieceIndex: true, status: true } },
    },
    orderBy: { createdAt: "desc" },
  });

async function main() {
  const admin = await prisma.user.findFirstOrThrow({ where: { role: { name: "ADMIN" } } });
  const formulatorRole = await prisma.role.findFirstOrThrow({ where: { name: "FORMULATOR" } });

  const me = await prisma.user.create({
    data: { adUsername: PREFIX.toLowerCase() + "me", name: "Verify Me", roleId: formulatorRole.id, isActive: true },
  });
  const other = await prisma.user.create({
    data: { adUsername: PREFIX.toLowerCase() + "other", name: "Verify Other", roleId: formulatorRole.id, isActive: true },
  });

  try {
    console.log("=== AC3: nothing ever checked out → empty state ===");
    check("current is empty", (await loadCurrent(me.id)).length, 0);
    check("history is empty", (await loadHistory(me.id)).length, 0);

    const sample = await prisma.sample.create({
      data: {
        sampleCode: PREFIX + "1", rmName: "my checkout sample", category: "Wax",
        function: "n/a", physicalForm: "Solid", source: "Synthetic", supplier: "n/a",
        expiryDate: new Date("2030-01-01"), totalQtyG: 20, receivedQtyPcs: 3,
        shelfLetter: "G", shelfLevel: 3, shelfSublevel: 2, createdById: admin.id,
        pieces: { create: [
          { pieceIndex: 1, originalWeightG: "5.00", remainingWeightG: "5.00", status: "IN_STOCK" },
          { pieceIndex: 2, originalWeightG: "5.00", remainingWeightG: "5.00", status: "IN_STOCK" },
          { pieceIndex: 3, originalWeightG: "5.00", remainingWeightG: "5.00", status: "IN_STOCK" },
        ] },
      },
      include: { pieces: { orderBy: { pieceIndex: "asc" } } },
    });
    const [p1, p2, p3] = sample.pieces;

    // Piece 1 → me, still out.
    await prisma.samplePiece.update({
      where: { id: p1.id },
      data: { status: "CHECKED_OUT", checkedOutToUserId: me.id, checkedOutAt: new Date("2026-09-13") },
    });
    // Piece 2 → me, partially used and returned to stock.
    await prisma.samplePiece.update({
      where: { id: p2.id },
      data: { status: "IN_STOCK", remainingWeightG: "3.00" },
    });
    await prisma.transaction.create({
      data: {
        sampleId: sample.id, type: "RETURN_USAGE", quantityG: "2.00",
        performedById: admin.id, subjectUserId: me.id, pieceId: p2.id,
        note: "Piece #2 returned — 2.00 g used", createdAt: new Date("2026-09-12"),
      },
    });
    // Piece 3 → the OTHER formulator, fully used. Must never show under mine.
    await prisma.samplePiece.update({
      where: { id: p3.id },
      data: { status: "DEPLETED", remainingWeightG: "0.00" },
    });
    await prisma.transaction.create({
      data: {
        sampleId: sample.id, type: "RETURN_USAGE", quantityG: "5.00",
        performedById: admin.id, subjectUserId: other.id, pieceId: p3.id,
        note: "Piece #3 returned — 5.00 g used", createdAt: new Date("2026-09-12"),
      },
    });

    console.log("\n=== AC1: currently with me ===");
    const current = await loadCurrent(me.id);
    console.table(current.map((c) => ({
      sample: c.sample.sampleCode,
      shelf: shelfAddress(c.sample.shelfLetter, c.sample.shelfLevel, c.sample.shelfSublevel),
      piece: `#${c.pieceIndex}`,
      g: Number(c.remainingWeightG).toFixed(2),
      since: c.checkedOutAt?.toISOString().slice(0, 10),
    })));
    check("one piece currently with me", current.length, 1);
    check("sample code shown", current[0]?.sample.sampleCode, PREFIX + "1");
    check("shelf location shown", shelfAddress(current[0].sample.shelfLetter, current[0].sample.shelfLevel, current[0].sample.shelfSublevel), "G3-2");
    check("piece weight shown", Number(current[0].remainingWeightG).toFixed(2), "5.00");
    check("checkout date shown", current[0].checkedOutAt?.toISOString().slice(0, 10), "2026-09-13");

    console.log("\n=== AC2: history of usage logged against me ===");
    const history = await loadHistory(me.id);
    console.table(history.map((h) => ({
      sample: h.sample.sampleCode, piece: `#${h.piece?.pieceIndex}`,
      used: `${Number(h.quantityG).toFixed(2)} g`,
      pieceNow: h.piece?.status, date: h.createdAt.toISOString().slice(0, 10),
    })));
    check("one history entry", history.length, 1);
    check("amount used shown", Number(history[0].quantityG).toFixed(2), "2.00");
    check("date logged shown", history[0].createdAt.toISOString().slice(0, 10), "2026-09-12");
    check("piece resolved", history[0].piece?.pieceIndex, 2);
    check("returned-to-stock outcome", history[0].piece?.status, "IN_STOCK");

    console.log("\n=== isolation: another formulator's activity stays theirs ===");
    check("my history excludes piece #3", history.some((h) => h.piece?.pieceIndex === 3), false);
    const theirs = await loadHistory(other.id);
    check("their history has piece #3", theirs.some((h) => h.piece?.pieceIndex === 3), true);
    check("their history excludes mine", theirs.some((h) => h.piece?.pieceIndex === 2), false);
    check("my current excludes their pieces", (await loadCurrent(other.id)).length, 0);

    console.log("\n=== AC4: the page is entirely read-only ===");
    const src = readFileSync("src/app/(app)/my-checkouts/page.tsx", "utf8");
    check("no <form>", /<form[\s>]/.test(src), false);
    check("no <button>", /<button[\s>]/.test(src), false);
    check("no Button component", /<Button[\s>]/.test(src), false);
    check("no server action import", /stock-actions|useActionState|"use server"/.test(src), false);
    check("no input controls", /<Input[\s>]|<Select[\s>]|<input[\s>]/.test(src), false);
    check("not a client component", /"use client"/.test(src), false);

    console.log("\n=== backfilled real history is visible ===");
    const makki = await prisma.user.findFirst({ where: { name: "Mohammad.Makki" } });
    if (makki) {
      const real = await loadHistory(makki.id);
      console.table(real.map((h) => ({
        sample: h.sample.sampleCode, used: `${Number(h.quantityG).toFixed(2)} g`,
        date: h.createdAt.toISOString().slice(0, 10),
      })));
      check("real formulator has recoverable history", real.length > 0, true);
    }
  } finally {
    await prisma.transaction.deleteMany({ where: { sample: { sampleCode: { startsWith: PREFIX } } } });
    await prisma.samplePiece.deleteMany({ where: { sample: { sampleCode: { startsWith: PREFIX } } } });
    await prisma.sample.deleteMany({ where: { sampleCode: { startsWith: PREFIX } } });
    await prisma.user.deleteMany({ where: { adUsername: { startsWith: PREFIX.toLowerCase() } } });
    console.log(`\ncleanup done — samples: ${await prisma.sample.count()}, users: ${await prisma.user.count()}`);
    await prisma.$disconnect();
  }

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}
main();
