import "dotenv/config";
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { PrismaMssql } from "@prisma/adapter-mssql";
import { parseMssqlUrl } from "./src/lib/mssql-url";
import {
  canRecordCssDecision,
  isAwaitingCssReview,
  orderIsExhausted,
  supplierStage,
  survivingSuppliers,
} from "./src/lib/orders";
import {
  cssReviewDueDate,
  cssReviewSlaLevel,
  cssReviewWorkingDaysElapsed,
  workingDaysBetween,
  CSS_REVIEW_SLA_DAYS,
  CSS_REVIEW_WARNING_DAYS,
} from "./src/lib/working-days";

// Phase 4 — CSS review. What CSS judges is a supplier's DOCUMENTS; costing approval is the
// Formulator's, later in the track. Covers the brief's two scenarios: rejecting one option
// on a three-option request leaves it alive with two, and rejecting all three ends it.

const PREFIX = "ZZ-P4-";
let failures = 0;
const check = (label: string, actual: unknown, expected: unknown) => {
  const ok = String(actual) === String(expected);
  if (!ok) failures++;
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${label.padEnd(62)} ${actual}${ok ? "" : `   (expected ${expected})`}`
  );
};

const prisma = new PrismaClient({
  adapter: new PrismaMssql(parseMssqlUrl(process.env.DATABASE_URL!)),
});

// Mirrors decide() in css-review/actions.ts.
async function decide(id: string, decision: "APPROVED" | "REJECTED", note: string, byId: string) {
  const row = await prisma.sampleOrderSupplier.findUniqueOrThrow({
    where: { id },
    include: { order: { select: { id: true } } },
  });
  if (!canRecordCssDecision(row)) throw new Error("NOT_REVIEWABLE");

  const decidedAt = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.sampleOrderSupplier.update({
      where: { id },
      data: { cssDecision: decision, cssDecisionAt: decidedAt, cssDecidedById: byId, cssNote: note },
    });
    const siblings = await tx.sampleOrderSupplier.findMany({
      where: { orderId: row.order.id },
      select: { cssDecision: true },
    });
    if (orderIsExhausted(siblings)) {
      await tx.sampleOrder.update({
        where: { id: row.order.id },
        data: { status: "REJECTED", decidedAt, rejectionReason: "All options rejected at document review." },
      });
    }
  });
}

async function main() {
  console.log("=== what is on CSS's desk ===");
  const sent = new Date();
  check("sent and undecided", isAwaitingCssReview({ submittedToCssAt: sent, cssDecision: "PENDING" }), true);
  check("not sent yet", isAwaitingCssReview({ submittedToCssAt: null, cssDecision: "PENDING" }), false);
  check("already approved", isAwaitingCssReview({ submittedToCssAt: sent, cssDecision: "APPROVED" }), false);
  check("already rejected", isAwaitingCssReview({ submittedToCssAt: sent, cssDecision: "REJECTED" }), false);
  check("a decision is made once",
    canRecordCssDecision({ submittedToCssAt: sent, cssDecision: "APPROVED" }), false);

  console.log("\n=== an order is only exhausted when every option is out ===");
  const rej = { cssDecision: "REJECTED" };
  const pend = { cssDecision: "PENDING" };
  const appr = { cssDecision: "APPROVED" };
  check("one of three rejected", orderIsExhausted([rej, pend, pend]), false);
  check("two of three rejected", orderIsExhausted([rej, rej, pend]), false);
  check("all three rejected", orderIsExhausted([rej, rej, rej]), true);
  check("an approval saves it", orderIsExhausted([rej, rej, appr]), false);
  check("no options at all isn't exhaustion", orderIsExhausted([]), false);
  check("survivors exclude only the rejected",
    survivingSuppliers([rej, pend, appr]).length, 2);

  console.log("\n=== the 2 and 3 working-day marks ===");
  const submitted = new Date(2026, 8, 7, 9, 0); // a Monday
  const at = (n: number) => {
    const d = new Date(submitted);
    let moved = 0;
    while (moved < n) {
      d.setDate(d.getDate() + 1);
      if (d.getDay() !== 0 && d.getDay() !== 6) moved++;
    }
    return d;
  };
  check("thresholds are 2 and 3", `${CSS_REVIEW_WARNING_DAYS}/${CSS_REVIEW_SLA_DAYS}`, "2/3");
  const table: Array<Record<string, string | number>> = [];
  for (const n of [0, 1, 2, 3, 4, 8]) {
    table.push({ workingDaysOut: n, level: cssReviewSlaLevel(submitted, null, at(n)) });
  }
  console.table(table);
  for (const n of [0, 1]) {
    check(`day ${n}: no warning`, cssReviewSlaLevel(submitted, null, at(n)), "NONE");
  }
  check("day 2: orange", cssReviewSlaLevel(submitted, null, at(2)), "WARNING");
  for (const n of [3, 4, 8]) {
    check(`day ${n}: red`, cssReviewSlaLevel(submitted, null, at(n)), "OVERDUE");
  }
  check("day 1 -> 2 is the amber boundary",
    `${cssReviewSlaLevel(submitted, null, at(1))}->${cssReviewSlaLevel(submitted, null, at(2))}`,
    "NONE->WARNING");
  check("day 2 -> 3 is the red boundary",
    `${cssReviewSlaLevel(submitted, null, at(2))}->${cssReviewSlaLevel(submitted, null, at(3))}`,
    "WARNING->OVERDUE");
  check("never sent is never a warning", cssReviewSlaLevel(null), "NONE");
  // The weekend must not advance the clock.
  const friday = at(4);
  const saturday = new Date(friday.getFullYear(), friday.getMonth(), friday.getDate() + 1);
  check("a weekend day doesn't advance it",
    cssReviewWorkingDaysElapsed(submitted, null, friday),
    cssReviewWorkingDaysElapsed(submitted, null, saturday));
  check("the due date is 3 working days out",
    workingDaysBetween(submitted, cssReviewDueDate(submitted)), CSS_REVIEW_SLA_DAYS);
  check("deciding inside the window stays green",
    cssReviewSlaLevel(submitted, at(1), at(30)), "NONE");

  console.log("\n=== against real rows ===");
  const admin = await prisma.user.findFirstOrThrow({ where: { role: { name: "ADMIN" } } });
  const css = await prisma.user.findFirstOrThrow({ where: { role: { name: "CSS" } } });

  const makeOrder = async (code: string) =>
    prisma.sampleOrder.create({
      data: {
        requestType: "NEW", inciName: PREFIX + code,
        supplier1: "A", supplier2: "B", supplier3: "C",
        directorApprovalConfirmed: true, orderedById: admin.id,
        status: "APPROVED_PENDING_SUPPLY_CHAIN", approvedById: admin.id, decidedAt: new Date(),
        suppliers: {
          create: [1, 2, 3].map((position) => ({
            position,
            supplierName: `${PREFIX}Supplier ${position}`,
            landedPrice: `${10 + position}.00`,
            moq: "25 kg",
            documentsReceivedAt: new Date(),
            submittedToCssAt: new Date(),
          })),
        },
      },
      include: { suppliers: { orderBy: { position: "asc" } } },
    });

  const survives = await makeOrder("SURVIVES");
  const doomed = await makeOrder("DOOMED");

  const reload = (id: string) =>
    prisma.sampleOrder.findUniqueOrThrow({
      where: { id },
      include: { suppliers: { orderBy: { position: "asc" } } },
    });

  try {
    check("all six options start awaiting review",
      [...survives.suppliers, ...doomed.suppliers].every(isAwaitingCssReview), true);
    check("and read as pending CSS",
      supplierStage({
        documentCount: 1, landedPrice: "11.00", moq: "25 kg", needsDocuments: true,
        cssDecision: "PENDING", submittedToCssAt: survives.suppliers[0].submittedToCssAt,
      }), "PENDING_CSS");

    console.log("\n--- reject one of three: the request stays alive ---");
    await decide(survives.suppliers[0].id, "REJECTED", "Price too high", css.id);
    const after1 = await reload(survives.id);
    check("that option is rejected", after1.suppliers[0].cssDecision, "REJECTED");
    check("the reason is recorded", after1.suppliers[0].cssNote, "Price too high");
    check("who decided is recorded", after1.suppliers[0].cssDecidedById, css.id);
    check("and when", after1.suppliers[0].cssDecisionAt !== null, true);
    check("two options remain", survivingSuppliers(after1.suppliers).length, 2);
    check("the request is still open", after1.status, "APPROVED_PENDING_SUPPLY_CHAIN");
    // It is eliminated, not handed back.
    check("it does not return to Supply Chain",
      supplierStage({
        documentCount: 1, landedPrice: "11.00", moq: "25 kg", needsDocuments: true,
        cssDecision: after1.suppliers[0].cssDecision,
        submittedToCssAt: after1.suppliers[0].submittedToCssAt,
      }), "CSS_REJECTED");

    console.log("\n--- approving another leaves the request open ---");
    await decide(survives.suppliers[1].id, "APPROVED", "", css.id);
    const after2 = await reload(survives.id);
    check("approved", after2.suppliers[1].cssDecision, "APPROVED");
    check("still open", after2.status, "APPROVED_PENDING_SUPPLY_CHAIN");
    check("two still live", survivingSuppliers(after2.suppliers).length, 2);

    console.log("\n--- a decided option can't be decided again ---");
    let blocked = false;
    try {
      await decide(survives.suppliers[0].id, "APPROVED", "changed my mind", css.id);
    } catch (e) {
      blocked = (e as Error).message === "NOT_REVIEWABLE";
    }
    check("refused", blocked, true);

    console.log("\n--- reject all three: the whole request is rejected ---");
    for (const [i, supplier] of doomed.suppliers.entries()) {
      await decide(supplier.id, "REJECTED", `No good (${i + 1})`, css.id);
      const mid = await reload(doomed.id);
      const live = survivingSuppliers(mid.suppliers).length;
      check(
        `after rejecting ${i + 1} of 3: ${live} live, status ${mid.status}`,
        `${live}/${mid.status}`,
        i === 2 ? "0/REJECTED" : `${2 - i}/APPROVED_PENDING_SUPPLY_CHAIN`
      );
    }
    const dead = await reload(doomed.id);
    check("terminal", dead.status, "REJECTED");
    check("with a reason anyone can read", Boolean(dead.rejectionReason), true);
    check("nothing survives", survivingSuppliers(dead.suppliers).length, 0);

    console.log("\n=== wiring ===");
    const action = readFileSync("src/app/(app)/css-review/actions.ts", "utf8");
    check("only CSS decides", /role !== "CSS" && role !== "ADMIN"/.test(action), true);
    check("the server re-checks reviewability", /canRecordCssDecision/.test(action), true);
    check("a rejection needs a reason", /Give a reason for rejecting this supplier/.test(action), true);
    check("exhaustion is judged inside the transaction",
      /tx\.sampleOrderSupplier\.findMany[\s\S]*orderIsExhausted/.test(action), true);
    check("the order is rejected when nothing is left",
      /status: "REJECTED"/.test(action), true);

    const page = readFileSync("src/app/(app)/css-review/page.tsx", "utf8");
    check("the queue is CSS-only", /role !== "CSS" && role !== "ADMIN"/.test(page), true);
    check("options are grouped by request so they can be compared",
      /orderLabel\(order\)/.test(page), true);
    check("documents open through the authenticated route",
      /api\/order-documents/.test(page), true);
    check("it never loads document bytes", /content: true/.test(page), false);
    check("the last option warns before it ends the request",
      /isLastOption/.test(page), true);

    // A decision that vanishes the moment it is made is not a record: CSS has to be able
    // to look back at what they rejected, and at the documents they rejected it on.
    check("reviewed work is queried without a status filter",
      /suppliers: \{ some: \{ cssDecision: \{ in: \["APPROVED", "REJECTED"\] \} \} \}/.test(page), true);
    check("so a fully rejected request still appears",
      /longer pending anything/.test(page), true);
    check("there is a reviewed section", /Reviewed\{" "\}/.test(page), true);
    check("the reason is shown with the decision", /supplier\.cssNote/.test(page), true);
    check("and who decided it, and when", /cssDecidedBy\?\.name/.test(page), true);
    check("the whole-request rejection reason is shown too",
      /order\.rejectionReason/.test(page), true);
    check("documents stay reachable after a decision",
      /Documents stay reachable after a decision/.test(page), true);
    check("a request half-decided isn't listed twice",
      /pendingIds\.has\(o\.id\)/.test(page), true);

    // CSS reviews documents. Costing approval belongs to the Formulator further along the
    // track (COSTING_SUBMITTED_PENDING_FORMULATOR), so nothing here should call it costing.
    check("the page is about documents, not costing", /Document review/.test(page), true);
    check("and no longer calls itself a costing review", /Costing review/.test(page), false);
    check("the actions are named for documents",
      /approveSupplierDocuments[\s\S]*rejectSupplierDocuments/.test(action), true);
    check("a refusal says document decision", /record a document decision/.test(action), true);
    check("exhaustion says document review", /rejected at document review/.test(action), true);

    const nav = readFileSync("src/lib/nav.ts", "utf8");
    check("CSS has a nav entry", /key: "css-review".*roles: \["ADMIN", "CSS"\]/.test(nav), true);
    check("the nav says Document Review", /label: "Document Review"/.test(nav), true);
    const dash = readFileSync("src/app/(app)/dashboard/page.tsx", "utf8");
    check("CSS lands on its own queue", /role === "CSS"\) redirect\("\/css-review"\)/.test(dash), true);
  } finally {
    await prisma.sampleOrderSupplier.deleteMany({
      where: { order: { inciName: { startsWith: PREFIX } } },
    });
    await prisma.sampleOrder.deleteMany({ where: { inciName: { startsWith: PREFIX } } });
    console.log("\ncleanup done");
    await prisma.$disconnect();
  }

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}
main();
