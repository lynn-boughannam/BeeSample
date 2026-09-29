import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaMssql } from "@prisma/adapter-mssql";
import { parseMssqlUrl } from "./src/lib/mssql-url";

/**
 * One-off: move the requests that were parked on COSTING_SUBMITTED_PENDING_FORMULATOR while
 * that status stood in for "CSS approved, waiting on the Formulator to choose".
 *
 * It no longer means that. Costing happens after selection, for the one supplier chosen, so
 * the post-CSS wait got its own status (CSS_APPROVED_PENDING_FORMULATOR) and the costing one
 * moved down the chain to where it belongs.
 *
 * A row is only stale if nothing has actually been costed on it — the chosen supplier has no
 * cost recorded, because nobody could have entered one before the step existed. Anything with
 * a cost is genuinely at the costing status and is left alone, so this is safe to re-run.
 *
 * Dry run unless --apply is passed.
 */
const apply = process.argv.includes("--apply");

async function main() {
  const prisma = new PrismaClient({
    adapter: new PrismaMssql(parseMssqlUrl(process.env.DATABASE_URL!)),
  });

  const parked = await prisma.sampleOrder.findMany({
    where: { status: "COSTING_SUBMITTED_PENDING_FORMULATOR" },
    include: {
      existingSample: { select: { sampleCode: true } },
      suppliers: { select: { isSelected: true, cost: true, shippingCost: true } },
    },
  });

  const stale = parked.filter(
    (o) => !o.suppliers.some((s) => s.cost !== null || s.shippingCost !== null)
  );

  console.log(`${parked.length} request(s) at COSTING_SUBMITTED_PENDING_FORMULATOR`);
  if (stale.length === 0) {
    console.log("All of them have costing recorded — nothing to move.");
    await prisma.$disconnect();
    return;
  }

  console.table(
    stale.map((o) => ({
      request: o.existingSample?.sampleCode ?? o.inciName ?? "?",
      chosenSupplier: o.suppliers.some((s) => s.isSelected) ? "yes" : "none yet",
      to: "CSS_APPROVED_PENDING_FORMULATOR",
    }))
  );

  if (!apply) {
    console.log("\n(dry run — nothing written. Re-run with --apply.)");
    await prisma.$disconnect();
    return;
  }

  const { count } = await prisma.sampleOrder.updateMany({
    where: { id: { in: stale.map((o) => o.id) } },
    data: { status: "CSS_APPROVED_PENDING_FORMULATOR" },
  });
  console.log(`moved ${count}`);
  await prisma.$disconnect();
}
main();
