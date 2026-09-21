import "dotenv/config";
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { PrismaMssql } from "@prisma/adapter-mssql";
import { parseMssqlUrl } from "./src/lib/mssql-url";
import {
  isAwaitingSupplyChain,
  needsDocumentRequest,
  orderSupplierNames,
  ORDER_REQUEST_TYPES,
} from "./src/lib/orders";
import { formatDay } from "./src/lib/dates";
import {
  addWorkingDays,
  supplierDocumentDueDate,
  supplierDocumentSlaLevel,
  workingDaysBetween,
  SLA_ROW_CLASS,
  SUPPLIER_DOCUMENT_SLA_DAYS,
  SUPPLIER_DOCUMENT_WARNING_DAYS,
} from "./src/lib/working-days";

// Phase 2 — Supply Chain document requests. Covers the brief's two test cases: a
// Same-Source order skips the step entirely, and a New-Source order's SLA colour changes
// correctly across the 5- and 7-working-day marks.

const PREFIX = "ZZ-P2-";
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
  console.log("=== which request types need documents chased ===");
  check("a new material does", needsDocumentRequest("NEW"), true);
  check("a new source does", needsDocumentRequest("EXISTING_NEW_SOURCE"), true);
  check("the same source does NOT", needsDocumentRequest("EXISTING_SAME_SOURCE"), false);
  check("exactly one type skips the step",
    ORDER_REQUEST_TYPES.filter((t) => !needsDocumentRequest(t)).join(","), "EXISTING_SAME_SOURCE");

  console.log("\n=== supplier options are read off the request in position order ===");
  check("a new material carries up to three",
    orderSupplierNames({ requestType: "NEW", supplier1: "A", supplier2: "B", supplier3: "C" })
      .map((s) => `${s.position}:${s.supplierName}`).join(" "), "1:A 2:B 3:C");
  check("blanks are dropped, positions stay contiguous",
    orderSupplierNames({ requestType: "NEW", supplier1: "A", supplier2: "  ", supplier3: "C" })
      .map((s) => `${s.position}:${s.supplierName}`).join(" "), "1:A 2:C");
  check("an existing-sample type carries its one named supplier",
    orderSupplierNames({ requestType: "EXISTING_SAME_SOURCE", supplierName: "Firmenich" })
      .map((s) => `${s.position}:${s.supplierName}`).join(" "), "1:Firmenich");
  check("the three boxes are ignored for existing types",
    orderSupplierNames({ requestType: "EXISTING_NEW_SOURCE", supplierName: "X", supplier1: "ignored" }).length, 1);

  console.log("\n=== the SLA clock, in working days ===");
  // A Monday, so the weekend lands predictably inside the window.
  const requested = new Date(2026, 8, 7, 9, 0);
  check("requested on a Monday", requested.getDay(), 1);
  const due = supplierDocumentDueDate(requested);
  check("due 7 working days later", workingDaysBetween(requested, due), SUPPLIER_DOCUMENT_SLA_DAYS);
  check("which is 9 calendar days, skipping a weekend",
    Math.round((due.getTime() - new Date(2026, 8, 7).getTime()) / 86400000), 9);
  check("the due date is itself a working day", due.getDay() !== 0 && due.getDay() !== 6, true);

  console.log("\n=== colour across the 5 and 7 working-day marks ===");
  const rows: Array<Record<string, string | number>> = [];
  for (const d of [0, 1, 3, 4, 5, 6, 7, 8, 12]) {
    const at = addWorkingDays(requested, d);
    const level = supplierDocumentSlaLevel(requested, at);
    rows.push({ workingDaysOut: d, date: at.toISOString().slice(0, 10), level });
  }
  console.table(rows);

  for (const d of [0, 1, 3, 4]) {
    check(`day ${d}: no warning`, supplierDocumentSlaLevel(requested, addWorkingDays(requested, d)), "NONE");
  }
  for (const d of [5, 6]) {
    check(`day ${d}: orange`, supplierDocumentSlaLevel(requested, addWorkingDays(requested, d)), "WARNING");
  }
  for (const d of [7, 8, 12]) {
    check(`day ${d}: red`, supplierDocumentSlaLevel(requested, addWorkingDays(requested, d)), "OVERDUE");
  }
  check("day 4 -> 5 is the amber boundary",
    `${supplierDocumentSlaLevel(requested, addWorkingDays(requested, 4))}->${supplierDocumentSlaLevel(requested, addWorkingDays(requested, 5))}`,
    "NONE->WARNING");
  check("day 6 -> 7 is the red boundary",
    `${supplierDocumentSlaLevel(requested, addWorkingDays(requested, 6))}->${supplierDocumentSlaLevel(requested, addWorkingDays(requested, 7))}`,
    "WARNING->OVERDUE");
  check("thresholds are 5 and 7",
    `${SUPPLIER_DOCUMENT_WARNING_DAYS}/${SUPPLIER_DOCUMENT_SLA_DAYS}`, "5/7");
  check("nothing requested yet is never a warning", supplierDocumentSlaLevel(null), "NONE");

  // The weekend must not advance the clock: a Saturday reads the same as the Friday.
  const friday = addWorkingDays(requested, 4);
  const saturday = new Date(friday.getFullYear(), friday.getMonth(), friday.getDate() + 1);
  check("a weekend day doesn't tip it over",
    `${supplierDocumentSlaLevel(requested, friday)}=${supplierDocumentSlaLevel(requested, saturday)}`,
    "NONE=NONE");

  console.log("\n=== against real rows ===");
  const admin = await prisma.user.findFirstOrThrow({ where: { role: { name: "ADMIN" } } });
  const formulator = await prisma.user.findFirstOrThrow({
    where: { isActive: true, role: { name: "FORMULATOR" } },
  });
  const sample = await prisma.sample.findFirstOrThrow({ where: { isDiscarded: false } });

  // A new-source order (documents needed) and a same-source one (skipped), both approved.
  const newSource = await prisma.sampleOrder.create({
    data: {
      requestType: "EXISTING_NEW_SOURCE", existingSampleId: sample.id,
      supplierName: PREFIX + "Novel Source", directorApprovalConfirmed: true,
      orderedById: formulator.id, status: "APPROVED_PENDING_SUPPLY_CHAIN",
      approvedById: admin.id, decidedAt: new Date(),
      suppliers: { create: [{ position: 1, supplierName: PREFIX + "Novel Source" }] },
    },
    include: { suppliers: true },
  });
  const sameSource = await prisma.sampleOrder.create({
    data: {
      requestType: "EXISTING_SAME_SOURCE", existingSampleId: sample.id,
      supplierName: PREFIX + "Known Source", directorApprovalConfirmed: true,
      orderedById: formulator.id, status: "APPROVED_PENDING_SUPPLY_CHAIN",
      approvedById: admin.id, decidedAt: new Date(),
      suppliers: { create: [{ position: 1, supplierName: PREFIX + "Known Source" }] },
    },
    include: { suppliers: true },
  });

  try {
    check("both are in the Supply Chain queue",
      [newSource, sameSource].every((o) => isAwaitingSupplyChain(o.status as never)), true);
    check("the same-source one skips the step",
      needsDocumentRequest(sameSource.requestType as never), false);
    check("its supplier starts with no clock running",
      sameSource.suppliers[0].documentsRequestedAt, "null");

    console.log("\n--- logging a request on the new-source order ---");
    const at = new Date();
    const updated = await prisma.sampleOrderSupplier.update({
      where: { id: newSource.suppliers[0].id },
      data: { documentsRequestedAt: at, documentsDueAt: supplierDocumentDueDate(at) },
    });
    check("requested date recorded", updated.documentsRequestedAt !== null, true);
    check("due date is 7 working days out",
      workingDaysBetween(updated.documentsRequestedAt!, updated.documentsDueAt!), 7);
    check("it starts green", supplierDocumentSlaLevel(updated.documentsRequestedAt, at), "NONE");

    // Wind the stored request date back, which is how the queue will look on those days.
    for (const [back, expected] of [[4, "NONE"], [5, "WARNING"], [7, "OVERDUE"]] as const) {
      // Stepped back by hand rather than with addWorkingDays, which only moves forward.
      const backdated = new Date(at);
      let moved = 0;
      while (moved < back) {
        backdated.setDate(backdated.getDate() - 1);
        if (backdated.getDay() !== 0 && backdated.getDay() !== 6) moved++;
      }
      await prisma.sampleOrderSupplier.update({
        where: { id: newSource.suppliers[0].id },
        data: { documentsRequestedAt: backdated },
      });
      const row = await prisma.sampleOrderSupplier.findUniqueOrThrow({
        where: { id: newSource.suppliers[0].id },
      });
      check(`requested ${back} working days ago reads ${expected}`,
        supplierDocumentSlaLevel(row.documentsRequestedAt), expected);
    }

    console.log("\n=== wiring ===");
    const action = readFileSync("src/app/(app)/supply-chain/actions.ts", "utf8");
    check("only Supply Chain (or an Admin) may record it",
      /role !== "SUPPLY_CHAIN" && role !== "ADMIN"/.test(action), true);
    check("the order must actually be with Supply Chain",
      /isAwaitingSupplyChain/.test(action), true);
    check("a same-source request is refused", /needsDocumentRequest/.test(action), true);
    check("re-requesting is refused so a deadline can't move",
      /already requested/.test(action), true);
    check("the due date is stored, not derived on read",
      /documentsDueAt: supplierDocumentDueDate/.test(action), true);

    const page = readFileSync("src/app/(app)/supply-chain/page.tsx", "utf8");
    check("the queue is the approved orders",
      /status: "APPROVED_PENDING_SUPPLY_CHAIN"/.test(page), true);
    check("a skipped order says so visually", /No documents needed/.test(page), true);
    check("rows are tinted by SLA level", /SLA_ROW_CLASS\[level\]/.test(page), true);
    check("overdue rows are red", /bg-danger/.test(SLA_ROW_CLASS.OVERDUE), true);
    check("warning rows are amber", /bg-warning/.test(SLA_ROW_CLASS.WARNING), true);
    check("a healthy row is untinted", SLA_ROW_CLASS.NONE, "");

    const review = readFileSync("src/app/(app)/orders/[id]/review-actions.ts", "utf8");
    check("approval creates the supplier rows Phase 2 works on",
      /sampleOrderSupplier\.createMany/.test(review), true);
    check("rejection leaves none behind", /decision === "APPROVE" && order\._count\.suppliers === 0/.test(review), true);

    console.log("\n=== dates are shown in local time, not UTC ===");
    // addWorkingDays returns local midnight. At UTC+3 that is 21:00 the previous day in
    // UTC, so toISOString() would show a due date a day early — a supplier document due
    // Wednesday displayed as Tuesday.
    const localMidnight = new Date(2026, 8, 30, 0, 0, 0);
    check("local midnight formats as its own day", formatDay(localMidnight), "2026-09-30");
    check("toISOString would have got this wrong",
      localMidnight.toISOString().slice(0, 10) === "2026-09-30", false);
    const dueFromMonday = supplierDocumentDueDate(new Date(2026, 8, 21, 9, 0));
    check("a Monday request is due the following Wednesday", formatDay(dueFromMonday), "2026-09-30");
    check("late-evening timestamps keep their own day",
      formatDay(new Date(2026, 8, 30, 23, 30)), "2026-09-30");
    const dateSites = [
      "src/app/(app)/orders/[id]/page.tsx",
      "src/app/(app)/supply-chain/page.tsx",
      "src/components/checkout-since.tsx",
    ];
    check("no screen formats dates via toISOString",
      dateSites.filter((f) => readFileSync(f, "utf8").includes("toISOString().slice(0, 10)")).join(",") || "none",
      "none");

    console.log("\n=== Samer can open the request he has to chase ===");
    const detail = readFileSync("src/app/(app)/orders/[id]/page.tsx", "utf8");
    check("Supply Chain and CSS can read an order",
      /role === "SUPPLY_CHAIN" \|\| role === "CSS"/.test(detail), true);
    check("a Formulator still only sees their own",
      /!worksOrders && order\.orderedById !== session\.user\.id/.test(detail), true);
    check("deciding stays Admin-only", /isAdmin && isAwaitingAdminReview\(status\)/.test(detail), true);
    check("the request button sits with the details", /RequestDocumentsButton/.test(detail), true);

    const nav = readFileSync("src/lib/nav.ts", "utf8");
    check("Supply Chain has a nav entry",
      /key: "supply-chain".*roles: \["ADMIN", "SUPPLY_CHAIN"\]/.test(nav), true);
  } finally {
    await prisma.sampleOrderSupplier.deleteMany({
      where: { order: { supplierName: { startsWith: PREFIX } } },
    });
    await prisma.sampleOrder.deleteMany({ where: { supplierName: { startsWith: PREFIX } } });
    console.log("\ncleanup done");
    await prisma.$disconnect();
  }

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}
main();
