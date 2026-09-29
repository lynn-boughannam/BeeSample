import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaMssql } from "@prisma/adapter-mssql";
import { parseMssqlUrl } from "./src/lib/mssql-url";

/**
 * Clears rows left behind by a verification script that was interrupted before its own
 * cleanup ran.
 *
 * Every suite seeds data under a "ZZ-" prefix and removes it in a `finally`, but a killed
 * process skips that — and the next run then fails on a unique constraint recreating its
 * own test user, which reads like a broken test rather than stale data. This removes only
 * prefixed rows, in foreign-key order, and reports what it touched.
 *
 * Run with --apply; without it, this only reports.
 */
const PREFIXES = [
  "ZZ-CODATE-", "ZZ-DASH-VERIFY-", "ZZ-DISCARD-VERIFY-", "ZZ-DOC-", "ZZ-FLAGS-",
  "ZZ-HISTORY-VERIFY-", "ZZ-INC-", "ZZ-MYCO-VERIFY-", "ZZ-ORD-", "ZZ-P1-", "ZZ-P2-",
  "ZZ-P3-", "ZZ-P4-", "ZZ-P5-", "ZZ-P6-", "ZZ-P7-", "ZZ-P8-", "ZZ-RACK-VERIFY-", "ZZ-RESTOCK-VERIFY-",
  "ZZ-SLT19-VERIFY-", "ZZ-STOCK-VERIFY-", "ZZ-STUB-", "ZZ-SUP-",
];

const apply = process.argv.includes("--apply");

async function main() {
  const p = new PrismaClient({
    adapter: new PrismaMssql(parseMssqlUrl(process.env.DATABASE_URL!)),
  });

  const found: Array<Record<string, string | number>> = [];

  for (const prefix of PREFIXES) {
    const lower = prefix.toLowerCase();
    const samples = await p.sample.count({ where: { sampleCode: { startsWith: prefix } } });
    const orders = await p.sampleOrder.count({
      where: { OR: [{ inciName: { startsWith: prefix } }, { supplierName: { startsWith: prefix } }] },
    });
    const users = await p.user.count({ where: { adUsername: { startsWith: lower } } });
    const ingredients = await p.ingredientListEntry.count({ where: { inciName: { startsWith: prefix } } });
    const suppliers = await p.supplier.count({ where: { name: { startsWith: prefix } } });
    if (samples || orders || users || ingredients || suppliers) {
      found.push({ prefix, samples, orders, users, ingredients, suppliers });
    }
  }

  if (found.length === 0) {
    console.log("No test residue found.");
    await p.$disconnect();
    return;
  }

  console.table(found);

  if (!apply) {
    console.log("\n(dry run — nothing removed. Re-run with --apply.)");
    await p.$disconnect();
    return;
  }

  for (const { prefix } of found) {
    const pre = String(prefix);
    const lower = pre.toLowerCase();

    const sampleIds = (
      await p.sample.findMany({ where: { sampleCode: { startsWith: pre } }, select: { id: true } })
    ).map((s) => s.id);
    const orderIds = (
      await p.sampleOrder.findMany({
        where: { OR: [{ inciName: { startsWith: pre } }, { supplierName: { startsWith: pre } }] },
        select: { id: true },
      })
    ).map((o) => o.id);

    // Children first, then the rows they hang off.
    await p.sampleOrderSupplierDocument.deleteMany({ where: { orderSupplier: { orderId: { in: orderIds } } } });
    await p.sampleOrderSupplier.deleteMany({ where: { orderId: { in: orderIds } } });
    await p.sampleOrderIngredient.deleteMany({ where: { orderId: { in: orderIds } } });
    await p.sampleOrder.deleteMany({ where: { id: { in: orderIds } } });

    await p.feedback.deleteMany({ where: { sampleId: { in: sampleIds } } });
    await p.sampleRequest.deleteMany({ where: { sampleId: { in: sampleIds } } });
    await p.transaction.deleteMany({ where: { sampleId: { in: sampleIds } } });
    await p.locationHistory.deleteMany({ where: { sampleId: { in: sampleIds } } });
    await p.samplePiece.deleteMany({ where: { sampleId: { in: sampleIds } } });
    await p.sampleIngredient.deleteMany({ where: { sampleId: { in: sampleIds } } });
    await p.sample.deleteMany({ where: { id: { in: sampleIds } } });

    await p.supplier.deleteMany({ where: { name: { startsWith: pre } } });
    await p.ingredientListEntry.deleteMany({ where: { inciName: { startsWith: pre } } });
    await p.user.deleteMany({ where: { adUsername: { startsWith: lower } } });
    console.log(`cleared ${pre}`);
  }

  console.log(`\nreal samples still present: ${await p.sample.count()}`);
  console.log(`real users still present:   ${await p.user.count()}`);
  console.log(`real orders still present:  ${await p.sampleOrder.count()}`);
  await p.$disconnect();
}
main();
