import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaMssql } from "@prisma/adapter-mssql";
import { parseMssqlUrl } from "./src/lib/mssql-url";
import { assignSublevel, shelfAddress } from "./src/lib/categories";

const prisma = new PrismaClient({
  adapter: new PrismaMssql(parseMssqlUrl(process.env.DATABASE_URL!)),
});

// Mirrors cellOccupancyAt() from src/lib/shelf.ts against this script's own client.
async function cellOccupancyAt(letter: string, level: number, excludeSampleId?: string) {
  const rows = await prisma.sample.findMany({
    where: {
      shelfLetter: letter, shelfLevel: level, isDiscarded: false,
      ...(excludeSampleId ? { id: { not: excludeSampleId } } : {}),
    },
    select: { shelfSublevel: true },
  });
  return {
    total: rows.length,
    sublevels: rows.map((r) => r.shelfSublevel).filter((s): s is string => s != null),
  };
}

const PREFIX = "ZZ-SLT19-VERIFY-";
let failures = 0;
const check = (label: string, actual: unknown, expected: unknown) => {
  const ok = String(actual) === String(expected);
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label.padEnd(52)} ${actual}${ok ? "" : `   (expected ${expected})`}`);
};

async function createAt(code: string, letter: string, level: number, userId: string) {
  // Exactly what the create action does: None unless the cell already holds something.
  const assigned = assignSublevel(await cellOccupancyAt(letter, level));
  if (assigned.kind === "full") throw new Error(letter + level + " is full");
  const sublevel = assigned.kind === "letter" ? assigned.sublevel : null;
  await prisma.sample.create({
    data: {
      sampleCode: PREFIX + code, rmName: "verification row", category: "Wax",
      function: "n/a", physicalForm: "Solid", source: "Synthetic", supplier: "n/a",
      expiryDate: new Date("2030-01-01"), totalQtyG: 1,
      shelfLetter: letter, shelfLevel: level, shelfSublevel: sublevel,
      createdById: userId,
    },
  });
  return sublevel === null ? "None" : sublevel;
}

async function main() {
  const user = await prisma.user.findFirst({ select: { id: true } });
  if (!user) throw new Error("no user to attribute the verification rows to");

  try {
    console.log("\n=== A cell's first sample gets no sublevel ===");
    check("1st sample into A1", await createAt("1", "A", 1, user.id), "None");
    check("2nd sample into A1", await createAt("2", "A", 1, user.id), "a");
    check("3rd sample into A1", await createAt("3", "A", 1, user.id), "b");
    check("a different cell starts over", await createAt("4", "B", 3, user.id), "None");

    const addresses = (
      await prisma.sample.findMany({
        where: { sampleCode: { startsWith: PREFIX } },
        select: { shelfLetter: true, shelfLevel: true, shelfSublevel: true },
        orderBy: { sampleCode: "asc" },
      })
    ).map((s) => shelfAddress(s.shelfLetter, s.shelfLevel, s.shelfSublevel));
    console.log("stored addresses:", addresses.join(", "));
    check("all four addresses distinct", new Set(addresses).size, 4);

    console.log("\n=== Pre-SLT-19 rows still occupy their cell ===");
    // Two samples predating SLT-19 sit at J2 with shelfSublevel = null.
    const j2 = await cellOccupancyAt("J", 2);
    check("J2 occupants", j2.total, 2);
    check("J2 lettered occupants", j2.sublevels.length, 0);
    const j2next = assignSublevel(j2);
    check("a new J2 sample takes a letter", j2next.kind === "letter" ? j2next.sublevel : j2next.kind, "a");

    console.log("\n=== Discarding frees the space back up ===");
    const first = await prisma.sample.findFirst({ where: { sampleCode: PREFIX + "1" }, select: { id: true } });
    await prisma.sample.update({
      where: { id: first!.id },
      data: { isDiscarded: true, discardReason: "verification", discardedAt: new Date() },
    });
    const afterDiscard = await cellOccupancyAt("A", 1);
    check("A1 occupants after discarding the unlettered one", afterDiscard.total, 2);
    check("A1 letters still held", afterDiscard.sublevels.sort().join(","), "a,b");

    console.log("\n=== Editing a sample doesn't collide with itself ===");
    const second = await prisma.sample.findFirst({ where: { sampleCode: PREFIX + "2" }, select: { id: true } });
    const excludingSelf = await cellOccupancyAt("A", 1, second!.id);
    check("A1 excluding itself", excludingSelf.sublevels.join(","), "b");

  } finally {
    const { count } = await prisma.sample.deleteMany({ where: { sampleCode: { startsWith: PREFIX } } });
    console.log(`\ncleanup: removed ${count} verification rows`);
    const left = await prisma.sample.count({ where: { sampleCode: { startsWith: PREFIX } } });
    console.log(`verification rows remaining: ${left}`);
    console.log(`real samples still present: ${await prisma.sample.count()}`);
    await prisma.$disconnect();
  }

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}
main();
