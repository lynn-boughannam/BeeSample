import "dotenv/config";
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { PrismaMssql } from "@prisma/adapter-mssql";
import { parseMssqlUrl } from "./src/lib/mssql-url";
import {
  canDecidePieceRequest,
  canRequestPiece,
  checkCancellable,
  checkDecidable,
  pieceIsRequestable,
  pieceUnavailableReason,
} from "./src/lib/piece-requests";

// Stories A and B: a Formulator asks for a specific piece, an Admin hands it over.
//
// Each acceptance criterion is named in the check that covers it.

const prisma = new PrismaClient({
  adapter: new PrismaMssql(parseMssqlUrl(process.env.DATABASE_URL!)),
});

const PREFIX = "ZZ-PIECEREQ-";
let failures = 0;
const check = (label: string, actual: unknown, expected: unknown) => {
  const ok = String(actual) === String(expected);
  if (!ok) failures++;
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${label.padEnd(60)} ${actual}${ok ? "" : `   (expected ${expected})`}`
  );
};

// Mirrors requestPiece / givePiece / rejectPieceRequest / cancelPieceRequest.
async function request(pieceId: string, userId: string, role: string) {
  if (!canRequestPiece(role)) throw new Error("NOT_FORMULATOR");
  const piece = await prisma.samplePiece.findUniqueOrThrow({
    where: { id: pieceId },
    include: {
      checkedOutToUser: { select: { name: true } },
      requests: { where: { status: "PENDING" }, include: { requestedBy: true } },
    },
  });
  const why = pieceUnavailableReason({
    status: piece.status,
    checkedOutToName: piece.checkedOutToUser?.name ?? null,
    pendingRequestByName: piece.requests[0]?.requestedBy.name ?? null,
  });
  if (why) throw new Error(`UNAVAILABLE: ${why}`);
  return prisma.sampleRequest.create({
    data: { sampleId: piece.sampleId, pieceId, requestedById: userId, status: "PENDING" },
  });
}

async function give(requestId: string, adminId: string, role: string) {
  if (!canDecidePieceRequest(role)) throw new Error("NOT_ADMIN");
  const r = await prisma.sampleRequest.findUniqueOrThrow({
    where: { id: requestId },
    include: { piece: true },
  });
  const ok = checkDecidable(r);
  if (!ok.ok) throw new Error(ok.reason);
  if (!r.piece || r.piece.status !== "IN_STOCK") throw new Error("PIECE_NOT_ON_SHELF");
  const now = new Date();
  return prisma.$transaction(async (tx) => {
    await tx.samplePiece.update({
      where: { id: r.pieceId! },
      data: { status: "CHECKED_OUT", checkedOutToUserId: r.requestedById, checkedOutAt: now },
    });
    await tx.sampleRequest.update({
      where: { id: requestId },
      data: { status: "GIVEN", decidedAt: now, decidedById: adminId },
    });
    await tx.transaction.create({
      data: {
        sampleId: r.sampleId,
        pieceId: r.pieceId,
        requestId,
        type: "CHECKOUT",
        performedById: adminId,
        note: "given against request",
      },
    });
  });
}

async function reject(requestId: string, adminId: string, role: string, reason: string) {
  if (!canDecidePieceRequest(role)) throw new Error("NOT_ADMIN");
  if (!reason.trim()) throw new Error("NO_REASON");
  const r = await prisma.sampleRequest.findUniqueOrThrow({ where: { id: requestId } });
  const ok = checkDecidable(r);
  if (!ok.ok) throw new Error(ok.reason);
  return prisma.sampleRequest.update({
    where: { id: requestId },
    data: {
      status: "REJECTED",
      rejectionReason: reason.trim(),
      decidedAt: new Date(),
      decidedById: adminId,
    },
  });
}

async function cancel(requestId: string, userId: string) {
  const r = await prisma.sampleRequest.findUniqueOrThrow({ where: { id: requestId } });
  const ok = checkCancellable(r, { id: userId });
  if (!ok.ok) throw new Error(ok.reason);
  return prisma.sampleRequest.update({
    where: { id: requestId },
    data: { status: "CANCELLED", decidedAt: new Date(), decidedById: userId },
  });
}

async function wipe() {
  const samples = await prisma.sample.findMany({
    where: { sampleCode: { startsWith: PREFIX } },
    select: { id: true },
  });
  const ids = samples.map((s) => s.id);
  await prisma.feedback.deleteMany({ where: { sampleId: { in: ids } } });
  await prisma.transaction.deleteMany({ where: { sampleId: { in: ids } } });
  await prisma.sampleRequest.deleteMany({ where: { sampleId: { in: ids } } });
  await prisma.locationHistory.deleteMany({ where: { sampleId: { in: ids } } });
  await prisma.samplePiece.deleteMany({ where: { sampleId: { in: ids } } });
  await prisma.sampleIngredient.deleteMany({ where: { sampleId: { in: ids } } });
  await prisma.sample.deleteMany({ where: { id: { in: ids } } });
  await prisma.user.deleteMany({ where: { adUsername: { startsWith: PREFIX.toLowerCase() } } });
}

async function main() {
  await wipe();

  console.log("=== who may do what ===");
  // AC B4 — the rule lives on the server, so the role decides, not the markup.
  check("a Formulator asks", canRequestPiece("FORMULATOR"), true);
  check("an Admin does not need to ask", canRequestPiece("ADMIN"), false);
  check("an Admin decides", canDecidePieceRequest("ADMIN"), true);
  check("a Formulator cannot decide", canDecidePieceRequest("FORMULATOR"), false);
  check("nor Supply Chain", canDecidePieceRequest("SUPPLY_CHAIN"), false);

  console.log("\n=== AC A2: what makes a piece unaskable, and what it says ===");
  check("on the shelf and unclaimed", pieceIsRequestable({ status: "IN_STOCK" }), true);
  check("already out", pieceUnavailableReason({ status: "CHECKED_OUT", checkedOutToName: "Mo" }), "With Mo");
  check("out, holder unknown", pieceUnavailableReason({ status: "CHECKED_OUT" }), "Already checked out");
  check("nothing left", pieceUnavailableReason({ status: "DEPLETED" }), "Nothing left of it");
  check("discarded", pieceUnavailableReason({ status: "DISCARDED" }), "Discarded");
  // Somebody else got in first — the row names them rather than greying out silently.
  check("someone else asked first",
    pieceUnavailableReason({ status: "IN_STOCK", pendingRequestByName: "Mo" }), "Requested by Mo");

  console.log("\n=== a request is answered once ===");
  check("pending is decidable", checkDecidable({ status: "PENDING" }).ok, true);
  for (const s of ["GIVEN", "REJECTED", "CANCELLED"]) {
    const r = checkDecidable({ status: s });
    check(`${s.toLowerCase()} is not`, r.ok, false);
    check("  and says which", r.ok ? "" : r.reason, `This request was already ${s.toLowerCase()}.`);
  }

  const adminRole = await prisma.role.findFirstOrThrow({ where: { name: "ADMIN" } });
  const formulatorRole = await prisma.role.findFirstOrThrow({ where: { name: "FORMULATOR" } });
  const admin = await prisma.user.create({
    data: { adUsername: PREFIX.toLowerCase() + "a", name: "Req Admin", roleId: adminRole.id, isActive: true },
  });
  const mo = await prisma.user.create({
    data: { adUsername: PREFIX.toLowerCase() + "f1", name: "Req Mo", roleId: formulatorRole.id, isActive: true },
  });
  const lea = await prisma.user.create({
    data: { adUsername: PREFIX.toLowerCase() + "f2", name: "Req Lea", roleId: formulatorRole.id, isActive: true },
  });

  const fn = await prisma.sampleFunction.findFirstOrThrow({ select: { name: true } });
  const pf = await prisma.physicalForm.findFirstOrThrow({ select: { name: true } });
  const sup = await prisma.supplier.findFirstOrThrow({ select: { name: true } });
  const proj = await prisma.project.findFirstOrThrow({ select: { name: true } });

  const sample = await prisma.sample.create({
    data: {
      sampleCode: PREFIX + "S1",
      rmName: PREFIX + "Material",
      category: "Wax",
      function: fn.name,
      physicalForm: pf.name,
      source: "Synthetic",
      supplier: sup.name,
      projectName: proj.name,
      hazardClass: "Non-Hazardous",
      totalQtyG: "90",
      receivedQtyPcs: 3,
      receptionDate: new Date("2026-09-01"),
      expiryDate: new Date("2027-09-01"),
      shelfLetter: "G",
      shelfLevel: 3,
      createdById: admin.id,
      pieces: {
        create: [1, 2, 3].map((i) => ({
          pieceIndex: i,
          originalWeightG: "30.00",
          remainingWeightG: "30.00",
          status: "IN_STOCK",
        })),
      },
    },
    include: { pieces: { orderBy: { pieceIndex: "asc" } } },
  });
  const [p1, p2, p3] = sample.pieces;

  try {
    console.log("\n--- AC A1: Mo picks a piece and asks for it ---");
    const req = await request(p1.id, mo.id, "FORMULATOR");
    const stored = await prisma.sampleRequest.findUniqueOrThrow({
      where: { id: req.id },
      include: { piece: true, requestedBy: true, sample: true },
    });
    check("created pending", stored.status, "PENDING");
    check("naming the requester", stored.requestedBy.name, "Req Mo");
    check("the sample", stored.sample.sampleCode, PREFIX + "S1");
    check("the piece", stored.piece?.pieceIndex, 1);
    check("and dated", Boolean(stored.createdAt), true);
    // Asking moves nothing: the piece is still on the shelf until an Admin hands it over.
    check("the piece has not moved", (await prisma.samplePiece.findUniqueOrThrow({ where: { id: p1.id } })).status, "IN_STOCK");

    console.log("\n--- AC A2: nobody else can ask for that piece ---");
    let blocked = "";
    try {
      await request(p1.id, lea.id, "FORMULATOR");
    } catch (e) {
      blocked = (e as Error).message;
    }
    check("Lea is refused", blocked, "UNAVAILABLE: Requested by Req Mo");
    // An Admin handing pieces out directly needs no request, so the act isn't theirs.
    blocked = "";
    try {
      await request(p2.id, admin.id, "ADMIN");
    } catch (e) {
      blocked = (e as Error).message;
    }
    check("and an Admin doesn't raise one", blocked, "NOT_FORMULATOR");

    console.log("\n--- AC B4: a Formulator cannot give, however they reach it ---");
    blocked = "";
    try {
      await give(req.id, mo.id, "FORMULATOR");
    } catch (e) {
      blocked = (e as Error).message;
    }
    check("refused on the server", blocked, "NOT_ADMIN");
    check("still pending", (await prisma.sampleRequest.findUniqueOrThrow({ where: { id: req.id } })).status, "PENDING");

    console.log("\n--- AC B2: the Admin gives it ---");
    await give(req.id, admin.id, "ADMIN");
    const given = await prisma.sampleRequest.findUniqueOrThrow({
      where: { id: req.id },
      include: { piece: { include: { checkedOutToUser: true } }, decidedBy: true },
    });
    check("status given", given.status, "GIVEN");
    check("the piece is checked out", given.piece?.status, "CHECKED_OUT");
    check("held by the requester", given.piece?.checkedOutToUser?.name, "Req Mo");
    check("with a date on the piece", Boolean(given.piece?.checkedOutAt), true);
    check("the handover is dated", Boolean(given.decidedAt), true);
    check("and attributed to the Admin", given.decidedBy?.name, "Req Admin");
    // A handover is a stock movement, so the sample's history shows it.
    check("recorded as a checkout in history",
      await prisma.transaction.count({ where: { requestId: req.id, type: "CHECKOUT" } }), 1);

    console.log("\n--- and not twice ---");
    blocked = "";
    try {
      await give(req.id, admin.id, "ADMIN");
    } catch (e) {
      blocked = (e as Error).message;
    }
    check("refused", blocked, "This request was already given.");

    console.log("\n--- AC A3: Lea asks for another, then withdraws it ---");
    const leaReq = await request(p2.id, lea.id, "FORMULATOR");
    check("pending", leaReq.status, "PENDING");
    // Only the person who asked may withdraw it.
    blocked = "";
    try {
      await cancel(leaReq.id, mo.id);
    } catch (e) {
      blocked = (e as Error).message;
    }
    check("somebody else cannot cancel it", blocked,
      "Only the person who asked for this piece can cancel it.");
    await cancel(leaReq.id, lea.id);
    check("cancelled", (await prisma.sampleRequest.findUniqueOrThrow({ where: { id: leaReq.id } })).status, "CANCELLED");
    // Available again: the piece never moved, so closing the request is all it takes.
    const freed = await prisma.samplePiece.findUniqueOrThrow({
      where: { id: p2.id },
      include: { requests: { where: { status: "PENDING" } } },
    });
    check("the piece is free again",
      pieceIsRequestable({
        status: freed.status,
        pendingRequestByName: freed.requests[0] ? "someone" : null,
      }), true);
    const again = await request(p2.id, mo.id, "FORMULATOR");
    check("so somebody else can ask for it", again.status, "PENDING");

    console.log("\n--- AC B3: the Admin says no, with a reason ---");
    blocked = "";
    try {
      await reject(again.id, admin.id, "ADMIN", "   ");
    } catch (e) {
      blocked = (e as Error).message;
    }
    check("a reason is required", blocked, "NO_REASON");
    await reject(again.id, admin.id, "ADMIN", "Reserved for the stability trial");
    const rejected = await prisma.sampleRequest.findUniqueOrThrow({ where: { id: again.id } });
    check("rejected", rejected.status, "REJECTED");
    check("the formulator can read why", rejected.rejectionReason, "Reserved for the stability trial");
    check("the piece never moved", (await prisma.samplePiece.findUniqueOrThrow({ where: { id: p2.id } })).status, "IN_STOCK");
    const afterReject = await prisma.samplePiece.findUniqueOrThrow({
      where: { id: p2.id },
      include: { requests: { where: { status: "PENDING" } } },
    });
    check("and is available again", afterReject.requests.length, 0);

    console.log("\n--- AC B1: the queue is oldest first ---");
    const older = await request(p3.id, lea.id, "FORMULATOR");
    await prisma.sampleRequest.update({
      where: { id: older.id },
      data: { createdAt: new Date("2026-09-02") },
    });
    const newer = await request(p2.id, mo.id, "FORMULATOR");
    await prisma.sampleRequest.update({
      where: { id: newer.id },
      data: { createdAt: new Date("2026-09-20") },
    });
    const queue = await prisma.sampleRequest.findMany({
      where: { status: "PENDING", sampleId: sample.id },
      orderBy: { createdAt: "asc" },
      include: { requestedBy: true, piece: true },
    });
    check("two waiting", queue.length, 2);
    check("the longest wait leads", queue[0]?.requestedBy.name, "Req Lea");
    check("and it carries the piece", queue[0]?.piece?.pieceIndex, 3);

    console.log("\n=== wiring ===");
    const actions = readFileSync("src/app/(app)/requests/actions.ts", "utf8");
    check("giving re-checks the role on the server",
      /canDecidePieceRequest\(session\.user\.role\)/.test(actions), true);
    check("asking re-checks it too",
      /canRequestPiece\(session\.user\.role\)/.test(actions), true);
    check("availability is re-checked against the stored rows",
      /pieceUnavailableReason\(\{/.test(actions), true);
    check("a rejection needs a reason",
      /Give a reason so the formulator knows why/.test(actions), true);
    check("the handover and the piece move together",
      /\$transaction[\s\S]{0,600}status: "CHECKED_OUT"/.test(actions), true);
    check("and it is the same state a direct checkout produces",
      /checkedOutToUserId: request\.requestedById/.test(actions), true);

    const page = readFileSync("src/app/(app)/requests/page.tsx", "utf8");
    check("the queue is ordered oldest first", /orderBy: \{ createdAt: "asc" \}/.test(page), true);
    check("a non-Admin sees only their own",
      /requestedById: session\.user\.id/.test(page), true);
    const panel = readFileSync("src/app/(app)/library/[id]/stock-panel.tsx", "utf8");
    check("the piece list says why one can't be asked for",
      /pieceUnavailableReason\(piece\)/.test(panel), true);
  } finally {
    await wipe();
    console.log("\ncleanup done");
    await prisma.$disconnect();
  }

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}
main();
