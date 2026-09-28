import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaMssql } from "@prisma/adapter-mssql";
import { parseMssqlUrl } from "./src/lib/mssql-url";
import { orderStatusAfterCssDecision, orderStatusAfterCssSubmission } from "./src/lib/orders";

/**
 * One-off: move requests that CSS already finished with on to the status they should have
 * reached at the time.
 *
 * Until now neither handing a supplier to CSS nor deciding it touched the order, so a request
 * whose every option had been approved still read "Approved – Pending Supply Chain" — which is
 * what the requester complained about. The actions advance it from here on; these are the rows
 * that moved before they did.
 *
 * Judged with the same two functions the actions use, so this can't drift from them: the
 * decision rule first, since it wins wherever both apply. Dry run unless --apply is passed.
 */
const apply = process.argv.includes("--apply");

async function main() {
  const prisma = new PrismaClient({
    adapter: new PrismaMssql(parseMssqlUrl(process.env.DATABASE_URL!)),
  });

  const orders = await prisma.sampleOrder.findMany({
    where: { status: "APPROVED_PENDING_SUPPLY_CHAIN" },
    include: {
      existingSample: { select: { sampleCode: true } },
      suppliers: { select: { cssDecision: true, submittedToCssAt: true } },
    },
  });

  const moving: Array<{ id: string; request: string; from: string; to: string }> = [];
  for (const order of orders) {
    // Decision first: an order CSS has finished with belongs past the CSS wait, not in it.
    const next =
      orderStatusAfterCssDecision(order.suppliers) ??
      orderStatusAfterCssSubmission(order.suppliers);
    // Nothing to do while an option hasn't even been handed over — that request really is
    // still with Supply Chain.
    if (!next) continue;
    moving.push({
      id: order.id,
      request: order.existingSample?.sampleCode ?? order.inciName ?? "?",
      from: order.status,
      to: next,
    });
  }

  console.log(`${orders.length} request(s) at APPROVED_PENDING_SUPPLY_CHAIN`);
  if (moving.length === 0) {
    console.log("None of them have been handed over or decided — nothing to backfill.");
    await prisma.$disconnect();
    return;
  }
  console.table(moving.map(({ request, from, to }) => ({ request, from, to })));

  if (!apply) {
    console.log("\n(dry run — nothing written. Re-run with --apply.)");
    await prisma.$disconnect();
    return;
  }

  for (const row of moving) {
    // A backfilled rejection gets the same reason the action writes, so the two are
    // indistinguishable afterwards.
    await prisma.sampleOrder.update({
      where: { id: row.id },
      data:
        row.to === "REJECTED"
          ? {
              status: "REJECTED",
              rejectionReason:
                "Every supplier option was rejected at document review, so there is nothing left to order.",
            }
          : { status: row.to },
    });
    console.log(`${row.request}: ${row.from} -> ${row.to}`);
  }

  await prisma.$disconnect();
}
main();
