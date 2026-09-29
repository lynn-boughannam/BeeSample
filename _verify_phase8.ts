import "dotenv/config";
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { PrismaMssql } from "@prisma/adapter-mssql";
import { parseMssqlUrl } from "./src/lib/mssql-url";
import { loadAdminDashboard } from "./src/lib/dashboard";
import {
  MAX_PR_NUMBER_LENGTH,
  canIssuePr,
  checkPrReady,
  normalisePrNumber,
  orderStatusAfterPrIssued,
} from "./src/lib/orders";

// Phase 8 — the PR is raised in the purchasing system; its reference is recorded here.
//
// Needs --conditions=react-server: loadAdminDashboard imports a server-only module.

const prisma = new PrismaClient({
  adapter: new PrismaMssql(parseMssqlUrl(process.env.DATABASE_URL!)),
});

const PREFIX = "ZZ-P8-";
let failures = 0;
const check = (label: string, actual: unknown, expected: unknown) => {
  const ok = String(actual) === String(expected);
  if (!ok) failures++;
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${label.padEnd(58)} ${actual}${ok ? "" : `   (expected ${expected})`}`
  );
};

// Mirrors issuePurchaseRequisition() in pr-actions.ts.
async function issue(orderId: string, role: string, raw: string) {
  if (!canIssuePr(role)) throw new Error("NOT_ADMIN");
  const prNumber = normalisePrNumber(raw);
  if (!prNumber) throw new Error("BAD_REFERENCE");
  const order = await prisma.sampleOrder.findUniqueOrThrow({
    where: { id: orderId },
    select: { id: true, status: true, prNumber: true },
  });
  const ready = checkPrReady(order);
  if (!ready.ok) throw new Error(ready.reason);

  await prisma.sampleOrder.update({
    where: { id: orderId },
    data: { prNumber, status: orderStatusAfterPrIssued() },
  });
}

async function main() {
  console.log("=== raising the PR is the Admin's, not the requester's ===");
  // Unlike the two decisions before it: those are judgements only the requester can make,
  // but the PR records a decision already taken, so a colleague can cover.
  check("an Admin may", canIssuePr("ADMIN"), true);
  check("a Formulator may not", canIssuePr("FORMULATOR"), false);
  check("nor Supply Chain", canIssuePr("SUPPLY_CHAIN"), false);
  check("nor CSS", canIssuePr("CSS"), false);

  console.log("\n=== when a PR may be recorded ===");
  check("once the costing is approved",
    checkPrReady({ status: "FORMULATOR_APPROVED_PENDING_PR" }).ok, true);
  const early = checkPrReady({ status: "COSTING_SUBMITTED_PENDING_FORMULATOR" });
  check("not before it is", early.ok, false);
  check("and says what is missing",
    early.ok ? "" : early.reason, "The costing hasn't been approved yet.");
  // Once raised, the reference is in the refusal — the answer to "was one raised?" is the
  // number itself, not just "no".
  const already = checkPrReady({ status: "PR_ISSUED_AWAITING_RECEIPT", prNumber: "PR-123" });
  check("not twice", already.ok, false);
  check("and names the one that exists",
    already.ok ? "" : already.reason,
    "A PR was already raised for this request (PR-123).");
  check("a rejected request gets no PR", checkPrReady({ status: "REJECTED" }).ok, false);

  console.log("\n=== the reference is trimmed, not judged ===");
  // Its format belongs to the purchasing system. A rule invented here would eventually
  // reject a real PR number, which would mean the reference that matters can't be recorded.
  check("surrounding space is dropped", normalisePrNumber("  PR-2026-014  "), "PR-2026-014");
  check("empty is not a reference", normalisePrNumber("   "), null);
  check("nor is something absurdly long",
    normalisePrNumber("x".repeat(MAX_PR_NUMBER_LENGTH + 1)), null);
  check("a house format is accepted as given", normalisePrNumber("PR/26/0142-B"), "PR/26/0142-B");
  check("and so is one that looks nothing like it", normalisePrNumber("4500123987"), "4500123987");

  const admin = await prisma.user.findFirstOrThrow({ where: { role: { name: "ADMIN" } } });
  const formulator = await prisma.user.findFirstOrThrow({
    where: { isActive: true, role: { name: "FORMULATOR" } },
  });

  const built = await prisma.sampleOrder.create({
    data: {
      requestType: "NEW", inciName: PREFIX + "MATERIAL", requiredQuantityG: "250",
      supplier1: "A", supplier2: "B",
      directorApprovalConfirmed: true, orderedById: formulator.id,
      status: "FORMULATOR_APPROVED_PENDING_PR", approvedById: admin.id, decidedAt: new Date(),
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
  });

  const reload = () => prisma.sampleOrder.findUniqueOrThrow({ where: { id: built.id } });

  try {
    console.log("\n--- Rawan is told the work has arrived ---");
    // Without this the request would only be reachable by someone who happened to open it:
    // the PR lands on a request the Admin may never have touched.
    const dash = await loadAdminDashboard(admin.id);
    check("the dashboard counts it", dash.kpis.awaitingPr >= 1, true);

    console.log("\n--- only an Admin records it ---");
    let blocked = false;
    try {
      await issue(built.id, "FORMULATOR", "PR-1");
    } catch (error) {
      blocked = (error as Error).message === "NOT_ADMIN";
    }
    check("a Formulator is refused", blocked, true);
    check("and nothing was recorded", (await reload()).prNumber, "null");

    console.log("\n--- an empty reference is refused ---");
    blocked = false;
    try {
      await issue(built.id, "ADMIN", "   ");
    } catch (error) {
      blocked = (error as Error).message === "BAD_REFERENCE";
    }
    check("refused", blocked, true);
    check("and the request has not moved",
      (await reload()).status, "FORMULATOR_APPROVED_PENDING_PR");

    console.log("\n--- recording it ---");
    await issue(built.id, "ADMIN", "  PR-2026-014 ");
    let now = await reload();
    check("stored trimmed", now.prNumber, "PR-2026-014");
    check("and the request awaits the material", now.status, "PR_ISSUED_AWAITING_RECEIPT");

    console.log("\n--- and not a second time ---");
    blocked = false;
    try {
      await issue(built.id, "ADMIN", "PR-DUPLICATE");
    } catch {
      blocked = true;
    }
    check("refused", blocked, true);
    now = await reload();
    check("the first reference stands", now.prNumber, "PR-2026-014");
    check("the status too", now.status, "PR_ISSUED_AWAITING_RECEIPT");

    console.log("\n=== wiring ===");
    const action = readFileSync("src/app/(app)/orders/[id]/pr-actions.ts", "utf8");
    check("the role is re-checked on the server",
      /canIssuePr\(session\.user\.role\)/.test(action), true);
    check("so is the status", /checkPrReady\(order\)/.test(action), true);
    check("reference and status are written together",
      /data: \{ prNumber, status: orderStatusAfterPrIssued\(\) \}/.test(action), true);

    const detail = readFileSync("src/app/(app)/orders/[id]/page.tsx", "utf8");
    check("the panel shows only when a PR is due", /mayIssuePr && \(/.test(detail), true);
    check("and only to an Admin", /canIssuePr\(role\)/.test(detail), true);

    const panel = readFileSync("src/app/(app)/orders/[id]/pr-panel.tsx", "utf8");
    check("it asks for the reference", /name="prNumber"/.test(panel), true);
    check("and caps its length", /maxLength=\{MAX_PR_NUMBER_LENGTH\}/.test(panel), true);

    const list = readFileSync("src/app/(app)/orders/page.tsx", "utf8");
    check("the orders list flags the queue",
      /awaitingPr > 0 && status !== "FORMULATOR_APPROVED_PENDING_PR"/.test(list), true);
    const tiles = readFileSync("src/app/(app)/dashboard/admin-dashboard.tsx", "utf8");
    check("and the tile lands on what it counts",
      /href: "\/orders\?status=FORMULATOR_APPROVED_PENDING_PR"/.test(tiles), true);
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
