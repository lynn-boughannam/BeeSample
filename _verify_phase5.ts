import "dotenv/config";
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { PrismaMssql } from "@prisma/adapter-mssql";
import { parseMssqlUrl } from "./src/lib/mssql-url";
import {
  allSuppliersCssDecided,
  canSelectSupplier,
  checkSelectionReady,
  orderWaitingOn,
  selectableSuppliers,
} from "./src/lib/orders";

// Phase 5 — the Formulator chooses between the options CSS approved, and may correct the
// quantity. The gate is the point: nothing is choosable while any option is still undecided.

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

const OPEN = { status: "APPROVED_PENDING_SUPPLY_CHAIN" };
const appr = { cssDecision: "APPROVED" };
const rej = { cssDecision: "REJECTED" };
const pend = { cssDecision: "PENDING" };

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
  const midReview = checkSelectionReady(OPEN, [appr, pend, rej]);
  check("blocked while one is under review", midReview.ok, false);
  check("and names how many",
    midReview.ok ? "" : midReview.reason,
    "1 of 3 supplier options is still being reviewed. You can choose once every option has been decided.");
  const twoLeft = checkSelectionReady(OPEN, [pend, pend, appr]);
  check("plural reads correctly",
    twoLeft.ok ? "" : twoLeft.reason,
    "2 of 3 supplier options are still being reviewed. You can choose once every option has been decided.");

  console.log("\n=== once resolved, the survivors are the choices ===");
  check("one approved of three", checkSelectionReady(OPEN, [appr, rej, rej]).ok, true);
  check("two approved", checkSelectionReady(OPEN, [appr, appr, rej]).ok, true);
  check("only the approved are offered", selectableSuppliers([appr, rej, pend]).length, 1);
  const noneLeft = checkSelectionReady(OPEN, [rej, rej]);
  check("everything rejected leaves nothing to choose", noneLeft.ok, false);
  check("and says so",
    noneLeft.ok ? "" : noneLeft.reason,
    "Every supplier option was rejected, so there is nothing to choose.");
  check("nothing recorded at all",
    checkSelectionReady(OPEN, []).ok, false);

  console.log("\n=== a request past this point can't be chosen again ===");
  check("already selected", checkSelectionReady({ status: "SUPPLIER_SELECTED" }, [appr]).ok, false);
  check("rejected outright", checkSelectionReady({ status: "REJECTED" }, [appr]).ok, false);
  check("still with the Admin", checkSelectionReady({ status: "SUBMITTED" }, [appr]).ok, false);

  console.log("\n=== who may choose ===");
  const order = { orderedById: "u-formulator" };
  check("the person who raised it",
    canSelectSupplier(order, { id: "u-formulator", role: "FORMULATOR" }), true);
  check("an Admin acting for them",
    canSelectSupplier(order, { id: "u-admin", role: "ADMIN" }), true);
  check("a different formulator may not",
    canSelectSupplier(order, { id: "u-other", role: "FORMULATOR" }), false);
  check("Supply Chain may not",
    canSelectSupplier(order, { id: "u-sc", role: "SUPPLY_CHAIN" }), false);
  check("CSS may not", canSelectSupplier(order, { id: "u-css", role: "CSS" }), false);

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
    await prisma.sampleOrderSupplier.update({
      where: { id: built.suppliers[0].id },
      data: { cssDecision: "APPROVED", cssDecisionAt: new Date(), cssDecidedById: css.id },
    });
    await prisma.sampleOrderSupplier.update({
      where: { id: built.suppliers[1].id },
      data: { cssDecision: "REJECTED", cssDecisionAt: new Date(), cssDecidedById: css.id, cssNote: "Too dear" },
    });
    now = await reload();
    check("one approved already", now.suppliers[0].cssDecision, "APPROVED");
    check("but still blocked by the third", checkSelectionReady(now, now.suppliers).ok, false);
    blocked = false;
    try {
      await choose(built.id, built.suppliers[0].id);
    } catch {
      blocked = true;
    }
    check("choosing is still refused", blocked, true);

    console.log("\n--- the last decision lands: now actionable ---");
    await prisma.sampleOrderSupplier.update({
      where: { id: built.suppliers[2].id },
      data: { cssDecision: "APPROVED", cssDecisionAt: new Date(), cssDecidedById: css.id },
    });
    now = await reload();
    check("ready", checkSelectionReady(now, now.suppliers).ok, true);
    check("two options to choose between", selectableSuppliers(now.suppliers).length, 2);
    check("the rejected one isn't offered",
      selectableSuppliers(now.suppliers).some((s) => s.id === built.suppliers[1].id), false);
    check("the badge says so",
      orderWaitingOn(now, now.suppliers.map((s) => ({
        documentCount: 1, landedPrice: s.landedPrice, moq: s.moq,
        cssDecision: s.cssDecision, submittedToCssAt: s.submittedToCssAt,
      })))?.label, "Documents approved — ready to select (2 of 3)");

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
      }))), "null");

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
    check("only the requester (or an Admin) may choose",
      /canSelectSupplier\(order, \{ id: session\.user\.id, role: session\.user\.role \}\)/.test(action), true);
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
    const panel = readFileSync("src/app/(app)/orders/[id]/selection-panel.tsx", "utf8");
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
