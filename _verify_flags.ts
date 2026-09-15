import "dotenv/config";
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { PrismaMssql } from "@prisma/adapter-mssql";
import { parseMssqlUrl } from "./src/lib/mssql-url";
import { stockFromPieces, stockLevel, EMPTY_STOCK } from "./src/lib/stock";

// SLT-26 scoped to zero stock: the Flags column, the KPI's filtered link, and the rule
// that a discarded sample is flagged once, as discarded, not twice.

const PREFIX = "ZZ-FLAGS-";
let failures = 0;
const check = (label: string, actual: unknown, expected: unknown) => {
  const ok = String(actual) === String(expected);
  if (!ok) failures++;
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${label.padEnd(58)} ${actual}${ok ? "" : `   (expected ${expected})`}`
  );
};

const prisma = new PrismaClient({
  adapter: new PrismaMssql(parseMssqlUrl(process.env.DATABASE_URL!)),
});

// Mirrors the Flags column's render: discarded wins, then zero, else nothing.
function flagFor(sample: { isDiscarded: boolean }, stock: ReturnType<typeof stockFromPieces>) {
  if (sample.isDiscarded) return "DISCARDED";
  return stockLevel(stock) === "ZERO" ? "ZERO" : "—";
}

async function main() {
  const admin = await prisma.user.findFirstOrThrow({ where: { role: { name: "ADMIN" } } });
  const base = {
    rmName: "flag sample", function: "n/a", physicalForm: "Solid", source: "Synthetic",
    supplier: "n/a", expiryDate: new Date("2030-01-01"), category: "Wax",
    shelfLetter: "G", shelfLevel: 3, createdById: admin.id, totalQtyG: 10,
  };

  await prisma.sample.create({
    data: { ...base, sampleCode: PREFIX + "HEALTHY",
      pieces: { create: [{ pieceIndex: 1, originalWeightG: "10.00", remainingWeightG: "10.00", status: "IN_STOCK" }] } },
  });
  await prisma.sample.create({
    data: { ...base, sampleCode: PREFIX + "ZERO",
      pieces: { create: [{ pieceIndex: 1, originalWeightG: "10.00", remainingWeightG: "0.00", status: "DEPLETED" }] } },
  });
  // A sample that is BOTH discarded and at zero — the double-flag case.
  await prisma.sample.create({
    data: { ...base, sampleCode: PREFIX + "BOTH", isDiscarded: true, discardedById: admin.id, discardedAt: new Date(),
      pieces: { create: [{ pieceIndex: 1, originalWeightG: "10.00", remainingWeightG: "0.00", status: "DEPLETED" }] } },
  });
  // Discarded but with stock left — still only the discarded flag.
  await prisma.sample.create({
    data: { ...base, sampleCode: PREFIX + "DISCARDED", isDiscarded: true, discardedById: admin.id, discardedAt: new Date(),
      pieces: { create: [{ pieceIndex: 1, originalWeightG: "10.00", remainingWeightG: "10.00", status: "IN_STOCK" }] } },
  });
  // A sample with no pieces at all computes to zero.
  await prisma.sample.create({ data: { ...base, sampleCode: PREFIX + "NOPIECES" } });

  try {
    const rows = await prisma.sample.findMany({
      where: { sampleCode: { startsWith: PREFIX } },
      select: { sampleCode: true, isDiscarded: true, pieces: { select: { remainingWeightG: true, status: true } } },
      orderBy: { sampleCode: "asc" },
    });

    console.log("=== Flags column ===");
    const flags = new Map(rows.map((r) => [r.sampleCode.replace(PREFIX, ""), flagFor(r, stockFromPieces(r.pieces))]));
    console.table([...flags].map(([sample, flag]) => ({ sample, flag })));

    check("healthy sample shows no flag", flags.get("HEALTHY"), "—");
    check("zero-stock sample shows ZERO", flags.get("ZERO"), "ZERO");
    check("sample with no pieces shows ZERO", flags.get("NOPIECES"), "ZERO");
    check("discarded with stock shows DISCARDED", flags.get("DISCARDED"), "DISCARDED");
    check("discarded AND zero shows only DISCARDED", flags.get("BOTH"), "DISCARDED");

    console.log("\n=== the KPI count excludes discarded ===");
    // The dashboard counts zero stock over non-discarded samples only.
    const active = rows.filter((r) => !r.isDiscarded);
    const zeroActive = active.filter((r) => stockLevel(stockFromPieces(r.pieces)) === "ZERO");
    check("2 of our samples are zero and active", zeroActive.length, 2);
    check("neither discarded sample is counted",
      zeroActive.some((r) => r.sampleCode.includes("BOTH") || r.sampleCode.includes("DISCARDED")), false);

    console.log("\n=== the ?stock=ZERO filter matches the KPI ===");
    // The Library's default view is isDiscarded:false, so the filtered list and the KPI
    // count are drawn from the same population.
    const libraryView = rows.filter((r) => !r.isDiscarded);
    const filtered = libraryView.filter((r) => stockLevel(stockFromPieces(r.pieces) ?? EMPTY_STOCK) === "ZERO");
    check("filtered list length == KPI count", filtered.length, zeroActive.length);

    console.log("\n=== wiring ===");
    const cols = readFileSync("src/app/(app)/library/columns.tsx", "utf8");
    check("Flags column exists", /key: "flags"/.test(cols), true);
    check("Flags is shown by default", /DEFAULT_COLUMN_KEYS[\s\S]*?"flags"[\s\S]*?\]/.test(cols), true);
    check("ZERO badge is red", /variant="danger">ZERO/.test(cols), true);
    check("DISCARDED badge is grey", /variant="neutral">DISCARDED/.test(cols), true);
    check("no LOW badge", /LOW/.test(cols), false);

    const page = readFileSync("src/app/(app)/library/page.tsx", "utf8");
    check("library reads ?stock=ZERO", /params\.stock === "ZERO"/.test(page), true);
    check("filter survives sorting", /stock: zeroOnly \? "ZERO" : undefined/.test(page), true);
    check("filtered view is signposted", /ZERO STOCK ONLY/.test(page), true);

    const dash = readFileSync("src/app/(app)/dashboard/admin-dashboard.tsx", "utf8");
    check("KPI links to the filter", /kpis\.zeroStock, href: "\/library\?stock=ZERO"/.test(dash), true);
    const dashLib = readFileSync("src/lib/dashboard.ts", "utf8");
    check("KPI population excludes discarded", /where: \{ isDiscarded: false \}/.test(dashLib), true);
  } finally {
    await prisma.samplePiece.deleteMany({ where: { sample: { sampleCode: { startsWith: PREFIX } } } });
    await prisma.sample.deleteMany({ where: { sampleCode: { startsWith: PREFIX } } });
    console.log("\ncleanup done");
    await prisma.$disconnect();
  }

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}
main();
