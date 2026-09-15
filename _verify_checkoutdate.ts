import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaMssql } from "@prisma/adapter-mssql";
import { parseMssqlUrl } from "./src/lib/mssql-url";
import { CheckoutPieceSchema } from "./src/lib/validation";
import { getCheckoutWarningLevel, daysSinceCheckout } from "./src/lib/stock";

// Manual checkout date: validation, the date -> timestamp rule, and the fact that a
// backdated checkout drives the overdue warning (SLT-57).

let failures = 0;
const check = (label: string, actual: unknown, expected: unknown) => {
  const ok = String(actual) === String(expected);
  if (!ok) failures++;
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${label.padEnd(56)} ${actual}${ok ? "" : `   (expected ${expected})`}`
  );
};

const localDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// Mirrors resolveCheckoutDate() in stock-actions.ts.
function resolveCheckoutDate(input: string | null): Date | null {
  const now = new Date();
  if (!input) return now;
  const [y, m, d] = input.split("-").map(Number);
  const picked = new Date(y, m - 1, d);
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (picked.getTime() > startOfToday.getTime()) return null;
  return picked.getTime() === startOfToday.getTime() ? now : picked;
}

const PREFIX = "ZZ-CODATE-";
const prisma = new PrismaClient({
  adapter: new PrismaMssql(parseMssqlUrl(process.env.DATABASE_URL!)),
});

async function main() {
  const now = new Date();
  const shift = (n: number) => {
    const d = new Date(now);
    d.setDate(d.getDate() + n);
    return localDay(d);
  };

  console.log("=== validation ===");
  const base = { pieceId: "p1", formulatorId: "f1" };
  check("blank date accepted (means today)",
    CheckoutPieceSchema.safeParse({ ...base, checkedOutAt: "" }).success, true);
  check("a real date accepted",
    CheckoutPieceSchema.safeParse({ ...base, checkedOutAt: shift(-10) }).success, true);
  check("garbage rejected",
    CheckoutPieceSchema.safeParse({ ...base, checkedOutAt: "not-a-date" }).success, false);
  check("impossible date rejected",
    CheckoutPieceSchema.safeParse({ ...base, checkedOutAt: "2026-02-31" }).success, false);
  check("formulator still required",
    CheckoutPieceSchema.safeParse({ pieceId: "p1", formulatorId: "", checkedOutAt: "" }).success, false);

  console.log("\n=== date -> stored timestamp ===");
  check("blank -> now", resolveCheckoutDate(null) !== null, true);
  check("tomorrow rejected", resolveCheckoutDate(shift(1)), "null");
  check("a year ahead rejected", resolveCheckoutDate(shift(365)), "null");
  const todayResolved = resolveCheckoutDate(shift(0))!;
  check("today accepted", todayResolved !== null, true);
  // Today keeps the real clock time so same-day checkouts still order correctly.
  check("today keeps the time of day", todayResolved.getHours() === now.getHours(), true);
  const backdated = resolveCheckoutDate(shift(-10))!;
  check("backdated lands at local midnight",
    `${backdated.getHours()}:${backdated.getMinutes()}`, "0:0");
  check("backdated keeps the chosen calendar day", localDay(backdated), shift(-10));

  console.log("\n=== a backdated checkout drives the warning ===");
  for (const [days, expected] of [[0, "NONE"], [5, "NONE"], [9, "NONE"], [10, "WARNING"], [14, "OVERDUE"], [30, "OVERDUE"]] as const) {
    const resolved = resolveCheckoutDate(shift(-days))!;
    check(`checked out ${days} days ago -> ${expected}`, getCheckoutWarningLevel(resolved), expected);
  }

  console.log("\n=== round-trip through the database ===");
  const admin = await prisma.user.findFirstOrThrow({ where: { role: { name: "ADMIN" } } });
  const formulatorRole = await prisma.role.findFirstOrThrow({ where: { name: "FORMULATOR" } });
  const formulator = await prisma.user.create({
    data: { adUsername: PREFIX.toLowerCase() + "f", name: "Date Formulator", roleId: formulatorRole.id, isActive: true },
  });
  const sample = await prisma.sample.create({
    data: {
      sampleCode: PREFIX + "1", rmName: "date sample", category: "Wax", function: "n/a",
      physicalForm: "Solid", source: "Synthetic", supplier: "n/a",
      expiryDate: new Date("2030-01-01"), totalQtyG: 5, shelfLetter: "G", shelfLevel: 3,
      createdById: admin.id,
      pieces: { create: [{ pieceIndex: 1, originalWeightG: "5.00", remainingWeightG: "5.00", status: "IN_STOCK" }] },
    },
    include: { pieces: true },
  });

  try {
    const chosen = resolveCheckoutDate(shift(-12))!;
    await prisma.samplePiece.update({
      where: { id: sample.pieces[0].id },
      data: { status: "CHECKED_OUT", checkedOutToUserId: formulator.id, checkedOutAt: chosen },
    });
    const stored = await prisma.samplePiece.findUniqueOrThrow({ where: { id: sample.pieces[0].id } });

    check("stored date survives the round trip", localDay(stored.checkedOutAt!), shift(-12));
    check("days elapsed", daysSinceCheckout(stored.checkedOutAt), 12);
    check("reads as the orange warning", getCheckoutWarningLevel(stored.checkedOutAt), "WARNING");
  } finally {
    await prisma.transaction.deleteMany({ where: { sample: { sampleCode: { startsWith: PREFIX } } } });
    await prisma.samplePiece.deleteMany({ where: { sample: { sampleCode: { startsWith: PREFIX } } } });
    await prisma.sample.deleteMany({ where: { sampleCode: { startsWith: PREFIX } } });
    await prisma.user.deleteMany({ where: { adUsername: { startsWith: PREFIX.toLowerCase() } } });
    console.log("\ncleanup done");
    await prisma.$disconnect();
  }

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}
main();
