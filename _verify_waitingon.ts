import "dotenv/config";
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { PrismaMssql } from "@prisma/adapter-mssql";
import { parseMssqlUrl } from "./src/lib/mssql-url";
import { orderWaitingOn } from "./src/lib/orders";

// The stored order status parks at "Approved – Pending Supply Chain" while the real work
// happens per supplier. This derives what a request is genuinely waiting on, so a badge can
// say so without inventing a stored transition.

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

const NEW = { status: "APPROVED_PENDING_SUPPLY_CHAIN", requestType: "NEW" };
const SAME = { status: "APPROVED_PENDING_SUPPLY_CHAIN", requestType: "EXISTING_SAME_SOURCE" };
const sent = new Date();

const sup = (o: Partial<{
  documentCount: number;
  landedPrice: unknown;
  moq: string | null;
  cssDecision: string;
  submittedToCssAt: Date | null;
}> = {}) => ({
  documentCount: 0,
  landedPrice: null,
  moq: null,
  cssDecision: "PENDING",
  submittedToCssAt: null,
  ...o,
});

const priced = { documentCount: 1, landedPrice: "10.00", moq: "5 kg" };

async function main() {
  console.log("=== only the stage that hides work needs explaining ===");
  for (const status of ["SUBMITTED", "REJECTED", "SUPPLIER_SELECTED", "RECEIVED"]) {
    check(`${status} says it all already`,
      orderWaitingOn({ status, requestType: "NEW" }, [sup()]), "null");
  }

  console.log("\n=== it names the earliest thing still outstanding ===");
  check("nothing recorded",
    orderWaitingOn(NEW, [])?.label, "No supplier options recorded");
  check("all three awaiting documents",
    orderWaitingOn(NEW, [sup(), sup(), sup()])?.label, "Awaiting documents (3 of 3)");
  // Documents in on two, so the earliest outstanding thing is still the third's documents.
  check("documents outrank pricing",
    orderWaitingOn(NEW, [sup(), sup(priced), sup(priced)])?.label, "Awaiting documents (1 of 3)");
  check("all documented, none priced",
    orderWaitingOn(NEW, [sup({ documentCount: 1 }), sup({ documentCount: 1 })])?.label,
    "Awaiting price & MOQ (2 of 2)");
  check("priced but unsent",
    orderWaitingOn(NEW, [sup(priced), sup(priced)])?.label, "Ready to send to CSS (2 of 2)");
  check("one sent, one still to send",
    orderWaitingOn(NEW, [sup({ ...priced, submittedToCssAt: sent }), sup(priced)])?.label,
    "Ready to send to CSS (1 of 2)");
  check("all with CSS",
    orderWaitingOn(NEW, [
      sup({ ...priced, submittedToCssAt: sent }),
      sup({ ...priced, submittedToCssAt: sent }),
    ])?.label, "With CSS (2 of 2)");

  console.log("\n=== once CSS is done it stops claiming to wait on Supply Chain ===");
  const approvedOne = sup({ ...priced, submittedToCssAt: sent, cssDecision: "APPROVED" });
  const rejectedOne = sup({ ...priced, submittedToCssAt: sent, cssDecision: "REJECTED" });
  check("one approved, one rejected",
    orderWaitingOn(NEW, [approvedOne, rejectedOne])?.label,
    "Documents approved — ready to select (1 of 2)");
  check("and it reads as done, not pending",
    orderWaitingOn(NEW, [approvedOne, rejectedOne])?.tone, "success");
  check("two approved",
    orderWaitingOn(NEW, [approvedOne, approvedOne])?.label,
    "Documents approved — ready to select (2 of 2)");
  // A rejected sibling must not drag the request back to an earlier stage.
  check("a rejected option doesn't reopen an earlier stage",
    orderWaitingOn(NEW, [rejectedOne, approvedOne])?.label,
    "Documents approved — ready to select (1 of 2)");

  console.log("\n=== a repeat order isn't held up by documents it already has ===");
  check("same source, nothing entered",
    orderWaitingOn(SAME, [sup()])?.label, "Awaiting price & MOQ (1 of 1)");
  check("same source, priced",
    orderWaitingOn(SAME, [sup({ landedPrice: "10.00", moq: "5 kg" })])?.label,
    "Ready to send to CSS (1 of 1)");
  check("a new source still waits for them",
    orderWaitingOn(NEW, [sup({ landedPrice: "10.00", moq: "5 kg" })])?.label,
    "Awaiting documents (1 of 1)");

  console.log("\n=== against the live requests ===");
  const orders = await prisma.sampleOrder.findMany({
    include: {
      existingSample: { select: { sampleCode: true } },
      suppliers: { select: {
        landedPrice: true, moq: true, cssDecision: true, submittedToCssAt: true,
        _count: { select: { documents: true } },
      } },
    },
  });
  console.table(orders.map((o) => ({
    request: o.existingSample?.sampleCode ?? o.inciName ?? "?",
    storedStatus: o.status,
    waitingOn: orderWaitingOn(o, o.suppliers.map((s) => ({
      documentCount: s._count.documents,
      landedPrice: s.landedPrice,
      moq: s.moq,
      cssDecision: s.cssDecision,
      submittedToCssAt: s.submittedToCssAt,
    })))?.label ?? "—",
  })));

  console.log("\n=== wiring ===");
  const detail = readFileSync("src/app/(app)/orders/[id]/page.tsx", "utf8");
  const list = readFileSync("src/app/(app)/orders/page.tsx", "utf8");
  check("the detail page shows it", /orderWaitingOn\(order,/.test(detail), true);
  check("the list shows it too", /orderWaitingOn\(/.test(list), true);
  check("both derive it, neither stores it",
    /sampleOrder\.update[\s\S]{0,200}status:/.test(detail) ||
      /sampleOrder\.update[\s\S]{0,200}status:/.test(list), false);
  check("the list never loads document bytes", /content: true/.test(list), false);

  await prisma.$disconnect();
  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}
main();
