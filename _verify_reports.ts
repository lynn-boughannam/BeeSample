import "dotenv/config";
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { PrismaMssql } from "@prisma/adapter-mssql";
import { parseMssqlUrl } from "./src/lib/mssql-url";
import {
  loadLibraryStatusReport,
  loadExpiryReport,
  loadCategoryReport,
  locationCategoryLabel,
  stockVersusUseFindings,
  subcategoryOf,
} from "./src/lib/reports";

// Admin reports. Requires --conditions=react-server for the server-only marker.

let failures = 0;
const check = (label: string, actual: unknown, expected: unknown) => {
  const ok = String(actual) === String(expected);
  if (!ok) failures++;
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${label.padEnd(60)} ${actual}${ok ? "" : `   (expected ${expected})`}`
  );
};

const prisma = new PrismaClient({
  adapter: new PrismaMssql(parseMssqlUrl(process.env.DATABASE_URL!)),
});

async function main() {
  console.log("=== pure helpers ===");
  check("Natural claims its zone whatever the category",
    locationCategoryLabel("Natural", "Wax", null), "Natural");
  check("Organic claims its zone", locationCategoryLabel("Organic", "Oils", null), "Organic");
  check("a fragrance is labelled by orientation",
    locationCategoryLabel("Synthetic", "Fragrance", "Men"), "Men-Fragrance");
  check("a non-fragrance uses its category",
    locationCategoryLabel("Synthetic", "Wax", null), "Wax");
  // Older rows store an orientation in the category column. Both spellings of the same
  // shelf zone must land in one bucket, or the chart double-counts it.
  check("legacy orientation-as-category matches the proper form",
    locationCategoryLabel("Synthetic", "Woody", null),
    locationCategoryLabel("Synthetic", "Fragrance", "Woody"));
  check("a canonical orientation stored as a category is recognised",
    locationCategoryLabel("sDGGD", "Woody", null), "Woody-Fragrance");
  // "Nut" is not in the taxonomy — the canonical value is "Nuts". An unrecognised value is
  // left as-is rather than guessed at; see the data-quality note in the report findings.
  check("an unrecognised value is not forced into a zone",
    locationCategoryLabel("sDGGD", "Nut", null), "Nut");

  check("fragrance splits by orientation",
    subcategoryOf({ category: "Fragrance", subcategory1: "x", fragranceOrientation: "Woody" }), "Woody");
  check("other categories split by subcategory1",
    subcategoryOf({ category: "Chemicals", subcategory1: "Powder", fragranceOrientation: null }), "Powder");
  check("missing subdivision still buckets",
    subcategoryOf({ category: "Wax", subcategory1: null, fragranceOrientation: null }), "Unspecified");

  console.log("\n=== stock-versus-use ranking ===");
  // Big holdings that barely convert, against small ones that do.
  const rows = [
    { label: "Hoarded", count: 100, usedCount: 2, usedPercent: 2 },
    { label: "AlsoHoarded", count: 80, usedCount: 3, usedPercent: 3.75 },
    { label: "Middling", count: 40, usedCount: 8, usedPercent: 20 },
    { label: "Worked", count: 10, usedCount: 8, usedPercent: 80 },
    { label: "AlsoWorked", count: 8, usedCount: 6, usedPercent: 75 },
  ];
  const found = stockVersusUseFindings(rows);
  console.log("  over-stocked:", found.overStocked.join(", "));
  console.log("  under-stocked:", found.underStocked.join(", "));
  check("the big low-use holdings surface", found.overStocked.includes("Hoarded"), true);
  check("the small high-use ones surface as the opposite", found.underStocked.includes("Worked"), true);
  check("a worked subcategory isn't called over-stocked", found.overStocked.includes("Worked"), false);

  // A single sample used once is a 100% rate and would otherwise dominate.
  const noisy = stockVersusUseFindings([
    { label: "Tiny", count: 1, usedCount: 1, usedPercent: 100 },
    { label: "Big", count: 50, usedCount: 1, usedPercent: 2 },
    { label: "Mid", count: 20, usedCount: 4, usedPercent: 20 },
  ]);
  check("a 1-sample subcategory is excluded as noise", noisy.underStocked.includes("Tiny"), false);
  check("too few eligible subcategories yields no claim",
    stockVersusUseFindings([{ label: "Only", count: 9, usedCount: 1, usedPercent: 11 }]).overStocked.length, 0);

  console.log("\n=== against the real library ===");
  const library = await loadLibraryStatusReport();
  console.log(`  ${library.total} samples · ${library.available.count} available · ${library.empty.count} empty · ${library.usedByFormulators.count} used`);
  check("available + empty accounts for the library",
    library.available.count + library.empty.count, library.total);
  check("percentages sum to 100",
    Math.round(library.available.percent + library.empty.percent), 100);
  check("discarded samples are out of scope",
    library.total, await prisma.sample.count({ where: { isDiscarded: false } }));
  check("category slices don't exceed the total",
    library.byCategory.reduce((n, s) => n + s.count, 0) <= library.total, true);
  console.table(library.topLocationCategories.map((s) => ({ location: s.label, count: s.count, pct: s.percent.toFixed(1) })));

  console.log("\n=== expiry report ===");
  const expiry = await loadExpiryReport({ from: null, to: null }, 2019);
  console.log(`  ${expiry.expired.count} expired of ${expiry.total} · cohorts ${expiry.olderTotal}/${expiry.recentTotal}`);
  check("cohorts partition the scope", expiry.olderTotal + expiry.recentTotal, expiry.total);
  check("cohort bars sum to the cohort totals",
    expiry.cohorts.reduce((n, c) => n + c.olderCount + c.recentCount, 0), expiry.total);
  check("the split year is what was asked for", expiry.splitYear, 2019);

  // A different split must move samples between cohorts, not invent or lose them.
  const other = await loadExpiryReport({ from: null, to: null }, 2000);
  check("a different split still partitions the same total", other.olderTotal + other.recentTotal, other.total);
  check("an early split puts everything in the recent cohort", other.olderTotal, 0);

  console.log("\n=== category deep-dive ===");
  const deep = await loadCategoryReport("Fragrance", { from: null, to: null });
  console.log(`  Fragrance: ${deep.total} of ${deep.libraryTotal} (${deep.shareOfLibrary.toFixed(1)}%), ${deep.used.count} used`);
  check("subcategory counts sum to the category total",
    deep.subcategories.reduce((n, s) => n + s.count, 0), deep.total);
  check("sorted biggest first",
    deep.subcategories.every((s, i) => i === 0 || deep.subcategories[i - 1].count >= s.count), true);
  check("used never exceeds held",
    deep.subcategories.every((s) => s.usedCount <= s.count), true);
  check("share of library is consistent",
    Math.round(deep.shareOfLibrary), Math.round((deep.total / deep.libraryTotal) * 100));

  console.log("\n=== scope: what is deliberately absent ===");
  const lib = readFileSync("src/lib/reports.ts", "utf8");
  check("no cost reporting invented", /cost|price/i.test(lib.replace(/^\s*\/\/.*$/gm, "")), false);
  const expiryPage = readFileSync("src/app/(app)/reports/expiry/page.tsx", "utf8");
  check("the missing disposal half is stated on the page", /not in this report/.test(expiryPage), true);
  const navSrc = readFileSync("src/lib/nav.ts", "utf8");
  check("Reports is admin-only", /key: "reports".*roles: \["ADMIN"\]/.test(navSrc), true);
  for (const page of ["library", "expiry", "category"]) {
    check(`${page} report is admin-gated`,
      /requireAdmin\(\)/.test(readFileSync(`src/app/(app)/reports/${page}/page.tsx`, "utf8")), true);
  }

  await prisma.$disconnect();
  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}
main();
