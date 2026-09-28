import "dotenv/config";
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { PrismaMssql } from "@prisma/adapter-mssql";
import { parseMssqlUrl } from "./src/lib/mssql-url";
import {
  allSuppliersCssDecided,
  canSelectSupplier,
  checkDeclineReady,
  checkSelectionReady,
  orderStatusAfterCssDecision,
  orderWaitingOn,
  selectableSuppliers,
} from "./src/lib/orders";

// Phase 5 — the Formulator either chooses between the options CSS approved or declines them
// all, and may correct the quantity. The gate is the point: nothing is actionable while any
// option is still undecided.

const PREFIX = "ZZ-P5-";
let failures = 0;
const check = (label: string, actual: unknown, expected: unknown) => {
  const ok = String(actual) === String(expected);
  if (!ok) failures++;
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${label.padEnd(64)} ${actual}${ok ? "" : `   (expected ${expected})`}`
  );
};

const prisma = new PrismaClient({
  adapter: new PrismaMssql(parseMssqlUrl(process.env.DATABASE_URL!)),
});

// Where the per-supplier work still sits with Supply Chain and CSS.
const OPEN = { status: "APPROVED_PENDING_SUPPLY_CHAIN" };
// Where CSS has finished and the request is back with the Formulator. The decision that
// settles the last option moves it here, and only here is a choice available.
const READY = { status: "COSTING_SUBMITTED_PENDING_FORMULATOR" };
const appr = { cssDecision: "APPROVED" };
const rej = { cssDecision: "REJECTED" };
const pend = { cssDecision: "PENDING" };

// Mirrors decide() in css-review/actions.ts — including the status advance, which is the
// whole point: writing a decision straight to the row would leave the order parked at
// "pending Supply Chain" and the gate below would never open.
async function cssDecide(
  orderId: string,
  orderSupplierId: string,
  decision: "APPROVED" | "REJECTED",
  cssDecidedById: string,
  note?: string
) {
  await prisma.$transaction(async (tx) => {
    await tx.sampleOrderSupplier.update({
      where: { id: orderSupplierId },
      data: {
        cssDecision: decision,
        cssDecisionAt: new Date(),
        cssDecidedById,
        cssNote: note ?? null,
      },
    });
    const siblings = await tx.sampleOrderSupplier.findMany({
      where: { orderId },
      select: { cssDecision: true },
    });
    const next = orderStatusAfterCssDecision(siblings);
    if (next === "REJECTED") {
      await tx.sampleOrder.update({
        where: { id: orderId },
        data: { status: "REJECTED", decidedAt: new Date(), rejectionReason: "all options rejected" },
      });
    } else if (next) {
      await tx.sampleOrder.update({ where: { id: orderId }, data: { status: next } });
    }
  });
}

// Mirrors selectSupplier() in selection-actions.ts.
async function choose(orderId: string, orderSupplierId: string, quantity?: string) {
  const order = await prisma.sampleOrder.findUniqueOrThrow({
    where: { id: orderId },
    select: { id: true, status: true, suppliers: { select: { id: true, cssDecision: true } } },
  });
  const ready = checkSelectionReady(order, order.suppliers);
  if (!ready.ok) throw new Error(ready.reason);
  const chosen = order.suppliers.find((s) => s.id === orderSupplierId);
  if (!chosen || chosen.cssDecision !== "APPROVED") throw new Error("NOT_APPROVED");

  await prisma.$transaction(async (tx) => {
    await tx.sampleOrderSupplier.updateMany({ where: { orderId }, data: { isSelected: false } });
    await tx.sampleOrderSupplier.update({ where: { id: orderSupplierId }, data: { isSelected: true } });
    await tx.sampleOrder.update({
      where: { id: orderId },
      data: { status: "SUPPLIER_SELECTED", ...(quantity ? { requiredQuantityG: quantity } : {}) },
    });
  });
}

async function main() {
  console.log("=== CSS must have finished with EVERY option ===");
  check("all decided", allSuppliersCssDecided([appr, rej]), true);
  check("one still pending blocks it", allSuppliersCssDecided([appr, pend]), false);
  check("all pending blocks it", allSuppliersCssDecided([pend, pend]), false);
  check("no options at all isn't 'decided'", allSuppliersCssDecided([]), false);
  // A supplier still with Supply Chain — never sent — is equally undecided.
  check("an option never sent to CSS also blocks it",
    allSuppliersCssDecided([appr, pend]), false);

  console.log("\n=== and it says what is holding it up ===");
  // While that work is still theirs, whose it is IS the answer. Counting options the
  // Formulator can do nothing about would read as something for them to wait on.
  const withThem = checkSelectionReady(OPEN, [appr, pend, rej]);
  check("blocked while Supply Chain and CSS are still on it", withThem.ok, false);
  check("and says whose it is",
    withThem.ok ? "" : withThem.reason,
    "Supply Chain and CSS haven't finished with this request yet.");

  // The per-option count is the fallback for rows and status disagreeing: the status only
  // reaches READY once every option is decided, so normally this is never reached.
  const midReview = checkSelectionReady(READY, [appr, pend, rej]);
  check("blocked while one is under review", midReview.ok, false);
  check("and names how many",
    midReview.ok ? "" : midReview.reason,
    "1 of 3 supplier options is still being reviewed. You can choose once every option has been decided.");
  const twoLeft = checkSelectionReady(READY, [pend, pend, appr]);
  check("plural reads correctly",
    twoLeft.ok ? "" : twoLeft.reason,
    "2 of 3 supplier options are still being reviewed. You can choose once every option has been decided.");

  console.log("\n=== once resolved, the survivors are the choices ===");
  check("one approved of three", checkSelectionReady(READY, [appr, rej, rej]).ok, true);
  check("two approved", checkSelectionReady(READY, [appr, appr, rej]).ok, true);
  check("only the approved are offered", selectableSuppliers([appr, rej, pend]).length, 1);
  const noneLeft = checkSelectionReady(READY, [rej, rej]);
  check("everything rejected leaves nothing to choose", noneLeft.ok, false);
  check("and says so",
    noneLeft.ok ? "" : noneLeft.reason,
    "Every supplier option was rejected, so there is nothing to choose.");
  check("nothing recorded at all",
    checkSelectionReady(READY, []).ok, false);

  console.log("\n=== a request past this point can't be chosen again ===");
  check("already selected", checkSelectionReady({ status: "SUPPLIER_SELECTED" }, [appr]).ok, false);
  check("rejected outright", checkSelectionReady({ status: "REJECTED" }, [appr]).ok, false);
  check("still with the Admin", checkSelectionReady({ status: "SUBMITTED" }, [appr]).ok, false);

  console.log("\n=== declining is gated the same way ===");
  // Declining is the other half of the same decision, so it opens and closes together with
  // choosing — never available earlier, never left available afterwards.
  check("blocked while Supply Chain and CSS are still on it",
    checkDeclineReady(OPEN, [appr, rej]).ok, false);
  check("blocked while one is under review", checkDeclineReady(READY, [appr, pend]).ok, false);
  check("available once all are decided", checkDeclineReady(READY, [appr, rej]).ok, true);
  check("not after a supplier was chosen",
    checkDeclineReady({ status: "SUPPLIER_SELECTED" }, [appr]).ok, false);
  check("nothing to decline when CSS rejected everything",
    checkDeclineReady(READY, [rej, rej]).ok, false);
  check("the two gates agree on every shape",
    [[appr, pend], [appr, rej], [rej, rej], []].every(
      (s) =>
        checkDeclineReady(READY, s).ok === checkSelectionReady(READY, s).ok &&
        checkDeclineReady(OPEN, s).ok === checkSelectionReady(OPEN, s).ok
    ), true);

  console.log("\n=== who may choose: the submitter, and nobody else ===");
  // No Admin stand-in here, unlike every earlier step. Signing for someone else would
  // record their name against a judgement they did not make.
  const order = { orderedById: "u-formulator" };
  check("the person who submitted it", canSelectSupplier(order, { id: "u-formulator" }), true);
  check("an Admin may NOT act for them", canSelectSupplier(order, { id: "u-admin" }), false);
  check("a different formulator may not", canSelectSupplier(order, { id: "u-other" }), false);
  check("Supply Chain may not", canSelectSupplier(order, { id: "u-sc" }), false);
  check("CSS may not", canSelectSupplier(order, { id: "u-css" }), false);
  // An Admin who raised it themselves still signs, because they are the submitter.
  check("an Admin who submitted it themselves may",
    canSelectSupplier({ orderedById: "u-admin" }, { id: "u-admin" }), true);

  console.log("\n=== against real rows ===");
  const admin = await prisma.user.findFirstOrThrow({ where: { role: { name: "ADMIN" } } });
  const formulator = await prisma.user.findFirstOrThrow({
    where: { isActive: true, role: { name: "FORMULATOR" } },
  });
  const css = await prisma.user.findFirstOrThrow({ where: { role: { name: "CSS" } } });

  const built = await prisma.sampleOrder.create({
    data: {
      requestType: "NEW", inciName: PREFIX + "MATERIAL", requiredQuantityG: "100",
      supplier1: "A", supplier2: "B", supplier3: "C",
      directorApprovalConfirmed: true, orderedById: formulator.id,
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

  const reload = () =>
    prisma.sampleOrder.findUniqueOrThrow({
      where: { id: built.id },
      include: { suppliers: { orderBy: { position: "asc" } } },
    });

  try {
    console.log("\n--- all three still with CSS: not actionable ---");
    let now = await reload();
    check("blocked", checkSelectionReady(now, now.suppliers).ok, false);
    check("and the badge agrees",
      orderWaitingOn(now, now.suppliers.map((s) => ({
        documentCount: 1, landedPrice: s.landedPrice, moq: s.moq,
        cssDecision: s.cssDecision, submittedToCssAt: s.submittedToCssAt,
      })))?.label, "With CSS (3 of 3)");

    let blocked = false;
    try {
      await choose(built.id, built.suppliers[0].id);
    } catch {
      blocked = true;
    }
    check("choosing is refused", blocked, true);

    console.log("\n--- two decided, one still mid-review: still not actionable ---");
    await cssDecide(built.id, built.suppliers[0].id, "APPROVED", css.id);
    await cssDecide(built.id, built.suppliers[1].id, "REJECTED", css.id, "Too dear");
    now = await reload();
    check("one approved already", now.suppliers[0].cssDecision, "APPROVED");
    check("the request has not moved on", now.status, "APPROVED_PENDING_SUPPLY_CHAIN");
    check("but still blocked by the third", checkSelectionReady(now, now.suppliers).ok, false);
    blocked = false;
    try {
      await choose(built.id, built.suppliers[0].id);
    } catch {
      blocked = true;
    }
    check("choosing is still refused", blocked, true);

    console.log("\n--- the last decision lands: now actionable ---");
    await cssDecide(built.id, built.suppliers[2].id, "APPROVED", css.id);
    now = await reload();
    // The last CSS decision is what hands the request back to the Formulator. Leaving it at
    // "pending Supply Chain" through all of this is what made the status read as a lie.
    check("the request is now the Formulator's", now.status, "COSTING_SUBMITTED_PENDING_FORMULATOR");
    check("ready", checkSelectionReady(now, now.suppliers).ok, true);
    check("two options to choose between", selectableSuppliers(now.suppliers).length, 2);
    check("the rejected one isn't offered",
      selectableSuppliers(now.suppliers).some((s) => s.id === built.suppliers[1].id), false);
    // No second badge: the status above already says the request is waiting on them.
    check("and the status says it without a second badge",
      orderWaitingOn(now, now.suppliers.map((s) => ({
        documentCount: 1, landedPrice: s.landedPrice, moq: s.moq,
        cssDecision: s.cssDecision, submittedToCssAt: s.submittedToCssAt,
      }))), null);

    console.log("\n--- choosing, with a quantity correction ---");
    await choose(built.id, built.suppliers[2].id, "250");
    const after = await reload();
    check("the choice is recorded", after.suppliers[2].isSelected, true);
    check("and only on the chosen one",
      after.suppliers.filter((s) => s.isSelected).length, 1);
    check("the other approved option is not flagged", after.suppliers[0].isSelected, false);
    check("the quantity was corrected", after.requiredQuantityG, "250");
    check("the request moved on", after.status, "SUPPLIER_SELECTED");
    check("so the badge stops explaining a wait",
      orderWaitingOn(after, after.suppliers.map((s) => ({
        documentCount: 1, landedPrice: s.landedPrice, moq: s.moq,
        cssDecision: s.cssDecision, submittedToCssAt: s.submittedToCssAt,
      }))), null);

    console.log("\n--- and it can't be chosen twice ---");
    blocked = false;
    try {
      await choose(built.id, built.suppliers[0].id);
    } catch {
      blocked = true;
    }
    check("refused", blocked, true);
    check("the first choice stands", (await reload()).suppliers[2].isSelected, true);

    console.log("\n=== wiring ===");
    const action = readFileSync("src/app/(app)/orders/[id]/selection-actions.ts", "utf8");
    check("only the submitter may choose — no role escape hatch",
      /canSelectSupplier\(order, \{ id: session\.user\.id \}\)/.test(action), true);
    check("and the refusal says so",
      /Only the person who submitted this request can choose its supplier/.test(action), true);
    check("the gate is re-checked on the server", /checkSelectionReady\(order, order\.suppliers\)/.test(action), true);
    check("a rejected option can't be chosen", /wasn't approved, so it can't be chosen/.test(action), true);
    check("a bad quantity is refused", /greater than zero/.test(action), true);
    check("an empty quantity leaves it alone", /rawQuantity\) \{/.test(action), true);
    check("the flag is cleared before it is set", /updateMany[\s\S]{0,120}isSelected: false/.test(action), true);
    check("the request moves to Supplier Selected", /status: "SUPPLIER_SELECTED"/.test(action), true);

    const page = readFileSync("src/app/(app)/orders/[id]/page.tsx", "utf8");
    check("the panel only shows to whoever raised it", /mayChoose && selectionReady\.ok/.test(page), true);
    check("and the reason shows when it isn't ready",
      /mayChoose && !selectionReady\.ok/.test(page), true);
    check("declining needs a reason", /Say why none of these options work/.test(action), true);
    check("only the submitter may decline",
      /Only the person who submitted this request can decline it/.test(action), true);
    // The rule itself must not read a role at all, or a stand-in can creep back in.
    check("the rule ignores role entirely",
      /role/.test(
        readFileSync("src/lib/orders.ts", "utf8")
          .split("export function canSelectSupplier")[1]
          .split("}")[0]
      ), false);
    check("declining is gated like choosing", /checkDeclineReady\(order, order\.suppliers\)/.test(action), true);
    check("a decline ends the request", /status: "REJECTED"/.test(action), true);
    check("and is attributed", /Declined by the requester/.test(action), true);

    const panel = readFileSync("src/app/(app)/orders/[id]/selection-panel.tsx", "utf8");
    check("the panel offers a decline", /None of these work/.test(panel), true);
    check("it warns the request ends", /This ends the request/.test(panel), true);
    // MOQ is often the reason, so it has to be readable against what was asked for.
    check("MOQ is called out per option", /MOQ \{s\.moq/.test(panel), true);
    check("and the requested quantity is shown to compare against",
      /You asked for/.test(panel), true);
    check("options are radios, one decision between alternatives",
      /type="radio"/.test(panel), true);
    check("the quantity can be corrected while choosing",
      /name="requiredQuantityG"/.test(panel), true);
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
