import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaMssql } from "@prisma/adapter-mssql";
import { parseMssqlUrl } from "./src/lib/mssql-url";
import { orderStatusAfterCssDecision } from "./src/lib/orders";

/**
 * One-off: move requests that CSS already finished with on to the status they should have
 * reached at the time.
 *
 * Until now the CSS decision didn't touch the order, so a request whose every option had
 * been approved still read "Approved – Pending Supply Chain" — which is what the requester
 * complained about. The action advances it from here on; these are the rows decided before
 * it did.
 *
 * Judged with orderStatusAfterCssDecision, the same function the action uses, so this can't
 * drift from it. Dry run unless --apply is passed.
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
      suppliers: { select: { cssDecision: true } },
    },
  });

  const moving: Array<{ id: string; request: string; from: string; to: string }> = [];
  for (const order of orders) {
    const next = orderStatusAfterCssDecision(order.suppliers);
    // Nothing to do while an option is still undecided — that request really is with
    // Supply Chain.
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
    console.log("None of them have been decided — nothing to backfill.");
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
