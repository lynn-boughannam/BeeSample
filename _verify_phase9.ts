import "dotenv/config";
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { PrismaMssql } from "@prisma/adapter-mssql";
import { parseMssqlUrl } from "./src/lib/mssql-url";
import { prepareSampleCreate } from "./src/lib/sample-creation";
import { compareQuantities, toCents } from "./src/lib/pieces";
import {
  canReceiveOrder,
  checkReceiptReady,
  isAwaitingReceipt,
  orderStatusAfterReceipt,
} from "./src/lib/orders";
import { shelfAddress } from "./src/lib/categories";
import { resolveShelfSlot } from "./src/lib/shelf";

// Phase 9 — reception creates a real sample.
//
// The point of the phase is that the sample is indistinguishable from one typed straight
// into the library, so the second half of this re-runs SLT-13's acceptance checks against
// the sample reception produced: real pieces that reconcile to the total, a real shelf
// address, an initial location entry, its INCI links.
//
// Needs --conditions=react-server: sample-creation is marked server-only.

const prisma = new PrismaClient({
  adapter: new PrismaMssql(parseMssqlUrl(process.env.DATABASE_URL!)),
});

const PREFIX = "ZZ-P9-";
let failures = 0;
const check = (label: string, actual: unknown, expected: unknown) => {
  const ok = String(actual) === String(expected);
  if (!ok) failures++;
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${label.padEnd(58)} ${actual}${ok ? "" : `   (expected ${expected})`}`
  );
};

// Mirrors receiveOrder() in orders/[id]/receive/actions.ts — the same prepare-then-commit
// shape, so what it exercises is the real creation path rather than a restatement of it.
async function receive(orderId: string, role: string, form: FormData, userId: string) {
  if (!canReceiveOrder(role)) throw new Error("NOT_ADMIN");
  const order = await prisma.sampleOrder.findUniqueOrThrow({
    where: { id: orderId },
    select: { id: true, status: true, producedSampleId: true },
  });
  const ready = checkReceiptReady(order);
  if (!ready.ok) throw new Error(ready.reason);

  const prepared = await prepareSampleCreate(form, userId);
  if (!prepared.ok) {
    throw new Error(JSON.stringify(prepared.fieldErrors ?? { form: prepared.formError }));
  }

  return prisma.$transaction(async (tx) => {
    const sample = await tx.sample.create({ data: prepared.data, select: { id: true } });
    await tx.sampleOrder.update({
      where: { id: orderId },
      data: {
        status: orderStatusAfterReceipt(),
        receivedAt: prepared.data.receptionDate,
        receivedSampleCode: prepared.data.sampleCode,
        producedSampleId: sample.id,
      },
    });
    return sample.id;
  });
}

// Called before seeding as well as after, so a run that dies mid-setup doesn't poison the
// next one. Everything this suite creates carries the prefix.
async function wipe() {
  const samples = await prisma.sample.findMany({
    where: { sampleCode: { startsWith: PREFIX } },
    select: { id: true },
  });
  const sampleIds = samples.map((s) => s.id);
  await prisma.sampleOrder.updateMany({
    where: { producedSampleId: { in: sampleIds } },
    data: { producedSampleId: null },
  });
  await prisma.locationHistory.deleteMany({ where: { sampleId: { in: sampleIds } } });
  await prisma.samplePiece.deleteMany({ where: { sampleId: { in: sampleIds } } });
  await prisma.sampleIngredient.deleteMany({ where: { sampleId: { in: sampleIds } } });
  await prisma.sample.deleteMany({ where: { id: { in: sampleIds } } });
  await prisma.sampleOrderSupplier.deleteMany({
    where: { order: { inciName: { startsWith: PREFIX } } },
  });
  await prisma.sampleOrderIngredient.deleteMany({
    where: { order: { inciName: { startsWith: PREFIX } } },
  });
  await prisma.sampleOrder.deleteMany({ where: { inciName: { startsWith: PREFIX } } });
  await prisma.ingredientListEntry.deleteMany({ where: { inciName: { startsWith: PREFIX } } });
}

async function main() {
  await wipe();

  console.log("=== when a delivery can be received ===");
  check("once the PR is out", isAwaitingReceipt("PR_ISSUED_AWAITING_RECEIPT"), true);
  check("not before", isAwaitingReceipt("FORMULATOR_APPROVED_PENDING_PR"), false);
  check("receiving is the Admin's", canReceiveOrder("ADMIN"), true);
  check("not the Formulator's", canReceiveOrder("FORMULATOR"), false);

  const awaiting = { status: "PR_ISSUED_AWAITING_RECEIPT" };
  check("a delivery on its way is receivable", checkReceiptReady(awaiting).ok, true);
  const early = checkReceiptReady({ status: "FORMULATOR_APPROVED_PENDING_PR" });
  check("not without a PR", early.ok, false);
  check("and says so", early.ok ? "" : early.reason,
    "No PR has been raised for this request yet.");
  // The one that matters: receiving twice would put two samples on the shelf for one
  // delivery, and the second would look exactly as real as the first.
  const done = checkReceiptReady({ ...awaiting, producedSampleId: "s-1" });
  check("never twice", done.ok, false);
  check("whatever the status says",
    checkReceiptReady({ status: "RECEIVED", producedSampleId: "s-1" }).ok, false);

  console.log("\n=== requested against received ===");
  // A difference is reported, never blocked: the supplier ships what they ship, and
  // refusing to record 240 g would leave the library ignorant of material on the shelf.
  check("the same is a match", compareQuantities("250", "250").kind, "MATCH");
  const short = compareQuantities("250", "240");
  check("less is short", short.kind, "SHORT");
  check("by how much", short.kind === "SHORT" ? short.differenceG : "", "10.00");
  const over = compareQuantities("250", "262.5");
  check("more is over", over.kind, "OVER");
  check("by how much", over.kind === "OVER" ? over.differenceG : "", "12.50");
  // Decimals that floating point can't hold must not read as a mismatch.
  check("0.1 + 0.2 against 0.3 still matches",
    compareQuantities("0.3", String(0.1 + 0.2)).kind, "MATCH");
  check("nothing requested is not a mismatch", compareQuantities(null, "250").kind, "UNKNOWN");
  check("nor an empty box", compareQuantities("250", "").kind, "UNKNOWN");

  const admin = await prisma.user.findFirstOrThrow({ where: { role: { name: "ADMIN" } } });
  const formulator = await prisma.user.findFirstOrThrow({
    where: { isActive: true, role: { name: "FORMULATOR" } },
  });
  const fn = await prisma.sampleFunction.findFirstOrThrow({ select: { name: true } });
  const pf = await prisma.physicalForm.findFirstOrThrow({ select: { name: true } });
  const supplier = await prisma.supplier.findFirstOrThrow({ select: { name: true } });
  // A sample must name a project (SLT-13), so reception needs one even when the request
  // didn't carry one — see the note in the phase 9 commit.
  const project = await prisma.project.findFirstOrThrow({ select: { name: true } });
  // uid is a nullable unique column, and SQL Server allows exactly one NULL across the
  // table — a seeded row already holds that slot. Both app paths assign one from the
  // sequence, so seeding without one would be testing a shape the app never creates.
  const ingredientA = await prisma.ingredientListEntry.create({
    data: { uid: PREFIX + "A", inciName: PREFIX + "INCI ONE" },
  });
  const ingredientB = await prisma.ingredientListEntry.create({
    data: { uid: PREFIX + "B", inciName: PREFIX + "INCI TWO" },
  });

  const built = await prisma.sampleOrder.create({
    data: {
      requestType: "NEW",
      inciName: PREFIX + "MATERIAL",
      category: "Wax",
      source: "Synthetic",
      function: fn.name,
      physicalForm: pf.name,
      projectName: null,
      requiredQuantityG: "250",
      supplier1: "A", supplier2: "B",
      directorApprovalConfirmed: true,
      orderedById: formulator.id,
      status: "PR_ISSUED_AWAITING_RECEIPT",
      approvedById: admin.id,
      decidedAt: new Date(),
      prNumber: PREFIX + "PR-1",
      prIssuedAt: new Date(),
      ingredients: {
        create: [{ ingredientId: ingredientA.id }, { ingredientId: ingredientB.id }],
      },
      suppliers: {
        create: [1, 2].map((position) => ({
          position,
          supplierName: position === 2 ? supplier.name : `${PREFIX}Supplier ${position}`,
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
  });

  // 100 g over 3 pieces is the split that cannot be done evenly — 33.33, 33.33, 33.34 —
  // which is exactly what the reconciliation check is for.
  const form = new FormData();
  const fields: Record<string, string> = {
    orderId: built.id,
    pieceMode: "AUTO",
    sampleCode: PREFIX + "SAMPLE",
    rmName: PREFIX + "MATERIAL",
    category: "Wax",
    fragranceOrientation: "",
    function: fn.name,
    physicalForm: pf.name,
    source: "Synthetic",
    supplier: supplier.name,
    projectName: project.name,
    hazardClass: "Non-Hazardous",
    expiryDate: "2027-09-29",
    receptionDate: "2026-09-29",
    receivedQtyG: "100",
    receivedQtyPcs: "3",
    netWeightG: "100",
    batchLot: PREFIX + "LOT",
    documentAvailability: "YES",
    shelfLetter: "",
    shelfLevel: "",
    shelfSublevel: "",
  };
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  form.append("ingredientIds", ingredientA.id);
  form.append("ingredientIds", ingredientB.id);

  // Wherever the shelf rules put a Synthetic Wax — asked of the same resolver the form
  // uses, so this suite doesn't have to be rewritten when the shelf plan changes.
  const slot = await resolveShelfSlot({
    source: "Synthetic",
    category: "Wax",
    fragranceOrientation: null,
  });
  if (!slot || slot.letters.length === 0 || slot.levels.length === 0) {
    throw new Error("No shelf slot configured for a Synthetic Wax — cannot place the sample.");
  }
  // letters[0] + levels[0] is what the form pre-fills; a band resolves to its first cell.
  const slotLetter = slot.letters[0];
  const slotLevel = slot.levels[0];
  form.set("shelfLetter", slotLetter);
  form.set("shelfLevel", String(slotLevel));

  let sampleId: string | null = null;

  try {
    console.log("\n--- only an Admin receives ---");
    let blocked = false;
    try {
      await receive(built.id, "FORMULATOR", form, formulator.id);
    } catch (error) {
      blocked = (error as Error).message === "NOT_ADMIN";
    }
    check("a Formulator is refused", blocked, true);

    console.log("\n--- receiving it ---");
    sampleId = await receive(built.id, "ADMIN", form, admin.id);
    const order = await prisma.sampleOrder.findUniqueOrThrow({ where: { id: built.id } });
    check("the request is closed", order.status, "RECEIVED");
    check("against the sample it produced", order.producedSampleId, sampleId);
    check("with the code that was entered", order.receivedSampleCode, PREFIX + "SAMPLE");
    check("and the reception date", order.receivedAt?.toISOString().slice(0, 10), "2026-09-29");

    console.log("\n=== SLT-13's checks, against the sample reception created ===");
    const sample = await prisma.sample.findUniqueOrThrow({
      where: { id: sampleId },
      include: {
        pieces: { orderBy: { pieceIndex: "asc" } },
        ingredients: { include: { ingredient: { select: { inciName: true } } } },
        locationHistory: true,
      },
    });

    // Carried forward from the request, not retyped.
    check("it is in the library", sample.sampleCode, PREFIX + "SAMPLE");
    check("category carried over", sample.category, "Wax");
    check("source carried over", sample.source, "Synthetic");
    check("function carried over", sample.function, fn.name);
    check("physical form carried over", sample.physicalForm, pf.name);
    check("the chosen supplier carried over", sample.supplier, supplier.name);
    check("both INCI links carried over", sample.ingredients.length, 2);
    check("and they are the request's",
      sample.ingredients.map((i) => i.ingredient.inciName).sort().join(","),
      [PREFIX + "INCI ONE", PREFIX + "INCI TWO"].join(","));

    // Real pieces, split the way SLT-13 splits them.
    check("three pieces", sample.pieces.length, 3);
    check("numbered from one", sample.pieces.map((p) => p.pieceIndex).join(","), "1,2,3");
    check("the remainder lands on the last",
      sample.pieces.map((p) => p.originalWeightG.toString()).join(","), "33.33,33.33,33.34");
    check("and they reconcile to the total exactly",
      sample.pieces.reduce((sum, p) => sum + toCents(Number(p.originalWeightG)), 0),
      toCents(100));
    check("each starts wholly intact",
      sample.pieces.every((p) => p.remainingWeightG.toString() === p.originalWeightG.toString()),
      true);
    check("and on the shelf", sample.pieces.every((p) => p.status === "IN_STOCK"), true);

    // A real shelf address, from the same rules a directly-entered sample uses.
    check("placed where the shelf rules say", sample.shelfLetter, slotLetter);
    check("on the right level", sample.shelfLevel, slotLevel);
    check("with a resolvable address",
      shelfAddress(sample.shelfLetter!, sample.shelfLevel!), `${slotLetter}${slotLevel}`);
    check("and an opening location entry", sample.locationHistory.length, 1);
    check("dated the reception, not the save",
      sample.locationHistory[0].movedAt.toISOString().slice(0, 10), "2026-09-29");
    check("matching where it actually sits",
      sample.locationHistory[0].shelfLetter, sample.shelfLetter);

    console.log("\n--- and the delivery can't be received twice ---");
    blocked = false;
    try {
      await receive(built.id, "ADMIN", form, admin.id);
    } catch {
      blocked = true;
    }
    check("refused", blocked, true);
    check("still one sample for this request",
      await prisma.sample.count({ where: { sampleCode: PREFIX + "SAMPLE" } }), 1);

    console.log("\n=== wiring ===");
    // Both paths through one implementation is the whole basis for the checks above: a
    // second create would drift, and the one that drifted would be the sample nobody typed.
    const addAction = readFileSync("src/app/(app)/library/add/actions.ts", "utf8");
    const receiveAction = readFileSync(
      "src/app/(app)/orders/[id]/receive/actions.ts", "utf8"
    );
    for (const [name, src] of [["add", addAction], ["receive", receiveAction]] as const) {
      check(`${name} goes through the shared path`, /prepareSampleCreate\(/.test(src), true);
      check(`${name} builds no create of its own`, /sampleCode: data\.sampleCode/.test(src), false);
    }
    check("the sample and the order commit together",
      /\$transaction[\s\S]{0,700}producedSampleId: sample\.id/.test(receiveAction), true);
    check("and receiving is re-checked on the server",
      /checkReceiptReady\(order\)/.test(receiveAction), true);

    const page = readFileSync("src/app/(app)/orders/[id]/receive/page.tsx", "utf8");
    check("reception reuses the sample form", /<SampleForm/.test(page), true);
    check("prefilled from the request", /ingredientIds: order\.ingredients/.test(page), true);
    // Prefilling the quantity would make the comparison agree with itself.
    check("but not the quantity it is checking", /receivedQtyG: "",/.test(page), true);
    check("which it passes in to compare against",
      /requestedQuantityG=\{order\.requiredQuantityG\}/.test(page), true);

    const formSrc = readFileSync("src/app/(app)/library/sample-form.tsx", "utf8");
    check("the form compares as it is typed",
      /compareQuantities\(requestedQuantityG, qtyG\)/.test(formSrc), true);
    check("and shows a difference in red",
      /quantityComparison\.kind === "MATCH" \? "text-on-success" : "text-danger"/.test(formSrc),
      true);

    const detail = readFileSync("src/app/(app)/orders/[id]/page.tsx", "utf8");
    check("the request offers the way in", /mayReceive && \(/.test(detail), true);
  } finally {
    await wipe();
    console.log("\ncleanup done");
    await prisma.$disconnect();
  }

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}
main();
