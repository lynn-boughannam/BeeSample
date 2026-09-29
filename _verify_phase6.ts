import "dotenv/config";
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { PrismaMssql } from "@prisma/adapter-mssql";
import { parseMssqlUrl } from "./src/lib/mssql-url";
import {
  checkCostingReady,
  isAwaitingCosting,
  orderStatusAfterCosting,
} from "./src/lib/orders";

// Phase 6 — Supply Chain costs the supplier the Formulator chose.
//
// Cost and shipping are entered for that one option, after selection. Doing it before would
// mean costing options nobody was ever going to order, which is why the status chain has
// selection first and this second.

const prisma = new PrismaClient({
  adapter: new PrismaMssql(parseMssqlUrl(process.env.DATABASE_URL!)),
});

const PREFIX = "ZZ-P6-";
let failures = 0;
const check = (label: string, actual: unknown, expected: unknown) => {
  const ok = String(actual) === String(expected);
  if (!ok) failures++;
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${label.padEnd(58)} ${actual}${ok ? "" : `   (expected ${expected})`}`
  );
};

// Mirrors submitSupplierCosting() in supply-chain/actions.ts.
async function cost(orderSupplierId: string, costValue: string, shipping: string) {
  const row = await prisma.sampleOrderSupplier.findUniqueOrThrow({
    where: { id: orderSupplierId },
    include: { order: { select: { id: true, status: true } } },
  });
  const ready = checkCostingReady(row.order, row);
  if (!ready.ok) throw new Error(ready.reason);

  for (const raw of [costValue, shipping]) {
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed < 0) throw new Error("BAD_AMOUNT");
  }

  await prisma.$transaction(async (tx) => {
    await tx.sampleOrderSupplier.update({
      where: { id: orderSupplierId },
      data: { cost: Number(costValue).toFixed(2), shippingCost: Number(shipping).toFixed(2) },
    });
    await tx.sampleOrder.update({
      where: { id: row.order.id },
      data: { status: orderStatusAfterCosting() },
    });
  });
}

async function main() {
  console.log("=== costing belongs to the chosen option, after the choice ===");
  check("waiting once a supplier is chosen", isAwaitingCosting("SUPPLIER_SELECTED"), true);
  check("not while CSS still has it", isAwaitingCosting("DETAILS_SUBMITTED_AWAITING_CSS"), false);
  check("not while the choice is outstanding",
    isAwaitingCosting("CSS_APPROVED_PENDING_FORMULATOR"), false);
  check("and not once it has been submitted",
    isAwaitingCosting("COSTING_SUBMITTED_PENDING_FORMULATOR"), false);

  const chosen = { isSelected: true };
  const notChosen = { isSelected: false };
  check("the chosen supplier can be costed",
    checkCostingReady({ status: "SUPPLIER_SELECTED" }, chosen).ok, true);
  const other = checkCostingReady({ status: "SUPPLIER_SELECTED" }, notChosen);
  check("an option that lost cannot", other.ok, false);
  check("and says why", other.ok ? "" : other.reason, "Only the chosen supplier is costed.");
  // Before the choice there is nothing to cost — say that rather than "isn't waiting".
  const early = checkCostingReady({ status: "CSS_APPROVED_PENDING_FORMULATOR" }, chosen);
  check("nothing to cost before a choice is made", early.ok, false);
  check("and says that specifically",
    early.ok ? "" : early.reason,
    "No supplier has been chosen yet, so there is nothing to cost.");
  const dead = checkCostingReady({ status: "REJECTED" }, chosen);
  check("a rejected request isn't costed", dead.ok, false);
  check("with its own reason", dead.ok ? "" : dead.reason, "This request was rejected.");

  const admin = await prisma.user.findFirstOrThrow({ where: { role: { name: "ADMIN" } } });
  const formulator = await prisma.user.findFirstOrThrow({
    where: { isActive: true, role: { name: "FORMULATOR" } },
  });

  // A request that has been through the whole workflow: CSS cleared both options, the
  // Formulator picked the second and corrected the quantity.
  const built = await prisma.sampleOrder.create({
    data: {
      requestType: "NEW", inciName: PREFIX + "MATERIAL", requiredQuantityG: "250",
      supplier1: "A", supplier2: "B",
      directorApprovalConfirmed: true, orderedById: formulator.id,
      status: "SUPPLIER_SELECTED", approvedById: admin.id, decidedAt: new Date(),
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
    console.log("\n--- Samer opens a request waiting on costing ---");
    let now = await reload();
    check("it is his to work", isAwaitingCosting(now.status as never), true);
    check("one supplier is flagged chosen",
      now.suppliers.filter((s) => s.isSelected).length, 1);
    check("and nothing is costed yet", now.suppliers[1].cost, "null");

    console.log("\n--- the option that lost is refused ---");
    let blocked = false;
    try {
      await cost(built.suppliers[0].id, "100", "20");
    } catch {
      blocked = true;
    }
    check("refused", blocked, true);
    check("and nothing was written", (await reload()).suppliers[0].cost, "null");

    console.log("\n--- costing the chosen one ---");
    await cost(built.suppliers[1].id, "412.5", "37.25");
    now = await reload();
    check("cost stored exactly", now.suppliers[1].cost?.toString(), "412.5");
    check("shipping stored exactly", now.suppliers[1].shippingCost?.toString(), "37.25");
    check("against the quantity the Formulator confirmed", now.requiredQuantityG, "250");
    check("the loser is untouched", now.suppliers[0].cost, "null");
    check("and the request goes back to the Formulator",
      now.status, "COSTING_SUBMITTED_PENDING_FORMULATOR");

    console.log("\n--- and it can't be submitted twice ---");
    blocked = false;
    try {
      await cost(built.suppliers[1].id, "999", "999");
    } catch {
      blocked = true;
    }
    check("refused", blocked, true);
    check("the first figures stand", (await reload()).suppliers[1].cost?.toString(), "412.5");

    console.log("\n=== wiring ===");
    const action = readFileSync("src/app/(app)/supply-chain/actions.ts", "utf8");
    check("only Supply Chain costs", /Only Supply Chain can enter costing/.test(action), true);
    check("the gate is re-checked on the server",
      /checkCostingReady\(row\.order, row\)/.test(action), true);
    check("both figures are required", /Enter the \$\{label\}/.test(action), true);
    check("a negative figure is refused", /parsed < 0/.test(action), true);
    check("the exact figures are kept", /parsed\.toFixed\(2\)/.test(action), true);
    check("saving and advancing are one transaction",
      /\$transaction[\s\S]{0,700}orderStatusAfterCosting\(\)/.test(action), true);

    const detail = readFileSync("src/app/(app)/orders/[id]/page.tsx", "utf8");
    check("the form shows only for the chosen supplier",
      /isAwaitingCosting\(status\) && s\.isSelected/.test(detail), true);
    check("and only to Supply Chain", /isSupplyChain && isAwaitingCosting/.test(detail), true);

    // Without a queue entry, the only way to reach this work would be to know the URL.
    const queue = readFileSync("src/app/(app)/supply-chain/page.tsx", "utf8");
    check("Samer's queue lists what is awaiting costing",
      /status: "SUPPLIER_SELECTED"/.test(queue), true);
    check("showing the chosen supplier only",
      /where: \{ isSelected: true \}/.test(queue), true);

    const form = readFileSync("src/app/(app)/supply-chain/costing-form.tsx", "utf8");
    check("it asks for cost and shipping",
      /name="cost"[\s\S]*name="shippingCost"/.test(form), true);
    check("under one button", /Submit costing/.test(form), true);
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
