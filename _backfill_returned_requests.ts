import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaMssql } from "@prisma/adapter-mssql";
import { parseMssqlUrl } from "./src/lib/mssql-url";
import { formatDay } from "./src/lib/dates";

/**
 * One-off: close the requests whose pieces came back before a return closed anything.
 *
 * Logging a return now sets the request to RETURNED, but that only applies from here on.
 * Requests answered earlier still read GIVEN while their piece sits on the shelf — which is
 * how a returned sample showed up under "Answered" as still given out.
 *
 * A row is stale when its request says GIVEN and its piece is NOT checked out. The piece is
 * the physical truth: if nobody is holding it, it came back. The date and the amount used are
 * recovered from that piece's RETURN_USAGE transaction, which is the record the return
 * already wrote — so this reconstructs what happened rather than stamping today over it.
 *
 * Dry run unless --apply is passed.
 */
const apply = process.argv.includes("--apply");

async function main() {
  const prisma = new PrismaClient({
    adapter: new PrismaMssql(parseMssqlUrl(process.env.DATABASE_URL!)),
  });

  const open = await prisma.sampleRequest.findMany({
    where: { status: "GIVEN" },
    include: {
      sample: { select: { sampleCode: true } },
      piece: { select: { id: true, pieceIndex: true, status: true, checkedOutToUserId: true } },
      requestedBy: { select: { name: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  // Still held means still out — leave it alone.
  const stale = open.filter((r) => r.piece && !r.piece.checkedOutToUserId);

  console.log(`${open.length} request(s) reading GIVEN; ${stale.length} whose piece is back`);
  if (stale.length === 0) {
    console.log("Nothing to close.");
    await prisma.$disconnect();
    return;
  }

  const plan: Array<{
    id: string;
    row: Record<string, string>;
    usedG: string | null;
    returnedAt: Date;
  }> = [];

  for (const r of stale) {
    // The return the piece already recorded. Newest first: a piece can go out and come back
    // more than once, and the one that closed THIS request is the latest at this point.
    const movement = await prisma.transaction.findFirst({
      where: { pieceId: r.piece!.id, type: "RETURN_USAGE" },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true, quantityG: true },
    });
    const returnedAt = movement?.createdAt ?? r.decidedAt ?? r.createdAt;
    const usedG = movement?.quantityG?.toString() ?? null;
    plan.push({
      id: r.id,
      usedG,
      returnedAt,
      row: {
        sample: r.sample.sampleCode,
        piece: `#${r.piece!.pieceIndex}`,
        requester: r.requestedBy.name,
        used: usedG ?? "unknown",
        returned: formatDay(returnedAt),
        source: movement ? "its return transaction" : "no transaction found — request date",
      },
    });
  }

  console.table(plan.map((p) => p.row));

  if (!apply) {
    console.log("\n(dry run — nothing written. Re-run with --apply.)");
    await prisma.$disconnect();
    return;
  }

  for (const p of plan) {
    await prisma.sampleRequest.update({
      where: { id: p.id },
      data: {
        status: "RETURNED",
        // Only filled where the transaction knew it; a guess here would be worse than a gap.
        ...(p.usedG != null ? { actualUsageG: p.usedG } : {}),
        decidedAt: p.returnedAt,
      },
    });
    console.log(`closed ${p.row.sample} ${p.row.piece} as returned on ${p.row.returned}`);
  }

  const left = await prisma.sampleRequest.count({ where: { status: "GIVEN" } });
  console.log(`\n${left} request(s) still out with someone, which is correct.`);
  await prisma.$disconnect();
}
main();
