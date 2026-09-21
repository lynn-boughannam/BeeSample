import "dotenv/config";
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { PrismaMssql } from "@prisma/adapter-mssql";
import { parseMssqlUrl } from "./src/lib/mssql-url";
import {
  SUPPLIER_STAGES,
  SUPPLIER_STAGE_LABELS,
  canEditSupplierSubmission,
  canSubmitSupplierToCss,
  readyForCssReview,
  supplierStage,
} from "./src/lib/orders";

// Phase 3 — documents attached and priced. A supplier reaches "documents attached, pending
// CSS review" only when both its paperwork and its quoted terms are in.

const PREFIX = "ZZ-P3-";
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

const stageOf = (
  docs: number,
  price: unknown,
  moq: string | null,
  css = "PENDING",
  submittedToCssAt: Date | null = null
) => supplierStage({ documentCount: docs, landedPrice: price, moq, cssDecision: css, submittedToCssAt });

async function main() {
  console.log("=== a supplier only reaches CSS with both halves in ===");
  check("nothing yet", stageOf(0, null, null), "AWAITING_DOCUMENTS");
  check("priced but no documents", stageOf(0, "12.50", "25 kg"), "AWAITING_DOCUMENTS");
  check("documents but no price", stageOf(1, null, null), "AWAITING_PRICING");
  check("documents and price but no MOQ", stageOf(2, "12.50", null), "AWAITING_PRICING");
  check("an MOQ of spaces doesn't count", stageOf(2, "12.50", "   "), "AWAITING_PRICING");
  check("documents and MOQ but no price", stageOf(2, null, "25 kg"), "AWAITING_PRICING");
  check("both in -> ready to send", stageOf(2, "12.50", "25 kg"), "READY_TO_SUBMIT");
  check("a zero price still counts", stageOf(1, "0.00", "1 kg"), "READY_TO_SUBMIT");
  check("sent -> pending CSS", stageOf(2, "12.50", "25 kg", "PENDING", new Date()), "PENDING_CSS");
  check("the label is the one the brief names",
    SUPPLIER_STAGE_LABELS.PENDING_CSS, "Documents attached – pending CSS review");

  console.log("\n=== a repeat order needs no documents to move on ===");
  // Its paperwork is already on file, so requiring an attachment would leave it waiting
  // for something nobody is going to send.
  const sameSource = (docs: number, price: unknown, moq: string | null) =>
    supplierStage({
      documentCount: docs,
      landedPrice: price,
      moq,
      cssDecision: "PENDING",
      needsDocuments: false,
    });
  check("no documents, no price -> awaiting pricing", sameSource(0, null, null), "AWAITING_PRICING");
  check("no documents but priced -> ready to send", sameSource(0, "12.50", "25 kg"), "READY_TO_SUBMIT");
  check("a new source still needs them", stageOf(0, "12.50", "25 kg"), "AWAITING_DOCUMENTS");

  console.log("\n=== a CSS decision overrides the rest ===");
  check("approved", stageOf(2, "12.50", "25 kg", "APPROVED"), "CSS_APPROVED");
  check("rejected", stageOf(2, "12.50", "25 kg", "REJECTED"), "CSS_REJECTED");
  check("and does so even with nothing attached", stageOf(0, null, null, "APPROVED"), "CSS_APPROVED");
  check("every stage has a label",
    SUPPLIER_STAGES.every((st) => Boolean(SUPPLIER_STAGE_LABELS[st])), true);

  console.log("\n=== the order as a whole ===");
  // "Ready for CSS" now means sent, not merely fillable — the submit is what hands it over.
  const sentAt = new Date();
  const ready = [
    { documentCount: 1, landedPrice: "1.00", moq: "1 kg", cssDecision: "PENDING", submittedToCssAt: sentAt },
    { documentCount: 2, landedPrice: "2.00", moq: "2 kg", cssDecision: "PENDING", submittedToCssAt: sentAt },
  ];
  check("all suppliers sent", readyForCssReview(ready), true);
  check("filled in but unsent isn't with CSS",
    readyForCssReview([{ documentCount: 1, landedPrice: "1.00", moq: "1 kg", cssDecision: "PENDING" }]),
    false);
  check("one lagging holds it back",
    readyForCssReview([...ready, { documentCount: 0, landedPrice: null, moq: null, cssDecision: "PENDING" }]),
    false);
  check("no suppliers at all isn't ready", readyForCssReview([]), false);

  console.log("\n=== against real rows ===");
  const admin = await prisma.user.findFirstOrThrow({ where: { role: { name: "ADMIN" } } });
  const samer = await prisma.user.findFirstOrThrow({ where: { role: { name: "SUPPLY_CHAIN" } } });

  const order = await prisma.sampleOrder.create({
    data: {
      requestType: "NEW", inciName: PREFIX + "MATERIAL", supplier1: "Acme",
      directorApprovalConfirmed: true, orderedById: admin.id,
      status: "APPROVED_PENDING_SUPPLY_CHAIN", approvedById: admin.id, decidedAt: new Date(),
      suppliers: { create: [{ position: 1, supplierName: PREFIX + "Acme" }] },
    },
    include: { suppliers: true },
  });
  const supplierId = order.suppliers[0].id;

  const reload = async () => {
    const row = await prisma.sampleOrderSupplier.findUniqueOrThrow({
      where: { id: supplierId },
      include: { documents: true },
    });
    return {
      row,
      stage: supplierStage({
        documentCount: row.documents.length,
        landedPrice: row.landedPrice,
        moq: row.moq,
        cssDecision: row.cssDecision,
        submittedToCssAt: row.submittedToCssAt,
      }),
    };
  };

  try {
    check("starts awaiting documents", (await reload()).stage, "AWAITING_DOCUMENTS");

    console.log("\n--- Samer attaches a COA and an SDS ---");
    for (const name of ["coa.pdf", "sds.pdf"]) {
      await prisma.sampleOrderSupplierDocument.create({
        data: {
          orderSupplierId: supplierId, fileName: name, uploadedById: samer.id,
          content: Buffer.from(`%PDF-1.4 ${name}`), contentType: "application/pdf", sizeBytes: 16,
        },
      });
    }
    await prisma.sampleOrderSupplier.update({
      where: { id: supplierId }, data: { documentsReceivedAt: new Date() },
    });
    const attached = await reload();
    check("two documents on the supplier", attached.row.documents.length, 2);
    check("but still awaiting pricing", attached.stage, "AWAITING_PRICING");

    console.log("\n--- and enters the price and MOQ ---");
    await prisma.sampleOrderSupplier.update({
      where: { id: supplierId }, data: { landedPrice: "12.50", moq: "25 kg" },
    });
    const priced = await reload();
    check("price stored exactly", priced.row.landedPrice?.toString(), "12.5");
    check("MOQ stored", priced.row.moq, "25 kg");
    check("ready to send, not yet sent", priced.stage, "READY_TO_SUBMIT");
    check("not yet with CSS — it hasn't been sent",
      readyForCssReview([{
        documentCount: priced.row.documents.length,
        landedPrice: priced.row.landedPrice,
        moq: priced.row.moq,
        cssDecision: priced.row.cssDecision,
        submittedToCssAt: priced.row.submittedToCssAt,
      }]), false);

    console.log("\n--- sending it to CSS locks it ---");
    check("it can be sent now", canSubmitSupplierToCss({
      documentCount: priced.row.documents.length,
      landedPrice: priced.row.landedPrice,
      moq: priced.row.moq,
      cssDecision: priced.row.cssDecision,
      submittedToCssAt: priced.row.submittedToCssAt,
    }), true);
    check("and is editable until then", canEditSupplierSubmission(priced.row), true);

    await prisma.sampleOrderSupplier.update({
      where: { id: supplierId },
      data: { submittedToCssAt: new Date() },
    });
    const sent = await reload();
    check("now pending CSS review", sent.stage, "PENDING_CSS");
    check("and no longer editable", canEditSupplierSubmission(sent.row), false);
    check("it can't be sent twice", canSubmitSupplierToCss({
      documentCount: sent.row.documents.length,
      landedPrice: sent.row.landedPrice,
      moq: sent.row.moq,
      cssDecision: sent.row.cssDecision,
      submittedToCssAt: sent.row.submittedToCssAt,
    }), false);
    // A submitted supplier stays submitted even if its documents were somehow removed.
    check("submission outranks the field rules",
      stageOf(0, null, null, "PENDING", sent.row.submittedToCssAt), "PENDING_CSS");
    check("the order is now with CSS",
      readyForCssReview([{
        documentCount: sent.row.documents.length,
        landedPrice: sent.row.landedPrice,
        moq: sent.row.moq,
        cssDecision: sent.row.cssDecision,
        submittedToCssAt: sent.row.submittedToCssAt,
      }]), true);

    console.log("\n--- the file is retrievable ---");
    const doc = priced.row.documents.find((d) => d.fileName === "coa.pdf")!;
    const fetched = await prisma.sampleOrderSupplierDocument.findUniqueOrThrow({
      where: { id: doc.id },
    });
    check("bytes come back intact",
      Buffer.from(fetched.content).toString(), "%PDF-1.4 coa.pdf");
    check("with its content type", fetched.contentType, "application/pdf");

    console.log("\n--- before submission, removing documents takes it back ---");
    await prisma.sampleOrderSupplier.update({
      where: { id: supplierId },
      data: { submittedToCssAt: null },
    });
    await prisma.sampleOrderSupplierDocument.deleteMany({ where: { orderSupplierId: supplierId } });
    check("back to awaiting documents, pricing kept", (await reload()).stage, "AWAITING_DOCUMENTS");

    console.log("\n=== wiring ===");
    const action = readFileSync("src/app/(app)/supply-chain/actions.ts", "utf8");
    check("only Supply Chain prices", /Only Supply Chain can enter supplier pricing/.test(action), true);
    check("both fields are required", /Enter the landed price[\s\S]*Enter the MOQ/.test(action), true);
    check("a negative price is refused", /price < 0/.test(action), true);
    check("the exact figure is kept", /price\.toFixed\(2\)/.test(action), true);
    check("the order must be with Supply Chain", /isAwaitingSupplyChain/.test(action), true);

    // The lock has to hold on the server, not just by hiding a form.
    check("attaching is refused after submission",
      /can no longer be changed/.test(action), true);
    check("repricing is refused after submission",
      /can no longer be repriced/.test(action), true);
    check("deleting a document is refused after submission",
      (action.match(/canEditSupplierSubmission/g) ?? []).length >= 4, true);
    check("submitting twice is refused", /has already been sent to CSS/.test(action), true);
    check("submitting re-checks readiness against the row",
      /canSubmitSupplierToCss\(\{/.test(action), true);

    // Acting happens on the request, not in the queue — the queue is for scanning. So
    // these are the detail page's job alone.
    const detailSrc = readFileSync("src/app/(app)/orders/[id]/page.tsx", "utf8");
    check("the detail page hides the forms once sent",
      /canEditSupplierSubmission\(/.test(detailSrc), true);
    check("it offers the send button only when ready",
      /stage === "READY_TO_SUBMIT"/.test(detailSrc), true);

    console.log("\n=== the queue is a table of what this job needs ===");
    const queue = readFileSync("src/app/(app)/supply-chain/page.tsx", "utf8");
    check("it renders a table", /<table/.test(queue), true);
    check("one row per supplier, not per order", /flatMap\(\(order\)/.test(queue), true);
    for (const col of ["Request", "Supplier", "Stage", "Docs", "Landed price", "MOQ", "Asked for", "Due"]) {
      check(`column: ${col}`, new RegExp(`<Th[^>]*>${col}<`).test(queue), true);
    }
    // Formulation detail belongs on the request, not in a procurement worklist.
    for (const noise of ["Physical form", "Fragrance orientation", "Dosage", "Application"]) {
      check(`not shown: ${noise}`, queue.includes(`>${noise}<`), false);
    }
    check("it never loads document bytes", /content: true/.test(queue), false);
    check("a same-source row is told its documents are on file", /on file/.test(queue), true);
    check("outstanding work sorts above work already sent",
      /STAGE_URGENCY/.test(queue), true);
    check("acting happens on the request", /Open a request to attach documents/.test(queue), true);

    const submitBtn = readFileSync("src/app/(app)/supply-chain/submit-button.tsx", "utf8");
    check("sending asks for confirmation", /can&apos;t be changed after this/.test(submitBtn), true);

    // Both screens read the same derived stage, so a supplier can't look one way in the
    // queue and another on the request.
    check("the queue shows the derived stage", /supplierStage\(\{/.test(queue), true);
    check("the detail page shows the same one", /supplierStage\(\{/.test(detailSrc), true);
    check("the pricing form lives on the request", /<PricingForm/.test(detailSrc), true);
    check("and not in the queue", /<PricingForm/.test(queue), false);

    const form = readFileSync("src/app/(app)/supply-chain/pricing-form.tsx", "utf8");
    check("the form asks for both together",
      /name="landedPrice"[\s\S]*name="moq"/.test(form), true);
  } finally {
    await prisma.sampleOrderSupplierDocument.deleteMany({
      where: { orderSupplier: { order: { inciName: { startsWith: PREFIX } } } },
    });
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
