import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaMssql } from "@prisma/adapter-mssql";
import { parseMssqlUrl } from "./src/lib/mssql-url";

// Exercises the two read-only views added after the stock module: the sample page's
// Transaction history section and the dashboard's "pieces currently out" panel. Runs the
// exact queries those pages run, against a throwaway sample, then cleans up.

const prisma = new PrismaClient({
  adapter: new PrismaMssql(parseMssqlUrl(process.env.DATABASE_URL!)),
});

const PREFIX = "ZZ-HISTORY-VERIFY-";
let failures = 0;
const check = (label: string, actual: unknown, expected: unknown) => {
  const ok = String(actual) === String(expected);
  if (!ok) failures++;
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${label.padEnd(50)} ${actual}${ok ? "" : `   (expected ${expected})`}`
  );
};

async function main() {
  const admin = await prisma.user.findFirstOrThrow({ where: { role: { name: "ADMIN" } } });
  const formulatorRole = await prisma.role.findFirstOrThrow({ where: { name: "FORMULATOR" } });

  const formulator = await prisma.user.create({
    data: {
      adUsername: PREFIX.toLowerCase() + "formulator",
      name: "History Formulator",
      roleId: formulatorRole.id,
      isActive: true,
    },
  });

  const sample = await prisma.sample.create({
    data: {
      sampleCode: PREFIX + "1",
      rmName: "history sample",
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
    // Piece 1: out and back with 2 g used. Piece 2: still out.
    await prisma.samplePiece.update({
      where: { id: p1.id },
      data: { status: "CHECKED_OUT", checkedOutToUserId: formulator.id, checkedOutAt: new Date() },
    });
    await prisma.transaction.create({
      data: {
        sampleId: sample.id,
        type: "CHECKOUT",
        quantityG: null,
        performedById: admin.id,
        note: `Piece #1 checked out to ${formulator.name}`,
      },
    });
    await prisma.samplePiece.update({
      where: { id: p1.id },
      data: {
        status: "IN_STOCK",
        remainingWeightG: "3.00",
        checkedOutToUserId: null,
        checkedOutAt: null,
      },
    });
    await prisma.transaction.create({
      data: {
        sampleId: sample.id,
        type: "RETURN_USAGE",
        quantityG: "2.00",
        performedById: admin.id,
        note: `Piece #1 returned by ${formulator.name} — 2.00 g used, 3.00 g left`,
      },
    });
    await prisma.samplePiece.update({
      where: { id: p2.id },
      data: { status: "CHECKED_OUT", checkedOutToUserId: formulator.id, checkedOutAt: new Date() },
    });
    await prisma.transaction.create({
      data: {
        sampleId: sample.id,
        type: "CHECKOUT",
        quantityG: null,
        performedById: admin.id,
        note: `Piece #2 checked out to ${formulator.name}`,
      },
    });

    console.log("\n=== Sample page: Transaction history section ===");
    // Exactly the query in src/app/(app)/library/[id]/page.tsx.
    const history = await prisma.transaction.findMany({
      where: { sampleId: sample.id },
      include: { performedBy: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
    });
    console.table(
      history.map((t) => ({
        type: t.type,
        amount: t.quantityG != null ? `${Number(t.quantityG).toFixed(2)} g` : "—",
        loggedBy: t.performedBy.name,
        note: t.note,
      }))
    );
    check("history rows", history.length, 3);
    check("newest first (desc)", history[0].note?.includes("#2"), true);
    check("CHECKOUT carries no quantity", history[0].quantityG, "null");
    check(
      "usage row carries the amount",
      Number(history.find((t) => t.type === "RETURN_USAGE")!.quantityG).toFixed(2),
      "2.00"
    );
    check("every row names the admin who logged it", history.every((t) => !!t.performedBy.name), true);
    check("notes name the formulator", history.every((t) => t.note!.includes(formulator.name)), true);

    console.log("\n=== Dashboard: pieces currently out ===");
    // Exactly the queries in src/app/(app)/dashboard/page.tsx.
    const checkedOutCount = await prisma.samplePiece.count({ where: { status: "CHECKED_OUT" } });
    const checkedOut = await prisma.samplePiece.findMany({
      where: { status: "CHECKED_OUT" },
      include: {
        sample: { select: { id: true, rmName: true, sampleCode: true } },
        checkedOutToUser: { select: { name: true } },
      },
      orderBy: { checkedOutAt: "desc" },
      take: 10,
    });
    console.table(
      checkedOut.map((p) => ({
        sample: `${p.sample.sampleCode} — ${p.sample.rmName}`,
        piece: `#${p.pieceIndex}`,
        formulator: p.checkedOutToUser?.name ?? "—",
        remaining: `${Number(p.remainingWeightG).toFixed(2)} g`,
      }))
    );
    const mine = checkedOut.filter((p) => p.sample.sampleCode.startsWith(PREFIX));
    check("only piece 2 is out for this sample", mine.length, 1);
    check("it is piece #2", mine[0]?.pieceIndex, 2);
    check("formulator resolved", mine[0]?.checkedOutToUser?.name, formulator.name);
    check("returned piece 1 is NOT listed", mine.some((p) => p.pieceIndex === 1), false);
    check("count matches the listing", checkedOutCount >= mine.length, true);
  } finally {
    await prisma.transaction.deleteMany({ where: { sample: { sampleCode: { startsWith: PREFIX } } } });
    await prisma.samplePiece.deleteMany({ where: { sample: { sampleCode: { startsWith: PREFIX } } } });
    await prisma.sample.deleteMany({ where: { sampleCode: { startsWith: PREFIX } } });
    await prisma.user.deleteMany({ where: { adUsername: { startsWith: PREFIX.toLowerCase() } } });
    console.log("\ncleanup done");
    console.log(`real samples: ${await prisma.sample.count()}, real users: ${await prisma.user.count()}`);
    await prisma.$disconnect();
  }

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}
main();
