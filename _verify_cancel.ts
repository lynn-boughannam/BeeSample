import "dotenv/config";
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { PrismaMssql } from "@prisma/adapter-mssql";
import { parseMssqlUrl } from "./src/lib/mssql-url";
import { cancellationsFor } from "./src/lib/order-cancellations";
import { loadOverdueNotifications } from "./src/lib/notifications";
import {
  CANCELLATION_NOTICE_DAYS,
  canCancelOrder,
  cancellationRecipients,
  checkCancelReady,
  isTerminal,
  orderStatusAfterCancellation,
  terminalReason,
} from "./src/lib/orders";
import { ORDER_STATUSES, ORDER_STATUS_SEQUENCE } from "./src/lib/types";

// Withdrawing a request, and telling the people who were working it.
//
// Needs --conditions=react-server: order-cancellations is marked server-only.

const prisma = new PrismaClient({
  adapter: new PrismaMssql(parseMssqlUrl(process.env.DATABASE_URL!)),
});

const PREFIX = "ZZ-CANCEL-";
let failures = 0;
const check = (label: string, actual: unknown, expected: unknown) => {
  const ok = String(actual) === String(expected);
  if (!ok) failures++;
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${label.padEnd(58)} ${actual}${ok ? "" : `   (expected ${expected})`}`
  );
};

async function wipe() {
  await prisma.sampleOrderSupplier.deleteMany({
    where: { order: { inciName: { startsWith: PREFIX } } },
  });
  await prisma.sampleOrder.deleteMany({ where: { inciName: { startsWith: PREFIX } } });
  await prisma.user.deleteMany({ where: { adUsername: { startsWith: PREFIX.toLowerCase() } } });
}

async function main() {
  await wipe();

  console.log("=== cancelling belongs to whoever raised it ===");
  // Same rule as choosing a supplier and approving the costing: whether the material is
  // still needed is the requester's to say. An Admin who thinks better of it rejects.
  check("the submitter may", canCancelOrder({ orderedById: "u-1" }, { id: "u-1" }), true);
  check("a colleague may not", canCancelOrder({ orderedById: "u-1" }, { id: "u-2" }), false);

  console.log("\n=== any time, up to the material arriving ===");
  // "Any time" is the requirement, so every live status has to allow it — including after a
  // PR is out, which is precisely when someone needs to stop it.
  for (const status of ORDER_STATUSES) {
    if (status === "RECEIVED" || status === "REJECTED" || status === "CANCELLED") continue;
    check(`cancellable at ${status}`, checkCancelReady({ status }).ok, true);
  }
  const received = checkCancelReady({ status: "RECEIVED" });
  check("but not once it is on the shelf", received.ok, false);
  check("and says what to do instead",
    received.ok ? "" : received.reason,
    "The material has already been received into the library. Discard the sample instead if it isn't wanted.");
  check("not twice", checkCancelReady({ status: "CANCELLED" }).ok, false);
  check("nor after a rejection", checkCancelReady({ status: "REJECTED" }).ok, false);

  console.log("\n=== cancelled is an ending, not a step ===");
  check("it ends the request", isTerminal("CANCELLED"), true);
  check("so does rejection", isTerminal("REJECTED"), true);
  check("a live status does not", isTerminal("SUBMITTED"), false);
  // The two endings are different facts: one is a decision about the request, the other is
  // the requester no longer needing it. A report that conflated them would blame the
  // reviewer for both.
  check("and they read differently",
    terminalReason("CANCELLED"), "This request was cancelled by whoever raised it.");
  check("from a rejection", terminalReason("REJECTED"), "This request was rejected.");
  check("neither is on the progress track",
    ORDER_STATUS_SEQUENCE.some((s) => s === "CANCELLED" || s === "REJECTED"), false);
  check("what it becomes", orderStatusAfterCancellation(), "CANCELLED");

  console.log("\n=== who has to be told ===");
  const order = {
    orderedById: "u-submitter",
    approvedById: "u-admin-approver",
    suppliers: [
      { cssDecision: "APPROVED", cssDecidedById: "u-css-yes" },
      { cssDecision: "REJECTED", cssDecidedById: "u-css-no" },
    ],
  };
  const told = cancellationRecipients(order, ["u-admin-1", "u-admin-2"]);
  check("the admins who coordinate procurement", told.includes("u-admin-1"), true);
  check("and the second one too", told.includes("u-admin-2"), true);
  check("whoever approved the request", told.includes("u-admin-approver"), true);
  check("whoever approved a supplier's documents", told.includes("u-css-yes"), true);
  // Someone who rejected an option already said no to it; hearing the whole thing is off
  // tells them nothing they would act on.
  check("but not someone who only rejected one", told.includes("u-css-no"), false);
  check("and never the canceller", told.includes("u-submitter"), false);
  check("nobody twice",
    cancellationRecipients(order, ["u-admin-approver"]).filter((id) => id === "u-admin-approver").length,
    1);
  check("an unapproved request still reaches the admins",
    cancellationRecipients({ orderedById: "u-1" }, ["u-admin-1"]).join(","), "u-admin-1");

  const adminRole = await prisma.role.findFirstOrThrow({ where: { name: "ADMIN" } });
  const cssRole = await prisma.role.findFirstOrThrow({ where: { name: "CSS" } });
  const formulatorRole = await prisma.role.findFirstOrThrow({ where: { name: "FORMULATOR" } });

  const submitter = await prisma.user.create({
    data: { adUsername: PREFIX.toLowerCase() + "sub", name: "Cancel Submitter", roleId: formulatorRole.id, isActive: true },
  });
  const approver = await prisma.user.create({
    data: { adUsername: PREFIX.toLowerCase() + "adm", name: "Cancel Approver", roleId: adminRole.id, isActive: true },
  });
  const cssUser = await prisma.user.create({
    data: { adUsername: PREFIX.toLowerCase() + "css", name: "Cancel CSS", roleId: cssRole.id, isActive: true },
  });
  const bystander = await prisma.user.create({
    data: { adUsername: PREFIX.toLowerCase() + "by", name: "Cancel Bystander", roleId: cssRole.id, isActive: true },
  });

  // Mid-flight: approved, with CSS having cleared one option — so there are real people
  // with work in progress on it.
  const built = await prisma.sampleOrder.create({
    data: {
      requestType: "NEW",
      inciName: PREFIX + "MATERIAL",
      requiredQuantityG: "250",
      supplier1: "A", supplier2: "B",
      directorApprovalConfirmed: true,
      orderedById: submitter.id,
      status: "DETAILS_SUBMITTED_AWAITING_CSS",
      approvedById: approver.id,
      decidedAt: new Date(),
      suppliers: {
        create: [1, 2].map((position) => ({
          position,
          supplierName: `${PREFIX}Supplier ${position}`,
          landedPrice: `${10 + position}.00`,
          moq: "25 kg",
          documentsReceivedAt: new Date(),
          submittedToCssAt: new Date(),
          ...(position === 1
            ? { cssDecision: "APPROVED", cssDecisionAt: new Date(), cssDecidedById: cssUser.id }
            : {}),
        })),
      },
    },
  });

  try {
    console.log("\n--- before it is cancelled ---");
    const inCssQueue = await prisma.sampleOrder.count({
      where: {
        id: built.id,
        status: { in: ["APPROVED_PENDING_SUPPLY_CHAIN", "DETAILS_SUBMITTED_AWAITING_CSS"] },
        suppliers: { some: { submittedToCssAt: { not: null }, cssDecision: "PENDING" } },
      },
    });
    check("CSS has it in their queue", inCssQueue, 1);

    console.log("\n--- the submitter withdraws it ---");
    await prisma.sampleOrder.update({
      where: { id: built.id },
      data: {
        status: orderStatusAfterCancellation(),
        decidedAt: new Date(),
        rejectionReason: "Project dropped",
      },
    });
    const after = await prisma.sampleOrder.findUniqueOrThrow({ where: { id: built.id } });
    check("it is cancelled", after.status, "CANCELLED");
    check("with a reason anyone can read", after.rejectionReason, "Project dropped");
    check("and a date it ended", Boolean(after.decidedAt), true);

    // Nothing extra had to be done for this: the queues select live statuses, so ending the
    // request takes it off every desk at once.
    const stillInCssQueue = await prisma.sampleOrder.count({
      where: {
        id: built.id,
        status: { in: ["APPROVED_PENDING_SUPPLY_CHAIN", "DETAILS_SUBMITTED_AWAITING_CSS"] },
      },
    });
    check("CSS no longer has it", stillInCssQueue, 0);
    const inScQueue = await prisma.sampleOrder.count({
      where: { id: built.id, status: "APPROVED_PENDING_SUPPLY_CHAIN" },
    });
    check("nor does Supply Chain", inScQueue, 0);

    console.log("\n--- and the people who signed for it are told ---");
    const forApprover = await cancellationsFor(approver.id, "ADMIN");
    const mineApprover = forApprover.filter((c) => c.label.includes(PREFIX));
    check("the Admin who approved it", mineApprover.length, 1);
    check("told it was them who approved", mineApprover[0]?.because, "APPROVED");
    check("with who withdrew it", mineApprover[0]?.cancelledBy, "Cancel Submitter");
    check("and why", mineApprover[0]?.reason, "Project dropped");

    const forCss = await cancellationsFor(cssUser.id, "CSS");
    check("the CSS reviewer who approved a supplier",
      forCss.filter((c) => c.label.includes(PREFIX)).length, 1);

    // A CSS user who never touched this request has no reason to hear about it.
    const forBystander = await cancellationsFor(bystander.id, "CSS");
    check("but not a CSS user who never touched it",
      forBystander.filter((c) => c.label.includes(PREFIX)).length, 0);
    const forSubmitter = await cancellationsFor(submitter.id, "FORMULATOR");
    check("nor the person who cancelled it",
      forSubmitter.filter((c) => c.label.includes(PREFIX)).length, 0);

    // The banner on the orders list is only seen by someone already on that page. The bell
    // is where people look to find out what has happened to their work.
    console.log("\n--- and it reaches the bell, not just the orders list ---");
    const bell = await loadOverdueNotifications(approver.id, "ADMIN");
    const cancelRows = bell.filter((n) => n.kind === "CANCELLED" && n.title.includes(PREFIX));
    check("the cancellation is in the bell", cancelRows.length, 1);
    check("saying who withdrew it and why",
      cancelRows[0]?.detail, 'Cancel Submitter — “Project dropped”');
    check("it links to the request", cancelRows[0]?.href.includes("/orders/"), true);
    check("and is dated rather than called late", cancelRows[0]?.overdueBy, "today");
    // Nothing is owed on a withdrawal, so it must not be counted as an SLA breach.
    check("it isn't filed as overdue work",
      bell.some((n) => n.kind === "CANCELLED" && n.daysLate > 0), false);

    const bellForBystander = await loadOverdueNotifications(bystander.id, "CSS");
    check("and reaches nobody who wasn't working it",
      bellForBystander.some((n) => n.title.includes(PREFIX)), false);

    console.log("\n--- it ages out rather than sitting there forever ---");
    await prisma.sampleOrder.update({
      where: { id: built.id },
      data: {
        decidedAt: new Date(Date.now() - (CANCELLATION_NOTICE_DAYS + 1) * 24 * 60 * 60 * 1000),
      },
    });
    const later = await cancellationsFor(approver.id, "ADMIN");
    check("an old cancellation is no longer listed",
      later.filter((c) => c.label.includes(PREFIX)).length, 0);

    console.log("\n=== wiring ===");
    const action = readFileSync("src/app/(app)/orders/[id]/cancel-actions.ts", "utf8");
    check("only the submitter cancels",
      /canCancelOrder\(order, \{ id: session\.user\.id \}\)/.test(action), true);
    check("the gate is re-checked on the server", /checkCancelReady\(order\)/.test(action), true);
    // A request that vanishes with no explanation leaves people chasing a material nobody
    // is buying, and no way to know whether to raise it again.
    check("a reason is required",
      /Say why this request is being cancelled/.test(action), true);
    check("and it advances to cancelled",
      /orderStatusAfterCancellation\(\)/.test(action), true);

    const panel = readFileSync("src/app/(app)/orders/[id]/cancel-panel.tsx", "utf8");
    check("it is confirmed before it goes", /<ConfirmDialog/.test(panel), true);
    check("with the reason required in the dialog", /reasonRequired/.test(panel), true);
    check("and warns when a PR is already out",
      /has to be cancelled there separately/.test(panel), true);

    const detail = readFileSync("src/app/(app)/orders/[id]/page.tsx", "utf8");
    check("shown only to whoever raised it", /mayCancel && \(/.test(detail), true);
    // It belongs with the other action panels at the top, not below the supplier list where
    // nobody would scroll to find it — but last among them, since it is the way out rather
    // than the next step.
    check("it sits with the actions, not under the details",
      detail.indexOf("<CancelPanel") < detail.indexOf("Where the request has reached"), true);
    check("and after the step the request is waiting on",
      detail.indexOf("<CancelPanel") > detail.indexOf("<PrPanel"), true);

    const list = readFileSync("src/app/(app)/orders/page.tsx", "utf8");
    check("and the people told see it on the orders list",
      /cancellationsFor\(session\.user\.id, role\)/.test(list), true);

    const bellSrc = readFileSync("src/components/notification-bell.tsx", "utf8");
    check("the bell has a group for them", /kind: "CANCELLED"/.test(bellSrc), true);
    check("and one for decisions waiting on you", /kind: "DECISION"/.test(bellSrc), true);
    // Red is what the app uses for a missed deadline. Neither of these is one.
    check("neither is painted as late",
      /CANCELLED", label: "Cancelled requests", tone: "INFO"/.test(bellSrc), true);
    check("decisions read as action, not lateness",
      /DECISION", label: "Waiting on you", tone: "ACTION"/.test(bellSrc), true);

    const dash = readFileSync("src/lib/dashboard.ts", "utf8");
    const notif = readFileSync("src/lib/notifications.ts", "utf8");
    // One definition of "waiting on this person", or the dashboard and the bell would
    // eventually disagree about which requests qualify.
    for (const [name, src] of [["dashboard", dash], ["bell", notif]] as const) {
      check(`${name} asks the shared helper`, /awaitingDecisionFor\(/.test(src), true);
      check(`${name} doesn't re-derive it`, /checkSelectionReady\(/.test(src), false);
    }
  } finally {
    await wipe();
    console.log("\ncleanup done");
    await prisma.$disconnect();
  }

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}
main();
