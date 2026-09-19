import "dotenv/config";
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { PrismaMssql } from "@prisma/adapter-mssql";
import { parseMssqlUrl } from "./src/lib/mssql-url";
import {
  canEditOrder,
  checkReviewAllowed,
  isAwaitingAdminReview,
  isTerminal,
  REVIEW_TARGET,
} from "./src/lib/orders";
import { ORDER_STATUSES, type OrderStatus } from "./src/lib/types";

// Phase 1 — Admin review. Walks the lifecycle the brief describes: a Formulator submits,
// Rawan sees it in the queue, edits it, approves one and rejects another, and a rejected
// request can't be touched again.

const PREFIX = "ZZ-P1-";
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

// Mirrors decide() in review-actions.ts.
async function review(orderId: string, decision: "APPROVE" | "REJECT", reason: string | null, adminId: string) {
  const order = await prisma.sampleOrder.findUniqueOrThrow({
    where: { id: orderId },
    select: { status: true },
  });
  const allowed = checkReviewAllowed(order.status as OrderStatus);
  if (!allowed.ok) throw new Error(allowed.reason);

  return prisma.sampleOrder.update({
    where: { id: orderId },
    data: {
      status: REVIEW_TARGET[decision],
      approvedById: adminId,
      decidedAt: new Date(),
      rejectionReason: decision === "REJECT" ? reason : null,
    },
  });
}

async function main() {
  console.log("=== the rules, before touching anything ===");
  check("a submitted request is awaiting review", isAwaitingAdminReview("SUBMITTED"), true);
  check("an approved one is not", isAwaitingAdminReview("APPROVED_PENDING_SUPPLY_CHAIN"), false);
  check("rejection is terminal", isTerminal("REJECTED"), true);
  check("nothing else is terminal",
    ORDER_STATUSES.filter((s) => isTerminal(s)).join(","), "REJECTED");
  check("editing is allowed while awaiting review", canEditOrder("SUBMITTED"), true);
  check("editing stops once approved", canEditOrder("APPROVED_PENDING_SUPPLY_CHAIN"), false);
  check("editing is impossible after rejection", canEditOrder("REJECTED"), false);
  // Every status other than SUBMITTED must refuse a decision.
  const refused = ORDER_STATUSES.filter((s) => !checkReviewAllowed(s).ok);
  check("only a submitted request can be decided", refused.length, ORDER_STATUSES.length - 1);
  check("approve lands on pending Supply Chain", REVIEW_TARGET.APPROVE, "APPROVED_PENDING_SUPPLY_CHAIN");
  check("reject lands on rejected", REVIEW_TARGET.REJECT, "REJECTED");

  const rawan = await prisma.user.findFirstOrThrow({
    where: { adUsername: "rawan.hdede", role: { name: "ADMIN" } },
  });
  const formulator = await prisma.user.findFirstOrThrow({
    where: { isActive: true, role: { name: "FORMULATOR" } },
  });
  console.log(`\nreviewer: ${rawan.name} (ADMIN) · requester: ${formulator.name} (FORMULATOR)`);

  const queueBefore = await prisma.sampleOrder.count({ where: { status: "SUBMITTED" } });

  // Two requests raised by the Formulator, as the brief describes.
  const toApprove = await prisma.sampleOrder.create({
    data: {
      requestType: "NEW", inciName: PREFIX + "APPROVE ME", supplier1: "Acme",
      requiredQuantityG: "100", directorApprovalConfirmed: true, orderedById: formulator.id,
    },
  });
  const toReject = await prisma.sampleOrder.create({
    data: {
      requestType: "NEW", inciName: PREFIX + "REJECT ME", supplier1: "Acme",
      requiredQuantityG: "200", directorApprovalConfirmed: true, orderedById: formulator.id,
    },
  });

  try {
    console.log("\n=== they land in the queue ===");
    check("both start as Submitted",
      `${toApprove.status},${toReject.status}`, "SUBMITTED,SUBMITTED");
    const queue = await prisma.sampleOrder.findMany({
      where: { status: "SUBMITTED" },
      select: { id: true },
    });
    check("the queue grew by two", queue.length - queueBefore, 2);
    check("the approve one is in it", queue.some((o) => o.id === toApprove.id), true);
    check("the reject one is in it", queue.some((o) => o.id === toReject.id), true);

    console.log("\n=== Rawan edits a field before deciding ===");
    await prisma.sampleOrder.update({
      where: { id: toApprove.id },
      data: { requiredQuantityG: "250", application: "Haircare" },
    });
    const edited = await prisma.sampleOrder.findUniqueOrThrow({ where: { id: toApprove.id } });
    check("the edit stuck", edited.requiredQuantityG, "250");
    check("another field was set too", edited.application, "Haircare");
    check("editing did not decide it", edited.status, "SUBMITTED");

    console.log("\n=== approve one ===");
    const approved = await review(toApprove.id, "APPROVE", null, rawan.id);
    check("status moves to pending Supply Chain", approved.status, "APPROVED_PENDING_SUPPLY_CHAIN");
    check("the reviewer is recorded", approved.approvedById, rawan.id);
    check("the decision is dated", approved.decidedAt !== null, true);
    check("no rejection reason is left behind", approved.rejectionReason, "null");
    check("it has left the queue", isAwaitingAdminReview(approved.status as OrderStatus), false);

    console.log("\n=== reject the other ===");
    const rejected = await review(toReject.id, "REJECT", "Already held in the library", rawan.id);
    check("status is rejected", rejected.status, "REJECTED");
    check("the reason is stored", rejected.rejectionReason, "Already held in the library");
    check("the reviewer is recorded", rejected.approvedById, rawan.id);

    console.log("\n=== a rejected request is finished with ===");
    for (const [what, decision] of [["approved", "APPROVE"], ["rejected again", "REJECT"]] as const) {
      let blocked = false;
      try {
        await review(toReject.id, decision, "second thoughts", rawan.id);
      } catch {
        blocked = true;
      }
      check(`it cannot be ${what}`, blocked, true);
    }
    check("it cannot be edited", canEditOrder("REJECTED"), false);
    const stillRejected = await prisma.sampleOrder.findUniqueOrThrow({ where: { id: toReject.id } });
    check("and nothing changed underneath", stillRejected.status, "REJECTED");
    check("its reason is intact", stillRejected.rejectionReason, "Already held in the library");

    console.log("\n=== an approved request is past review too ===");
    let approvedBlocked = false;
    try {
      await review(toApprove.id, "REJECT", "changed my mind", rawan.id);
    } catch {
      approvedBlocked = true;
    }
    check("it can't be rejected after approval", approvedBlocked, true);
    check("editing it is refused", canEditOrder("APPROVED_PENDING_SUPPLY_CHAIN"), false);

    console.log("\n=== wiring ===");
    const actions = readFileSync("src/app/(app)/orders/[id]/review-actions.ts", "utf8");
    check("only an Admin decides", /requireAdmin\(\)/.test(actions), true);
    check("the server re-checks the status", /checkReviewAllowed/.test(actions), true);
    check("a rejection needs a reason", /Give a reason for rejecting/.test(actions), true);

    const detail = readFileSync("src/app/(app)/orders/[id]/page.tsx", "utf8");
    check("the panel only shows while awaiting review",
      /isAdmin && isAwaitingAdminReview\(status\)/.test(detail), true);

    const editPage = readFileSync("src/app/(app)/orders/[id]/edit/page.tsx", "utf8");
    check("the edit page is Admin-only", /requireAdmin\(\)/.test(editPage), true);
    check("it refuses a decided request", /canEditOrder\(order\.status as OrderStatus\)\) redirect/.test(editPage), true);

    const updateAction = readFileSync("src/app/(app)/orders/actions.ts", "utf8");
    check("the update action re-checks editability", /canEditOrder\(existing\.status as OrderStatus\)/.test(updateAction), true);
    check("editing doesn't re-ask for the requester's attestation",
      /UpdateSampleOrderSchema/.test(updateAction), true);

    const list = readFileSync("src/app/(app)/orders/page.tsx", "utf8");
    check("the queue is surfaced to Admins", /awaiting your review/.test(list), true);
  } finally {
    await prisma.sampleOrderIngredient.deleteMany({
      where: { order: { inciName: { startsWith: PREFIX } } },
    });
    await prisma.sampleOrder.deleteMany({ where: { inciName: { startsWith: PREFIX } } });
    console.log("\ncleanup done");
    console.log("orders now:", await prisma.sampleOrder.count());
    await prisma.$disconnect();
  }

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}
main();
