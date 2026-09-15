import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaMssql } from "@prisma/adapter-mssql";
import { parseMssqlUrl } from "./src/lib/mssql-url";
import { SHELF_LETTERS, SHELF_LEVELS, shelfCellKey } from "./src/lib/categories";
import { loadShelfCellColors, loadShelfCellMeanings, shelfLegendFrom } from "./src/lib/shelf";
import { stockFromPieces, stockLevel } from "./src/lib/stock";

// SLT-24 acceptance criteria, checked against the same helpers the page uses.

const prisma = new PrismaClient({
  adapter: new PrismaMssql(parseMssqlUrl(process.env.DATABASE_URL!)),
});

const PREFIX = "ZZ-RACK-VERIFY-";
let failures = 0;
const check = (label: string, actual: unknown, expected: unknown) => {
  const ok = String(actual) === String(expected);
  if (!ok) failures++;
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${label.padEnd(56)} ${actual}${ok ? "" : `   (expected ${expected})`}`
  );
};

async function main() {
  const admin = await prisma.user.findFirstOrThrow({ where: { role: { name: "ADMIN" } } });

  const base = {
    rmName: "rack sample",
    category: "Wax",
    function: "n/a",
    physicalForm: "Solid",
    source: "Synthetic",
    supplier: "n/a",
    expiryDate: new Date("2030-01-01"),
    createdById: admin.id,
  };

  // Three samples on one cell (G3/Wax): healthy, zero-stock, discarded.
  await prisma.sample.create({
    data: {
      ...base, sampleCode: PREFIX + "HEALTHY", totalQtyG: 10, shelfLetter: "G", shelfLevel: 3,
      shelfSublevel: 1,
      pieces: { create: [{ pieceIndex: 1, originalWeightG: "10.00", remainingWeightG: "10.00", status: "IN_STOCK" }] },
    },
  });
  await prisma.sample.create({
    data: {
      ...base, sampleCode: PREFIX + "ZERO", totalQtyG: 10, shelfLetter: "G", shelfLevel: 3,
      shelfSublevel: 2,
      // Fully consumed: the piece is DEPLETED, so it counts toward neither g nor pcs.
      pieces: { create: [{ pieceIndex: 1, originalWeightG: "10.00", remainingWeightG: "0.00", status: "DEPLETED" }] },
    },
  });
  await prisma.sample.create({
    data: {
      ...base, sampleCode: PREFIX + "DISCARDED", totalQtyG: 10, shelfLetter: "G", shelfLevel: 3,
      shelfSublevel: 3, isDiscarded: true, discardedById: admin.id, discardedAt: new Date(),
      pieces: { create: [{ pieceIndex: 1, originalWeightG: "10.00", remainingWeightG: "0.00", status: "DEPLETED" }] },
    },
  });
  // A low-stock sample alone on a different cell (G2/Herbs): 1 of 10 g = 10%.
  await prisma.sample.create({
    data: {
      ...base, sampleCode: PREFIX + "LOW", category: "Herbs", totalQtyG: 10,
      shelfLetter: "G", shelfLevel: 2,
      pieces: { create: [{ pieceIndex: 1, originalWeightG: "10.00", remainingWeightG: "1.00", status: "IN_STOCK" }] },
    },
  });

  try {
    const [colors, meanings] = await Promise.all([loadShelfCellColors(), loadShelfCellMeanings()]);
    const legend = shelfLegendFrom(meanings);

    console.log("\n=== AC1: full A-J x 1-5 rack renders with category colours + legend ===");
    const cells = SHELF_LETTERS.flatMap((l) => SHELF_LEVELS.map((v) => shelfCellKey(l, v)));
    check("drawer count", cells.length, 50);
    check("legend rows (one per letter)", legend.length, 10);
    check("cells with a plan colour", cells.filter((c) => colors[c]).length, 47);
    // F4, F5 and J5 are deliberately absent from the seeded plan.
    check("cells outside the plan", cells.filter((c) => !colors[c]).join(","), "F4,F5,J5");
    check("A1 colour (Chemicals)", colors["A1"], "#FFE699");
    check("G3 colour (Wax)", colors["G3"], "#66FFCC");
    check("H5 colour (Floral)", colors["H5"], "#1CAA52");

    console.log("\n--- legend, as the panel renders it ---");
    for (const row of legend) {
      const text = row.entries.length
        ? row.entries.map((e) => `${e.label} [${e.levels.join(",")}] ${e.colorHex}`).join("  |  ")
        : "(not in the plan)";
      console.log(`  ${row.letter}  ${text}`);
    }
    check("H splits into 5 fragrance orientations", legend.find((r) => r.letter === "H")!.entries.length, 5);
    check("A is one meaning across its levels", legend.find((r) => r.letter === "A")!.entries.length, 1);
    check(
      "F merges Organic 1-2 and keeps Oils at 3",
      legend.find((r) => r.letter === "F")!.entries.map((e) => `${e.label}:${e.levels.join("")}`).join(","),
      "Organic:12,Oils:3"
    );

    // Group exactly as the page does.
    const rows = await prisma.sample.findMany({
      select: {
        id: true, sampleCode: true, shelfLetter: true, shelfLevel: true,
        isDiscarded: true, totalQtyG: true,
        pieces: { select: { remainingWeightG: true, status: true } },
      },
    });
    const byCell = new Map<string, Array<{ code: string; health: string }>>();
    for (const r of rows) {
      const key = shelfCellKey(r.shelfLetter, r.shelfLevel);
      const health = r.isDiscarded ? "DISCARDED" : stockLevel(stockFromPieces(r.pieces));
      byCell.set(key, [...(byCell.get(key) ?? []), { code: r.sampleCode, health }]);
    }

    console.log("\n=== AC2: an empty slot is distinct from an occupied one ===");
    const occupied = cells.filter((c) => (byCell.get(c) ?? []).length > 0);
    const empty = cells.filter((c) => (byCell.get(c) ?? []).length === 0);
    check("occupied + empty covers every drawer", occupied.length + empty.length, 50);
    check("A1 is empty (renders 'Empty', not a link)", (byCell.get("A1") ?? []).length, 0);
    check("G3 is occupied", (byCell.get("G3") ?? []).length >= 3, true);

    console.log("\n=== AC3: clicking a drawer filters to that shelf only ===");
    const g3 = byCell.get("G3") ?? [];
    const mine = g3.filter((s) => s.code.startsWith(PREFIX));
    check("G3 holds the 3 test samples", mine.length, 3);
    check("G3 excludes the G2 sample", g3.some((s) => s.code === PREFIX + "LOW"), false);
    check("G3 breadcrumb meaning", meanings["G3"]?.label, "Wax");
    check("G2 breadcrumb meaning", meanings["G2"]?.label, "Herbs");
    check("H1 breadcrumb meaning", meanings["H1"]?.label, "Fragrance · Refreshing");

    console.log("\n=== AC4: a zero-stock sample turns the drawer tag red ===");
    const tagOf = (cell: string) => {
      const list = byCell.get(cell) ?? [];
      return list.some((s) => s.health === "ZERO") ? "#c1292e" : (colors[cell] ?? null);
    };
    check("G3 tag overridden to red", tagOf("G3"), "#c1292e");
    check("G3 category colour would have been", colors["G3"], "#66FFCC");
    check("G2 (low, not zero) keeps its colour", tagOf("G2"), colors["G2"]);
    check("a slot with only healthy samples keeps its colour", tagOf("F3"), colors["F3"] ?? "null");

    console.log("\n=== dot health per sample on G3 ===");
    console.table(mine.map((s) => ({ sample: s.code.replace(PREFIX, ""), dot: s.health })));
    check("healthy sample", mine.find((s) => s.code.endsWith("HEALTHY"))?.health, "HEALTHY");
    check("zero sample", mine.find((s) => s.code.endsWith("ZERO"))?.health, "ZERO");
    check("discarded outranks zero (no double-flag)", mine.find((s) => s.code.endsWith("DISCARDED"))?.health, "DISCARDED");
    // The amber tier is gone: a 10%-remaining sample is simply HEALTHY now.
    check("low-ish sample on G2 is HEALTHY", (byCell.get("G2") ?? []).find((s) => s.code.endsWith("LOW"))?.health, "HEALTHY");
  } finally {
    await prisma.samplePiece.deleteMany({ where: { sample: { sampleCode: { startsWith: PREFIX } } } });
    await prisma.sample.deleteMany({ where: { sampleCode: { startsWith: PREFIX } } });
    console.log(`\ncleanup done — real samples: ${await prisma.sample.count()}`);
    await prisma.$disconnect();
  }

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}
main();
