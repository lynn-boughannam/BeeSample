import "dotenv/config";
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { PrismaMssql } from "@prisma/adapter-mssql";
import { parseMssqlUrl } from "./src/lib/mssql-url";
import {
  documentWorkingDaysElapsed,
  supplierDocumentDueDate,
  supplierDocumentSlaLevel,
} from "./src/lib/working-days";
import { MAX_DOCUMENTS_PER_UPLOAD, MAX_DOCUMENT_BYTES, ALLOWED_DOCUMENT_TYPES } from "./src/lib/orders";

// Supply Chain documents: the SLA now runs from when the request reached Samer, and the
// step closes by attaching the files themselves — several per supplier.

const PREFIX = "ZZ-DOC-";
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

// Step back N working days from a date.
function backWorkingDays(from: Date, n: number): Date {
  const d = new Date(from);
  let moved = 0;
  while (moved < n) {
    d.setDate(d.getDate() - 1);
    if (d.getDay() !== 0 && d.getDay() !== 6) moved++;
  }
  return d;
}

async function main() {
  console.log("=== the clock starts when the request reaches Supply Chain ===");
  const approved = new Date(2026, 8, 7, 9, 0); // a Monday
  check("nothing approved yet is never a warning", supplierDocumentSlaLevel(null), "NONE");
  check("day 0", supplierDocumentSlaLevel(approved, null, approved), "NONE");
  check("4 working days on", supplierDocumentSlaLevel(approved, null, backWorkingDays(new Date(2026, 8, 11, 9), 0)), "NONE");

  const at = (n: number) => {
    const d = new Date(approved);
    let moved = 0;
    while (moved < n) {
      d.setDate(d.getDate() + 1);
      if (d.getDay() !== 0 && d.getDay() !== 6) moved++;
    }
    return d;
  };
  for (const n of [0, 1, 4]) {
    check(`${n} working days after approval`, supplierDocumentSlaLevel(approved, null, at(n)), "NONE");
  }
  for (const n of [5, 6]) {
    check(`${n} working days after approval`, supplierDocumentSlaLevel(approved, null, at(n)), "WARNING");
  }
  for (const n of [7, 9]) {
    check(`${n} working days after approval`, supplierDocumentSlaLevel(approved, null, at(n)), "OVERDUE");
  }

  console.log("\n=== attaching stops the clock ===");
  // Documents in at day 3; the level must stay NONE however long ago that was.
  const inAtDay3 = at(3);
  check("delivered inside the window stays green",
    supplierDocumentSlaLevel(approved, inAtDay3, at(30)), "NONE");
  check("and is judged on how long it took, not how long ago",
    documentWorkingDaysElapsed(approved, inAtDay3, at(30)), 3);
  // Delivered late stays late forever, which is the point of recording it.
  check("delivered outside the window stays red",
    supplierDocumentSlaLevel(approved, at(9), at(30)), "OVERDUE");
  check("an outstanding one keeps counting",
    documentWorkingDaysElapsed(approved, null, at(12)), 12);

  console.log("\n=== the old anchor is gone ===");
  const sc = readFileSync("src/app/(app)/supply-chain/page.tsx", "utf8");
  const detail = readFileSync("src/app/(app)/orders/[id]/page.tsx", "utf8");
  for (const [name, src] of [["queue", sc], ["detail", detail]] as const) {
    check(`${name} measures from approval`,
      /supplierDocumentSlaLevel\(order\.decidedAt/.test(src), true);
    check(`${name} no longer measures from the request log`,
      /supplierDocumentSlaLevel\(s?u?p?p?l?i?e?r?\.?documentsRequestedAt/.test(src), false);
  }

  console.log("\n=== upload limits ===");
  check("10 MB cap", MAX_DOCUMENT_BYTES, 10 * 1024 * 1024);
  check("batch cap", MAX_DOCUMENTS_PER_UPLOAD, 10);
  check("PDF allowed", ALLOWED_DOCUMENT_TYPES.has("application/pdf"), true);
  check("scans allowed", ALLOWED_DOCUMENT_TYPES.has("image/jpeg"), true);
  check("executables refused", ALLOWED_DOCUMENT_TYPES.has("application/x-msdownload"), false);

  console.log("\n=== against real rows ===");
  const admin = await prisma.user.findFirstOrThrow({ where: { role: { name: "ADMIN" } } });
  const samer = await prisma.user.findFirstOrThrow({ where: { role: { name: "SUPPLY_CHAIN" } } });
  const decidedAt = backWorkingDays(new Date(), 6); // already amber

  const order = await prisma.sampleOrder.create({
    data: {
      requestType: "NEW", inciName: PREFIX + "MATERIAL", supplier1: "Acme",
      directorApprovalConfirmed: true, orderedById: admin.id,
      status: "APPROVED_PENDING_SUPPLY_CHAIN", approvedById: admin.id, decidedAt,
      suppliers: { create: [{ position: 1, supplierName: PREFIX + "Acme" }] },
    },
    include: { suppliers: true },
  });
  const supplierId = order.suppliers[0].id;

  try {
    check("an untouched supplier is already amber at 6 working days",
      supplierDocumentSlaLevel(order.decidedAt, null), "WARNING");
    check("the due date comes off the approval",
      supplierDocumentDueDate(order.decidedAt!).getTime() > order.decidedAt!.getTime(), true);

    console.log("\n--- attaching two documents, as a COA and an SDS would arrive ---");
    const files = [
      { fileName: "coa.pdf", content: Buffer.from("%PDF-1.4 coa"), contentType: "application/pdf", sizeBytes: 12 },
      { fileName: "sds.pdf", content: Buffer.from("%PDF-1.4 sds"), contentType: "application/pdf", sizeBytes: 12 },
    ];
    await prisma.$transaction(async (tx) => {
      for (const f of files) {
        await tx.sampleOrderSupplierDocument.create({
          data: { orderSupplierId: supplierId, uploadedById: samer.id, ...f },
        });
      }
      await tx.sampleOrderSupplier.update({
        where: { id: supplierId },
        data: { documentsReceivedAt: new Date() },
      });
    });

    const withDocs = await prisma.sampleOrderSupplier.findUniqueOrThrow({
      where: { id: supplierId },
      include: { documents: { orderBy: { fileName: "asc" } } },
    });
    check("both documents are on the one supplier", withDocs.documents.length, 2);
    check("they keep their names",
      withDocs.documents.map((d) => d.fileName).join(","), "coa.pdf,sds.pdf");
    check("the bytes round-trip",
      Buffer.from(withDocs.documents[0].content).toString(), "%PDF-1.4 coa");
    check("who attached them is recorded", withDocs.documents[0].uploadedById, samer.id);
    check("the clock stopped", withDocs.documentsReceivedAt !== null, true);
    // The level keeps recording how long it took — 6 working days is in the amber band
    // whether or not the documents have since arrived. What changes once they are in is
    // that the row stops being tinted, so the queue only highlights what still needs doing.
    check("the level still records that it took 6 working days",
      supplierDocumentSlaLevel(order.decidedAt, withDocs.documentsReceivedAt), "WARNING");
    check("delivered promptly would have been green",
      supplierDocumentSlaLevel(order.decidedAt, backWorkingDays(new Date(), 4)), "NONE");
    check("the queue stops tinting a row once documents are in",
      /done \? "" : SLA_ROW_CLASS\[level\]/.test(sc), true);
    check("so does the detail page",
      /done \? "" : SLA_ROW_CLASS\[sla\]/.test(detail), true);

    console.log("\n--- a third document doesn't move the received date ---");
    const firstStamp = withDocs.documentsReceivedAt!.getTime();
    await prisma.sampleOrderSupplierDocument.create({
      data: {
        orderSupplierId: supplierId, uploadedById: samer.id, fileName: "spec.pdf",
        content: Buffer.from("spec"), contentType: "application/pdf", sizeBytes: 4,
      },
    });
    const after = await prisma.sampleOrderSupplier.findUniqueOrThrow({
      where: { id: supplierId },
      include: { documents: true },
    });
    check("three documents now", after.documents.length, 3);
    check("received date unchanged", after.documentsReceivedAt!.getTime(), firstStamp);

    console.log("\n--- removing the last one reopens the clock ---");
    await prisma.sampleOrderSupplierDocument.deleteMany({ where: { orderSupplierId: supplierId } });
    await prisma.sampleOrderSupplier.update({
      where: { id: supplierId },
      data: { documentsReceivedAt: null },
    });
    const reopened = await prisma.sampleOrderSupplier.findUniqueOrThrow({ where: { id: supplierId } });
    check("clock running again", supplierDocumentSlaLevel(order.decidedAt, reopened.documentsReceivedAt), "WARNING");

    console.log("\n=== wiring ===");
    const action = readFileSync("src/app/(app)/supply-chain/actions.ts", "utf8");
    check("only Supply Chain may attach", /role !== "SUPPLY_CHAIN" && role !== "ADMIN"/.test(action), true);
    check("several files per upload", /getAll\("documents"\)/.test(action), true);
    check("oversized files refused", /larger than 10 MB/.test(action), true);
    check("unexpected types refused", /ALLOWED_DOCUMENT_TYPES\.has/.test(action), true);
    check("the received stamp is set once", /if \(!row\.documentsReceivedAt\)/.test(action), true);
    check("removing the last one clears it", /left === 0/.test(action), true);

    const route = readFileSync("src/app/api/order-documents/[id]/route.ts", "utf8");
    check("downloads require a session", /if \(!session\?\.user\)/.test(route), true);
    check("a stranger gets the same answer as a missing file", /Not found/.test(route), true);

    const panel = readFileSync("src/app/(app)/supply-chain/document-panel.tsx", "utf8");
    check("the picker takes several files", /multiple/.test(panel), true);
    check("documents link to the authenticated route", /api\/order-documents/.test(panel), true);

    // Rendering a list must never pull the file bytes back out of the database.
    for (const [name, src] of [["queue", sc], ["detail", detail]] as const) {
      check(`${name} never selects the bytes`, /content: true/.test(src), false);
    }
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
