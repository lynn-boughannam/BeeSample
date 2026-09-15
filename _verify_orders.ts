import "dotenv/config";
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { PrismaMssql } from "@prisma/adapter-mssql";
import { parseMssqlUrl } from "./src/lib/mssql-url";
import { CreateSampleOrderSchema } from "./src/lib/validation";
import {
  ORDER_REQUEST_TYPES,
  filledSupplierCount,
  needsExistingSample,
  needsShortSupplierListConfirmation,
  orderLabel,
  prefillsSupplier,
  usesThreeSuppliers,
} from "./src/lib/orders";

// SLT-58 step 1 acceptance criteria.

const PREFIX = "ZZ-ORD-";
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

const base = { directorApprovalConfirmed: true };

async function main() {
  console.log("=== request types and what each implies ===");
  check("three types", ORDER_REQUEST_TYPES.join(","), "NEW,EXISTING_NEW_SOURCE,EXISTING_SAME_SOURCE");
  check("AC1: new needs no sample", needsExistingSample("NEW"), false);
  check("AC1: new asks for 3 suppliers", usesThreeSuppliers("NEW"), true);
  check("AC1: new does not prefill a supplier", prefillsSupplier("NEW"), false);
  check("AC2: new source needs a sample", needsExistingSample("EXISTING_NEW_SOURCE"), true);
  check("AC2: new source leaves supplier empty", prefillsSupplier("EXISTING_NEW_SOURCE"), false);
  check("AC3: same source needs a sample", needsExistingSample("EXISTING_SAME_SOURCE"), true);
  check("AC3: same source prefills supplier", prefillsSupplier("EXISTING_SAME_SOURCE"), true);
  check("AC6: type 2 never nudges", usesThreeSuppliers("EXISTING_NEW_SOURCE"), false);
  check("AC6: type 3 never nudges", usesThreeSuppliers("EXISTING_SAME_SOURCE"), false);

  console.log("\n=== AC4: the attestation gates every submission ===");
  for (const type of ORDER_REQUEST_TYPES) {
    const sampleId = needsExistingSample(type) ? "x" : undefined;
    check(`${type} without attestation is rejected`,
      CreateSampleOrderSchema.safeParse({ requestType: type, existingSampleId: sampleId, directorApprovalConfirmed: false }).success,
      false);
    check(`${type} with attestation passes`,
      CreateSampleOrderSchema.safeParse({ requestType: type, existingSampleId: sampleId, ...base }).success,
      true);
  }
  check("an existing-sample type needs its sample",
    CreateSampleOrderSchema.safeParse({ requestType: "EXISTING_NEW_SOURCE", ...base }).success, false);

  console.log("\n=== AC5/AC6: the supplier nudge ===");
  check("0 of 3 on a new material nudges", needsShortSupplierListConfirmation("NEW", ["", "", ""]), true);
  check("1 of 3 nudges", needsShortSupplierListConfirmation("NEW", ["A", "", ""]), true);
  check("2 of 3 nudges", needsShortSupplierListConfirmation("NEW", ["A", "B", ""]), true);
  check("3 of 3 does not nudge", needsShortSupplierListConfirmation("NEW", ["A", "B", "C"]), false);
  check("whitespace doesn't count as a supplier", filledSupplierCount(["A", "   ", ""]), 1);
  check("whitespace-padded list still nudges", needsShortSupplierListConfirmation("NEW", ["A", "  ", "C"]), true);
  for (const type of ["EXISTING_NEW_SOURCE", "EXISTING_SAME_SOURCE"] as const) {
    check(`${type} never nudges, even with 0 suppliers`,
      needsShortSupplierListConfirmation(type, ["", "", ""]), false);
  }

  console.log("\n=== AC7: saved records ===");
  const admin = await prisma.user.findFirstOrThrow({ where: { role: { name: "ADMIN" } } });
  const sample = await prisma.sample.findFirstOrThrow({ where: { isDiscarded: false } });
  const before = new Date();

  const newReq = await prisma.sampleOrder.create({
    data: {
      requestType: "NEW", inciName: PREFIX + "BRAND NEW", supplier1: "Acme",
      application: "Skincare", requiredQuantityG: "500",
      directorApprovalConfirmed: true, shortSupplierListAcknowledged: true,
      orderedById: admin.id,
    },
  });
  const repeat = await prisma.sampleOrder.create({
    data: {
      requestType: "EXISTING_SAME_SOURCE", existingSampleId: sample.id,
      inciName: "prefilled inci", supplierName: sample.supplier, category: sample.category,
      directorApprovalConfirmed: true, orderedById: admin.id,
    },
  });

  try {
    const rows = await prisma.sampleOrder.findMany({
      where: { id: { in: [newReq.id, repeat.id] } },
      include: { orderedBy: { select: { name: true } }, existingSample: { select: { sampleCode: true, rmName: true } } },
    });
    const byId = (id: string) => rows.find((r) => r.id === id)!;

    check("responsible user recorded", byId(newReq.id).orderedBy.name, admin.name);
    check("submission date recorded", byId(newReq.id).createdAt >= before, true);
    check("attestation stored, not just enforced", byId(newReq.id).directorApprovalConfirmed, true);
    check("short-list acknowledgement stored", byId(newReq.id).shortSupplierListAcknowledged, true);
    check("a repeat order keeps its supplier", byId(repeat.id).supplierName, sample.supplier);
    check("a repeat order links its sample", byId(repeat.id).existingSampleId, sample.id);

    console.log("\n=== how a request is labelled ===");
    check("new material uses its INCI name", orderLabel(byId(newReq.id)), PREFIX + "BRAND NEW");
    check("existing sample uses code + name", orderLabel(byId(repeat.id)), `${sample.sampleCode} · ${sample.rmName}`);
    check("nothing filled falls back", orderLabel({ inciName: null, existingSample: null }), "New raw material");

    console.log("\n=== wiring ===");
    const form = readFileSync("src/app/(app)/orders/order-form.tsx", "utf8");
    check("attestation dialog present", /DIRECTOR_ATTESTATION/.test(form), true);
    check("supplier prompt present", /SHORT_SUPPLIER_LIST_PROMPT/.test(form), true);
    check('confirm button says "Yes, confirmed"', /Yes, confirmed/.test(form), true);
    check("attestation only posted once confirmed", /attested && <input type="hidden" name="directorApprovalConfirmed"/.test(form), true);

    const action = readFileSync("src/app/(app)/orders/actions.ts", "utf8");
    check("server re-checks the nudge", /needsShortSupplierListConfirmation/.test(action), true);
    check("user comes from the session", /orderedById: session\.user\.id/.test(action), true);
    check("open to formulators too", /verifySession\(\)/.test(action), true);
    // A call, not the word — the comment above it explains why verifySession is right.
    check("not admin-gated", /requireAdmin\(/.test(action), false);

    const newPage = readFileSync("src/app/(app)/orders/new/page.tsx", "utf8");
    check("supplier list built from Sample.supplier", /distinct: \["supplier"\]/.test(newPage), true);

    const lib = readFileSync("src/lib/orders.ts", "utf8");
    check("placeholder lists are flagged in code", /PLACEHOLDER VALUES/.test(lib), true);
    check("placeholder note is surfaced in the UI", /PLACEHOLDER_NOTE/.test(readFileSync("src/app/(app)/orders/page.tsx", "utf8")), true);
  } finally {
    await prisma.sampleOrder.deleteMany({ where: { id: { in: [newReq.id, repeat.id] } } });
    console.log("\ncleanup done");
    await prisma.$disconnect();
  }

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}
main();
