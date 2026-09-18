import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaMssql } from "@prisma/adapter-mssql";
import { parseMssqlUrl } from "./src/lib/mssql-url";
import {
  addWorkingDays,
  workingDaysBetween,
  isWorkingDay,
  supplierDocumentDueDate,
  cssReviewDueDate,
  SUPPLIER_DOCUMENT_SLA_DAYS,
  CSS_REVIEW_SLA_DAYS,
} from "./src/lib/working-days";
import { ROLES, ORDER_STATUSES, ORDER_STATUS_LABELS, CSS_DECISIONS } from "./src/lib/types";

// Phase 0 foundations: roles, schema, and the working-day maths every later SLA rests on.

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

const d = (iso: string) => {
  const [y, m, day] = iso.split("-").map(Number);
  return new Date(y, m - 1, day);
};
const iso = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

async function main() {
  // 2026-09-14 is a Monday; the week runs Mon 14 … Sun 20.
  console.log("=== weekend is Saturday and Sunday (confirmed 2026-09-18) ===");
  check("Monday is a working day", isWorkingDay(d("2026-09-14")), true);
  check("Friday is a working day", isWorkingDay(d("2026-09-18")), true);
  check("Saturday is not", isWorkingDay(d("2026-09-19")), false);
  check("Sunday is not", isWorkingDay(d("2026-09-20")), false);

  console.log("\n=== adding working days skips the weekend ===");
  check("Mon + 1 = Tue", iso(addWorkingDays(d("2026-09-14"), 1)), "2026-09-15");
  check("Thu + 1 = Fri", iso(addWorkingDays(d("2026-09-17"), 1)), "2026-09-18");
  check("Fri + 1 = Mon (skips the weekend)", iso(addWorkingDays(d("2026-09-18"), 1)), "2026-09-21");
  check("Fri + 2 = Tue", iso(addWorkingDays(d("2026-09-18"), 2)), "2026-09-22");
  check("Mon + 5 = next Mon", iso(addWorkingDays(d("2026-09-14"), 5)), "2026-09-21");
  check("Mon + 10 spans two weekends", iso(addWorkingDays(d("2026-09-14"), 10)), "2026-09-28");

  console.log("\n=== a weekend start rolls forward first ===");
  // Nothing is worked over the weekend, so Sat and Sun must behave like the Monday.
  check("Sat + 1 = Tue", iso(addWorkingDays(d("2026-09-19"), 1)), "2026-09-22");
  check("Sun + 1 = Tue", iso(addWorkingDays(d("2026-09-20"), 1)), "2026-09-22");
  check("Sat + 0 = the Monday", iso(addWorkingDays(d("2026-09-19"), 0)), "2026-09-21");
  check("Mon + 0 = the same Monday", iso(addWorkingDays(d("2026-09-14"), 0)), "2026-09-14");

  console.log("\n=== time of day never changes the due date ===");
  const early = new Date(2026, 8, 18, 0, 5);
  const late = new Date(2026, 8, 18, 23, 55);
  check("a request at 00:05 and 23:55 share a due date",
    iso(addWorkingDays(early, 7)) === iso(addWorkingDays(late, 7)), true);
  check("the result is at local midnight", addWorkingDays(late, 7).getHours(), 0);

  console.log("\n=== the two SLAs ===");
  check("supplier document SLA is 7 working days", SUPPLIER_DOCUMENT_SLA_DAYS, 7);
  check("CSS review SLA is 3 working days", CSS_REVIEW_SLA_DAYS, 3);
  // Monday request, 7 working days: Tue, Wed, Thu, Fri, Mon, Tue, Wed.
  check("Mon request -> documents due the following Wed",
    iso(supplierDocumentDueDate(d("2026-09-14"))), "2026-09-23");
  check("Fri request -> documents due Tue week after next",
    iso(supplierDocumentDueDate(d("2026-09-18"))), "2026-09-29");
  check("Thu costing -> CSS due Tue", iso(cssReviewDueDate(d("2026-09-17"))), "2026-09-22");

  console.log("\n=== counting between dates ===");
  check("Mon to Fri is 4 working days", workingDaysBetween(d("2026-09-14"), d("2026-09-18")), 4);
  check("Fri to Mon is 1", workingDaysBetween(d("2026-09-18"), d("2026-09-21")), 1);
  check("a full week is 5", workingDaysBetween(d("2026-09-14"), d("2026-09-21")), 5);
  check("same day is 0", workingDaysBetween(d("2026-09-14"), d("2026-09-14")), 0);
  // Negative reads naturally as "days late" once a deadline has passed.
  check("overdue counts backwards", workingDaysBetween(d("2026-09-18"), d("2026-09-14")), -4);

  console.log("\n=== bad input is refused, not guessed at ===");
  let refused = 0;
  for (const bad of [-1, 1.5, NaN]) {
    try {
      addWorkingDays(d("2026-09-14"), bad);
    } catch {
      refused++;
    }
  }
  check("negative, fractional and NaN all throw", refused, 3);

  console.log("\n=== roles ===");
  check("five roles defined", ROLES.length, 5);
  check("SUPPLY_CHAIN is one", ROLES.includes("SUPPLY_CHAIN"), true);
  check("CSS is one", ROLES.includes("CSS"), true);

  const dbRoles = await prisma.role.findMany({ select: { name: true }, orderBy: { name: "asc" } });
  const names = dbRoles.map((r) => r.name);
  console.log("  in the database:", names.join(", "));
  for (const role of ROLES) {
    check(`  ${role} exists in the database`, names.includes(role), true);
  }

  console.log("\n=== seeded test users ===");
  const testUsers = await prisma.user.findMany({
    where: { adUsername: { in: ["supplychain.test", "css.test"] } },
    include: { role: { select: { name: true } } },
    orderBy: { adUsername: "asc" },
  });
  console.table(testUsers.map((u) => ({ adUsername: u.adUsername, name: u.name, role: u.role.name, active: u.isActive })));
  check("both test users exist", testUsers.length, 2);
  check("supply chain user has the right role",
    testUsers.find((u) => u.adUsername === "supplychain.test")?.role.name, "SUPPLY_CHAIN");
  check("css user has the right role",
    testUsers.find((u) => u.adUsername === "css.test")?.role.name, "CSS");
  check("both are active, so they can actually log in",
    testUsers.every((u) => u.isActive), true);

  console.log("\n=== order status sequence ===");
  check("eight statuses", ORDER_STATUSES.length, 8);
  check("starts at Submitted", ORDER_STATUSES[0], "SUBMITTED");
  check("ends at Received", ORDER_STATUSES[ORDER_STATUSES.length - 1], "RECEIVED");
  check("every status has a label",
    ORDER_STATUSES.every((s) => Boolean(ORDER_STATUS_LABELS[s])), true);
  // Nothing may be left on a status the new sequence doesn't contain.
  const live = await prisma.sampleOrder.groupBy({ by: ["status"], _count: { _all: true } });
  console.table(live.map((r) => ({ status: r.status, count: r._count._all })));
  check("no order sits on an unknown status",
    live.every((r) => (ORDER_STATUSES as readonly string[]).includes(r.status)), true);

  console.log("\n=== per-supplier schema is usable ===");
  check("three CSS decisions", CSS_DECISIONS.join(","), "PENDING,APPROVED,REJECTED");
  const admin = await prisma.user.findFirstOrThrow({ where: { role: { name: "ADMIN" } } });
  const probe = await prisma.sampleOrder.create({
    data: {
      requestType: "NEW",
      directorApprovalConfirmed: true,
      orderedById: admin.id,
      status: "APPROVED_PENDING_SUPPLY_CHAIN",
      prNumber: "PR-PHASE0",
      receivedSampleCode: "S-PHASE0",
      suppliers: {
        create: [1, 2, 3].map((position) => ({
          position,
          supplierName: `Phase0 Supplier ${position}`,
          documentsRequestedAt: d("2026-09-14"),
          documentsDueAt: supplierDocumentDueDate(d("2026-09-14")),
          landedPrice: "12.50",
          moq: "25 kg",
          cost: "10.00",
          shippingCost: "2.50",
          cssDecision: position === 1 ? "APPROVED" : "PENDING",
          documents: { create: [{ fileName: `quote-${position}.pdf`, uploadedById: admin.id }] },
        })),
      },
    },
    include: { suppliers: { include: { documents: true }, orderBy: { position: "asc" } } },
  });

  try {
    check("three supplier sub-records", probe.suppliers.length, 3);
    check("each carries its own pricing", probe.suppliers[0].landedPrice?.toString(), "12.5");
    check("each carries its own MOQ", probe.suppliers[0].moq, "25 kg");
    check("shipping is separate from cost", probe.suppliers[0].shippingCost?.toString(), "2.5");
    check("CSS decisions are per supplier",
      probe.suppliers.map((s) => s.cssDecision).join(","), "APPROVED,PENDING,PENDING");
    check("the computed due date was stored",
      iso(probe.suppliers[0].documentsDueAt!), "2026-09-23");
    check("documents attach per supplier", probe.suppliers[0].documents.length, 1);
    check("PR reference recorded", probe.prNumber, "PR-PHASE0");
    check("reception code recorded", probe.receivedSampleCode, "S-PHASE0");
    check("a fourth supplier on the same position is refused",
      await prisma.sampleOrderSupplier
        .create({ data: { orderId: probe.id, position: 1, supplierName: "dupe" } })
        .then(() => false)
        .catch(() => true),
      true);
  } finally {
    await prisma.sampleOrder.delete({ where: { id: probe.id } });
    check("deleting the order cleans up its suppliers",
      await prisma.sampleOrderSupplier.count({ where: { orderId: probe.id } }), 0);
    await prisma.$disconnect();
  }

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}
main();
