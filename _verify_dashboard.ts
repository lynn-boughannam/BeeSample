import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaMssql } from "@prisma/adapter-mssql";
import { parseMssqlUrl } from "./src/lib/mssql-url";
import { loadAdminDashboard } from "./src/lib/dashboard";

// SLT-59 acceptance criteria, run against the real loadAdminDashboard() rather than a
// reimplementation. Requires --conditions=react-server so the server-only marker resolves
// to its no-op export outside Next.

const prisma = new PrismaClient({
  adapter: new PrismaMssql(parseMssqlUrl(process.env.DATABASE_URL!)),
});

const PREFIX = "ZZ-DASH-VERIFY-";
let failures = 0;
const check = (label: string, actual: unknown, expected: unknown) => {
  const ok = String(actual) === String(expected);
  if (!ok) failures++;
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${label.padEnd(52)} ${actual}${ok ? "" : `   (expected ${expected})`}`
  );
};

async function main() {
  const admin = await prisma.user.findFirstOrThrow({ where: { role: { name: "ADMIN" } } });
  const formulatorRole = await prisma.role.findFirstOrThrow({ where: { name: "FORMULATOR" } });
  const formulator = await prisma.user.create({
    data: {
      adUsername: PREFIX.toLowerCase() + "f",
      name: "Dash Formulator",
      roleId: formulatorRole.id,
      isActive: true,
    },
  });

  // Baseline first: the library already holds real samples, so every assertion below is a
  // delta rather than an absolute count.
  const before = await loadAdminDashboard();
  // The live library may legitimately have pieces out, so emptiness is tested as a
  // transition below (check out, then return) rather than assumed of the whole database.
  console.log("=== baseline ===");
  console.log(`  ${before.kpis.totalSamples} samples · ${before.kpis.checkedOut} pieces already checked out`);
  check(
    "every listed group actually holds pieces (never a blank card)",
    before.checkedOut.every((grp) => grp.pieces.length > 0),
    true
  );

  const base = {
    rmName: "dash sample",
    function: "n/a",
    physicalForm: "Solid",
    source: "Synthetic",
    supplier: "Acme",
    expiryDate: new Date("2030-01-01"),
    shelfLetter: "G",
    shelfLevel: 3,
    createdById: admin.id,
  };

  const healthy = await prisma.sample.create({
    data: {
      ...base, sampleCode: PREFIX + "HEALTHY", category: "Wax", totalQtyG: 10,
      pieces: { create: [
        { pieceIndex: 1, originalWeightG: "5.00", remainingWeightG: "5.00", status: "IN_STOCK" },
        { pieceIndex: 2, originalWeightG: "5.00", remainingWeightG: "5.00", status: "IN_STOCK" },
      ] },
    },
    include: { pieces: true },
  });
  await prisma.sample.create({
    data: {
      ...base, sampleCode: PREFIX + "LOW", category: "Wax", totalQtyG: 10,
      pieces: { create: [{ pieceIndex: 1, originalWeightG: "10.00", remainingWeightG: "1.00", status: "IN_STOCK" }] },
    },
  });
  await prisma.sample.create({
    data: {
      ...base, sampleCode: PREFIX + "ZERO", category: "Herbs", totalQtyG: 10,
      pieces: { create: [{ pieceIndex: 1, originalWeightG: "10.00", remainingWeightG: "0.00", status: "DEPLETED" }] },
    },
  });
  // Discarded: must not count toward any stock figure.
  await prisma.sample.create({
    data: {
      ...base, sampleCode: PREFIX + "DISCARDED", category: "Herbs", totalQtyG: 10,
      isDiscarded: true, discardedById: admin.id, discardedAt: new Date(),
      pieces: { create: [{ pieceIndex: 1, originalWeightG: "10.00", remainingWeightG: "10.00", status: "IN_STOCK" }] },
    },
  });

  // One piece out to the formulator.
  await prisma.samplePiece.update({
    where: { id: healthy.pieces[0].id },
    data: { status: "CHECKED_OUT", checkedOutToUserId: formulator.id, checkedOutAt: new Date("2026-09-12") },
  });

  // Queue items across every KPI source.
  const pendingReq = await prisma.sampleRequest.create({
    data: { sampleId: healthy.id, requestedById: formulator.id, amountG: "2.00", purpose: "Trial", status: "PENDING" },
  });
  const approvedNoFeedback = await prisma.sampleRequest.create({
    data: {
      sampleId: healthy.id, requestedById: formulator.id, amountG: "3.00", purpose: "Batch",
      status: "APPROVED", approvedById: admin.id, decidedAt: new Date("2026-09-13"),
    },
  });
  const approvedWithFeedback = await prisma.sampleRequest.create({
    data: {
      sampleId: healthy.id, requestedById: formulator.id, amountG: "1.00", purpose: "Done",
      status: "APPROVED", approvedById: admin.id, decidedAt: new Date("2026-09-11"),
    },
  });
  await prisma.feedback.create({
    data: {
      sampleId: healthy.id, submittedById: formulator.id, requestId: approvedWithFeedback.id,
      reportText: "Worked well", createdAt: new Date(),
    },
  });
  await prisma.sampleOrder.create({
    data: { requestType: "NEW", inciName: PREFIX + "NEWRM", supplier1: "Acme", orderedById: admin.id, status: "PENDING", directorApprovalConfirmed: true },
  });
  await prisma.sampleOrder.create({
    data: {
      requestType: "NEW", inciName: PREFIX + "INPROGRESS", supplier1: "Acme", orderedById: admin.id, status: "APPROVED", directorApprovalConfirmed: true,
      approvedById: admin.id, decidedAt: new Date(), prNumber: "PR-9001",
    },
  });

  try {
    const after = await loadAdminDashboard();

    console.log("\n=== AC1: KPI row carries real counts ===");
    check("total samples +3 (discarded excluded)", after.kpis.totalSamples - before.kpis.totalSamples, 3);
    check("discarded samples +1", after.kpis.discardedSamples - before.kpis.discardedSamples, 1);
    check("zero stock +1", after.kpis.zeroStock - before.kpis.zeroStock, 1);
    check("pending requests +1", after.kpis.pendingRequests - before.kpis.pendingRequests, 1);
    check("checked out +1", after.kpis.checkedOut - before.kpis.checkedOut, 1);
    check("new orders +1", after.kpis.newOrders - before.kpis.newOrders, 1);
    check("orders in progress +1", after.kpis.ordersInProgress - before.kpis.ordersInProgress, 1);
    check("feedback due +1 (only the unreported one)", after.kpis.feedbackDue - before.kpis.feedbackDue, 1);

    console.log("\n=== Stock health strip ===");
    console.log(`  healthy ${after.stockHealth.healthy} · zero ${after.stockHealth.zero} · total ${after.stockHealth.total}`);
    check(
      "segments sum to total (strip is proportional)",
      after.stockHealth.healthy + after.stockHealth.zero,
      after.stockHealth.total
    );
    check("total matches the KPI tile", after.stockHealth.total, after.kpis.totalSamples);

    console.log("\n=== Samples by category ===");
    console.table(after.byCategory.map((b) => ({ category: b.category, count: b.count, color: b.colorHex })));
    check("every bar has a colour", after.byCategory.every((b) => /^#[0-9A-Fa-f]{6}$/.test(b.colorHex)), true);
    check("sorted by count, largest first",
      after.byCategory.every((b, i) => i === 0 || after.byCategory[i - 1].count >= b.count), true);
    check("Wax uses its shelf-plan colour", after.byCategory.find((b) => b.category === "Wax")?.colorHex, "#66FFCC");
    check("Herbs uses its shelf-plan colour", after.byCategory.find((b) => b.category === "Herbs")?.colorHex, "#FF33CC");
    check("discarded sample not charted (Herbs = 1, not 2)",
      after.byCategory.find((b) => b.category === "Herbs")!.count -
        (before.byCategory.find((b) => b.category === "Herbs")?.count ?? 0), 1);

    console.log("\n=== Who has what ===");
    const group = after.checkedOut.find((grp) => grp.formulatorName === formulator.name);
    console.table(
      after.checkedOut.flatMap((grp) =>
        grp.pieces.map((p) => ({
          formulator: grp.formulatorName, sample: p.sampleCode,
          piece: `#${p.pieceIndex}`, g: p.remainingWeightG,
          since: p.since?.toISOString().slice(0, 10) ?? "—",
        }))
      )
    );
    check("grouped under the formulator", group !== undefined, true);
    check("holds 1 piece", group?.pieces.length, 1);
    check("amount shown", group?.pieces[0].remainingWeightG, "5.00");
    check("since-date shown", group?.pieces[0].since?.toISOString().slice(0, 10), "2026-09-12");
    check("links to the sample", group?.pieces[0].sampleId, healthy.id);

    console.log("\n=== AC2: once returned, the holder drops out entirely ===");
    await prisma.samplePiece.update({
      where: { id: healthy.pieces[0].id },
      data: { status: "IN_STOCK", checkedOutToUserId: null, checkedOutAt: null },
    });
    const returned = await loadAdminDashboard();
    check(
      "formulator no longer listed",
      returned.checkedOut.some((grp) => grp.formulatorName === formulator.name),
      false
    );
    check("checked-out KPI back to baseline", returned.kpis.checkedOut, before.kpis.checkedOut);
    check(
      "no empty groups are ever emitted",
      returned.checkedOut.every((grp) => grp.pieces.length > 0),
      true
    );
    // Put it back so the activity assertions below see the same world as before.
    await prisma.samplePiece.update({
      where: { id: healthy.pieces[0].id },
      data: { status: "CHECKED_OUT", checkedOutToUserId: formulator.id, checkedOutAt: new Date("2026-09-12") },
    });

    console.log("\n=== AC3: recent activity, newest first ===");
    console.table(
      after.activity.slice(0, 8).map((e) => ({
        date: e.at.toISOString().slice(0, 10), kind: e.kind,
        description: e.description.slice(0, 58),
      }))
    );
    const dates = after.activity.map((e) => e.at.getTime());
    check("strictly reverse-chronological", dates.every((d, i) => i === 0 || dates[i - 1] >= d), true);
    check("feed is capped", after.activity.length <= 15, true);
    check("every entry has a date", after.activity.every((e) => e.at instanceof Date && !isNaN(e.at.getTime())), true);
    check("every entry has a description", after.activity.every((e) => e.description.length > 0), true);

    const kinds = new Set(after.activity.map((e) => e.kind));
    console.log("  kinds present:", [...kinds].join(", "));
    check("request activity present", [...kinds].includes("REQUEST"), true);
    check("order activity present", [...kinds].includes("ORDER"), true);
    const all = await (await import("./src/lib/dashboard")).loadActivity();
    check("PR entry generated from prNumber", all.some((e) => e.kind === "PR" && e.description.includes("PR-9001")), true);
    check("feedback entry generated", all.some((e) => e.kind === "FEEDBACK"), true);
  } finally {
    await prisma.feedback.deleteMany({ where: { sample: { sampleCode: { startsWith: PREFIX } } } });
    await prisma.transaction.deleteMany({ where: { sample: { sampleCode: { startsWith: PREFIX } } } });
    await prisma.sampleRequest.deleteMany({
      where: { id: { in: [pendingReq.id, approvedNoFeedback.id, approvedWithFeedback.id] } },
    });
    await prisma.sampleOrder.deleteMany({ where: { inciName: { startsWith: PREFIX } } });
    await prisma.samplePiece.deleteMany({ where: { sample: { sampleCode: { startsWith: PREFIX } } } });
    await prisma.sample.deleteMany({ where: { sampleCode: { startsWith: PREFIX } } });
    await prisma.user.deleteMany({ where: { adUsername: { startsWith: PREFIX.toLowerCase() } } });
    console.log(`\ncleanup done — samples: ${await prisma.sample.count()}, users: ${await prisma.user.count()}, orders: ${await prisma.sampleOrder.count()}`);
    await prisma.$disconnect();
  }

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}
main();
