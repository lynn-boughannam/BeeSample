import "dotenv/config";
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { PrismaMssql } from "@prisma/adapter-mssql";
import { parseMssqlUrl } from "./src/lib/mssql-url";
import {
  DIRECTOR_ATTESTATION,
  canApproveCosting,
  checkCostingApprovalReady,
  isAwaitingCostingApproval,
  orderStatusAfterCostingApproval,
} from "./src/lib/orders";

// Phase 7 — the Formulator approves what the chosen supplier will cost.
//
// The Director attestation is asked for again here, as on submission: the figures being
// approved are not the ones that existed when the request was raised, and this is where
// money is committed against them.

const prisma = new PrismaClient({
  adapter: new PrismaMssql(parseMssqlUrl(process.env.DATABASE_URL!)),
});

const PREFIX = "ZZ-P7-";
let failures = 0;
const check = (label: string, actual: unknown, expected: unknown) => {
  const ok = String(actual) === String(expected);
  if (!ok) failures++;
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${label.padEnd(58)} ${actual}${ok ? "" : `   (expected ${expected})`}`
  );
};

// Mirrors approveCosting() in costing-approval-actions.ts, attestation gate included.
async function approve(orderId: string, userId: string, attested: boolean) {
  const order = await prisma.sampleOrder.findUniqueOrThrow({
    where: { id: orderId },
    select: {
      id: true,
      status: true,
      orderedById: true,
      suppliers: { select: { isSelected: true, cost: true, shippingCost: true } },
    },
  });
  if (!canApproveCosting(order, { id: userId })) throw new Error("NOT_THE_SUBMITTER");
  if (!attested) throw new Error("NOT_ATTESTED");
  const ready = checkCostingApprovalReady(order, order.suppliers);
  if (!ready.ok) throw new Error(ready.reason);

  await prisma.sampleOrder.update({
    where: { id: orderId },
    data: { status: orderStatusAfterCostingApproval() },
  });
}

async function main() {
  console.log("=== when the costing can be approved ===");
  check("once Supply Chain has submitted it",
    isAwaitingCostingApproval("COSTING_SUBMITTED_PENDING_FORMULATOR"), true);
  check("not while they are still costing it",
    isAwaitingCostingApproval("SUPPLIER_SELECTED"), false);
  check("and not once approved", isAwaitingCostingApproval("FORMULATOR_APPROVED_PENDING_PR"), false);

  const costed = [{ isSelected: true, cost: "100", shippingCost: "10" }];
  const submitted = { status: "COSTING_SUBMITTED_PENDING_FORMULATOR" };
  check("a costed request is approvable",
    checkCostingApprovalReady(submitted, costed).ok, true);

  const early = checkCostingApprovalReady({ status: "SUPPLIER_SELECTED" }, costed);
  check("not before Supply Chain submits", early.ok, false);
  check("and says what is missing",
    early.ok ? "" : early.reason, "Supply Chain hasn't submitted the costing yet.");

  // Costing and the status move in one transaction, so this state means something went
  // wrong. Better said out loud than approved as though the numbers were there.
  const half = checkCostingApprovalReady(submitted, [
    { isSelected: true, cost: "100", shippingCost: null },
  ]);
  check("half-entered costing is refused", half.ok, false);
  check("and says so",
    half.ok ? "" : half.reason,
    "The costing is incomplete — ask Supply Chain to re-enter it.");
  const noneChosen = checkCostingApprovalReady(submitted, [
    { isSelected: false, cost: "100", shippingCost: "10" },
  ]);
  check("nothing chosen is refused", noneChosen.ok, false);
  const dead = checkCostingApprovalReady({ status: "REJECTED" }, costed);
  check("a rejected request isn't approved", dead.ok, false);

  console.log("\n=== who signs: the submitter, and nobody else ===");
  // Same rule as choosing the supplier, and the same reason — whether the cost is worth
  // paying for the work is the requester's judgement, not an administrative step.
  check("the person who raised it",
    canApproveCosting({ orderedById: "u-1" }, { id: "u-1" }), true);
  check("not a colleague", canApproveCosting({ orderedById: "u-1" }, { id: "u-2" }), false);

  const admin = await prisma.user.findFirstOrThrow({ where: { role: { name: "ADMIN" } } });
  const formulator = await prisma.user.findFirstOrThrow({
    where: { isActive: true, role: { name: "FORMULATOR" } },
  });

  const built = await prisma.sampleOrder.create({
    data: {
      requestType: "NEW", inciName: PREFIX + "MATERIAL", requiredQuantityG: "250",
      supplier1: "A", supplier2: "B",
      directorApprovalConfirmed: true, orderedById: formulator.id,
      status: "COSTING_SUBMITTED_PENDING_FORMULATOR", approvedById: admin.id,
      decidedAt: new Date(),
      suppliers: {
        create: [1, 2].map((position) => ({
          position,
          supplierName: `${PREFIX}Supplier ${position}`,
          landedPrice: `${10 + position}.00`,
          moq: "25 kg",
          documentsReceivedAt: new Date(),
          submittedToCssAt: new Date(),
          cssDecision: "APPROVED",
          cssDecisionAt: new Date(),
          isSelected: position === 2,
          ...(position === 2 ? { cost: "412.50", shippingCost: "37.25" } : {}),
        })),
      },
    },
    include: { suppliers: { orderBy: { position: "asc" } } },
  });

  const reload = () => prisma.sampleOrder.findUniqueOrThrow({ where: { id: built.id } });

  try {
    console.log("\n--- the popup blocks approval until acknowledged ---");
    let blocked = false;
    try {
      await approve(built.id, formulator.id, false);
    } catch (error) {
      blocked = (error as Error).message === "NOT_ATTESTED";
    }
    check("unattested approval refused", blocked, true);
    check("and the request has not moved",
      (await reload()).status, "COSTING_SUBMITTED_PENDING_FORMULATOR");

    console.log("\n--- nor can somebody else sign it ---");
    blocked = false;
    try {
      await approve(built.id, admin.id, true);
    } catch (error) {
      blocked = (error as Error).message === "NOT_THE_SUBMITTER";
    }
    check("an Admin cannot approve for them", blocked, true);
    check("still not moved", (await reload()).status, "COSTING_SUBMITTED_PENDING_FORMULATOR");

    console.log("\n--- acknowledged, the approval lands ---");
    await approve(built.id, formulator.id, true);
    check("the request is ready for a PR",
      (await reload()).status, "FORMULATOR_APPROVED_PENDING_PR");

    console.log("\n--- and it can't be approved twice ---");
    blocked = false;
    try {
      await approve(built.id, formulator.id, true);
    } catch {
      blocked = true;
    }
    check("refused", blocked, true);

    console.log("\n=== wiring ===");
    const action = readFileSync(
      "src/app/(app)/orders/[id]/costing-approval-actions.ts", "utf8"
    );
    // The dialog decides when the question is asked, never whether it can be skipped: a
    // page with its JavaScript broken must not be able to approve.
    check("the server requires the attestation, not the dialog",
      /formData\.get\("directorApprovalConfirmed"\) !== "on"/.test(action), true);
    check("only the submitter signs",
      /canApproveCosting\(order, \{ id: session\.user\.id \}\)/.test(action), true);
    check("the gate is re-checked on the server",
      /checkCostingApprovalReady\(order, order\.suppliers\)/.test(action), true);
    check("and it advances to pending PR",
      /orderStatusAfterCostingApproval\(\)/.test(action), true);

    const panel = readFileSync("src/app/(app)/orders/[id]/costing-approval-panel.tsx", "utf8");
    check("the panel asks before submitting",
      /if \(!attested\) \{[\s\S]{0,120}setShowAttestation\(true\)/.test(panel), true);
    check("the attestation field only exists once confirmed",
      /\{attested && <input type="hidden" name="directorApprovalConfirmed"/.test(panel), true);
    check("it uses the shared dialog, not a copy of it",
      /<ConfirmDialog/.test(panel), true);
    check("with the same attestation wording as submission",
      /body=\{DIRECTOR_ATTESTATION\}/.test(panel), true);
    // The figures being signed for are shown where the signing happens.
    check("the costing is shown next to the button", /Figure label="Total"/.test(panel), true);

    const form = readFileSync("src/app/(app)/orders/order-form.tsx", "utf8");
    check("submission uses the shared dialog too", /<ConfirmDialog/.test(form), true);
    check("and no second copy is left behind", /^function Dialog\(/m.test(form), false);
    check("the attestation text is defined once",
      DIRECTOR_ATTESTATION.length > 0, true);

    const detail = readFileSync("src/app/(app)/orders/[id]/page.tsx", "utf8");
    check("the panel shows only when approval is due",
      /mayApproveCosting && chosenSupplier/.test(detail), true);

    const dash = readFileSync("src/lib/dashboard.ts", "utf8");
    check("the requester is told it is waiting on them",
      /checkCostingApprovalReady\(o, o\.suppliers\)\.ok/.test(dash), true);
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
