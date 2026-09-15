import "dotenv/config";
import { readFileSync } from "node:fs";
import {
  CHECKOUT_ROW_CLASS,
  stockLevel,
  getCheckoutWarningLevel,
  daysSinceCheckout,
  CHECKOUT_WARNING_CLASS,
  CHECKOUT_WARNING_DAYS,
  CHECKOUT_OVERDUE_DAYS,
} from "./src/lib/stock";
import { shelfAddress, assignSublevel, nextFreeSublevel, SHELF_SUBLEVELS } from "./src/lib/categories";

// The four 2026-09-15 sprint-review changes.

let failures = 0;
const check = (label: string, actual: unknown, expected: unknown) => {
  const ok = String(actual) === String(expected);
  if (!ok) failures++;
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${label.padEnd(58)} ${actual}${ok ? "" : `   (expected ${expected})`}`
  );
};

function main() {
  console.log("=== 1. Low Stock removed: two states only ===");
  // 1 g of a 10 g sample was LOW under the old 15% rule; it must now read HEALTHY.
  check("1 g remaining (was LOW at 10%)", stockLevel({ remainingQtyG: "1.00", remainingQtyPcs: 1 }), "HEALTHY");
  check("0.01 g remaining", stockLevel({ remainingQtyG: "0.01", remainingQtyPcs: 1 }), "HEALTHY");
  check("0 g remaining", stockLevel({ remainingQtyG: "0.00", remainingQtyPcs: 0 }), "ZERO");
  check("stockLevel takes one argument now", stockLevel.length, 1);

  // No amber tier may survive anywhere in the app's stock display.
  const appFiles = [
    "src/lib/stock.ts",
    "src/lib/dashboard.ts",
    "src/app/(app)/locations/page.tsx",
    "src/app/(app)/dashboard/admin-dashboard.tsx",
  ];
  const lowRefs = appFiles.filter((f) => {
    const src = readFileSync(f, "utf8");
    // Comments explaining the removal are fine; live code referencing a LOW tier is not.
    return src
      .split("\n")
      .filter((l) => !l.trim().startsWith("//"))
      .some((l) => /\bLOW\b|lowStock|Low Stock/.test(l));
  });
  check("no LOW tier left in app code", lowRefs.join(",") || "none", "none");

  console.log("\n=== 3. Sublevels are numbers ===");
  check("SHELF_SUBLEVELS", SHELF_SUBLEVELS.join(","), "1,2,3,4,5");
  check("no sublevel", shelfAddress("G", 3, null), "G3");
  check("with sublevel", shelfAddress("G", 3, 2), "G3-2");
  check("dash prevents G32 ambiguity", shelfAddress("G", 3, 2).includes("-"), true);
  check("first in an empty cell -> none", assignSublevel({ total: 0, sublevels: [] }).kind, "none");
  const second = assignSublevel({ total: 1, sublevels: [] });
  check("second in a cell -> number 1", second.kind === "number" ? second.sublevel : second.kind, 1);
  const third = assignSublevel({ total: 2, sublevels: [1] });
  check("third -> 2", third.kind === "number" ? third.sublevel : third.kind, 2);
  check("gaps reused", String(nextFreeSublevel([3, 1])), "2");
  check("cell full at 5", assignSublevel({ total: 6, sublevels: [1, 2, 3, 4, 5] }).kind, "full");

  console.log("\n=== 4. Checkout warning thresholds ===");
  const now = new Date("2026-09-15T12:00:00Z");
  const daysAgo = (n: number) => new Date(now.getTime() - n * 24 * 60 * 60 * 1000);

  check("thresholds are 10 and 14", `${CHECKOUT_WARNING_DAYS}/${CHECKOUT_OVERDUE_DAYS}`, "10/14");
  const table: Array<Record<string, string | number>> = [];
  for (const d of [0, 1, 5, 9, 10, 11, 13, 14, 15, 30]) {
    const level = getCheckoutWarningLevel(daysAgo(d), now);
    table.push({ daysOut: d, level, colour: CHECKOUT_WARNING_CLASS[level] });
  }
  console.table(table);

  for (const d of [0, 1, 5, 9]) {
    check(`day ${d}: no warning`, getCheckoutWarningLevel(daysAgo(d), now), "NONE");
  }
  for (const d of [10, 11, 13]) {
    check(`day ${d}: orange warning`, getCheckoutWarningLevel(daysAgo(d), now), "WARNING");
  }
  for (const d of [14, 15, 30]) {
    check(`day ${d}: red overdue`, getCheckoutWarningLevel(daysAgo(d), now), "OVERDUE");
  }
  check("day 9 -> 10 is the boundary",
    `${getCheckoutWarningLevel(daysAgo(9), now)}->${getCheckoutWarningLevel(daysAgo(10), now)}`,
    "NONE->WARNING");
  check("day 13 -> 14 is the boundary",
    `${getCheckoutWarningLevel(daysAgo(13), now)}->${getCheckoutWarningLevel(daysAgo(14), now)}`,
    "WARNING->OVERDUE");
  check("never checked out", getCheckoutWarningLevel(null, now), "NONE");
  check("orange is the warning colour", CHECKOUT_WARNING_CLASS.WARNING.includes("text-warning"), true);
  check("red is the overdue colour", CHECKOUT_WARNING_CLASS.OVERDUE.includes("text-danger"), true);
  check("days elapsed is whole days", daysSinceCheckout(daysAgo(10.9), now), 10);

  console.log("\n=== all three screens share ONE implementation ===");
  const screens = {
    "Admin dashboard (SLT-38)": "src/app/(app)/dashboard/admin-dashboard.tsx",
    "Formulator dashboard (SLT-40)": "src/app/(app)/dashboard/page.tsx",
    "My Checkouts (SLT-30)": "src/app/(app)/my-checkouts/page.tsx",
  };
  for (const [name, file] of Object.entries(screens)) {
    const src = readFileSync(file, "utf8");
    check(`${name} uses <CheckoutSince>`, /<CheckoutSince[\s/>]/.test(src), true);
    // If a screen imported the threshold helpers directly it could drift from the others.
    check(`${name} does not reimplement it`, /getCheckoutWarningLevel|CHECKOUT_OVERDUE_DAYS/.test(src), false);
  }
  const owners = ["src/lib/stock.ts", "src/components/checkout-since.tsx"];
  check("threshold defined in exactly one module",
    owners.filter((f) => readFileSync(f, "utf8").includes("CHECKOUT_OVERDUE_DAYS = ")).length, 1);

  console.log("\n=== overdue highlights the whole row, not just the text ===");
  check("no tint when not overdue", CHECKOUT_ROW_CLASS.NONE, "");
  check("warning row is amber", /bg-warning/.test(CHECKOUT_ROW_CLASS.WARNING), true);
  check("overdue row is red", /bg-danger/.test(CHECKOUT_ROW_CLASS.OVERDUE), true);
  check("overdue row has a left border", /border-l-danger/.test(CHECKOUT_ROW_CLASS.OVERDUE), true);

  // Every surface that lists a checked-out piece must tint the row, not only the date.
  const rowSurfaces = {
    "Admin dashboard": "src/app/(app)/dashboard/admin-dashboard.tsx",
    "Formulator dashboard": "src/app/(app)/dashboard/page.tsx",
    "My Checkouts": "src/app/(app)/my-checkouts/page.tsx",
    "Checked Out page": "src/app/(app)/checked-out/page.tsx",
  };
  for (const [name, file] of Object.entries(rowSurfaces)) {
    check(`${name} tints the row`, /checkoutRowClass\(/.test(readFileSync(file, "utf8")), true);
  }
  check("sample detail piece list tints the row",
    /CHECKOUT_ROW_CLASS\[piece\.checkoutWarning\]/.test(
      readFileSync("src/app/(app)/library/[id]/stock-panel.tsx", "utf8")), true);

  console.log("\n=== Checked Out KPI leads to the list of who has what ===");
  const adminDash = readFileSync("src/app/(app)/dashboard/admin-dashboard.tsx", "utf8");
  check("KPI points at /checked-out", /kpis\.checkedOut, href: "\/checked-out"/.test(adminDash), true);
  check("no longer points at /locations", /kpis\.checkedOut, href: "\/locations"/.test(adminDash), false);
  const navSrc = readFileSync("src/lib/nav.ts", "utf8");
  check("nav entry exists for admins", /key: "checked-out".*roles: \["ADMIN"\]/.test(navSrc), true);
  const page = readFileSync("src/app/(app)/checked-out/page.tsx", "utf8");
  check("page is admin-only", /requireAdmin\(\)/.test(page), true);
  check("page groups by holder", /checkedOutToUser/.test(page), true);
  check("page has an empty state", /Every piece is on the shelf/.test(page), true);

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}
main();
