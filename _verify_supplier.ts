import "dotenv/config";
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { PrismaMssql } from "@prisma/adapter-mssql";
import { parseMssqlUrl } from "./src/lib/mssql-url";

// Suppliers named on an order join the managed Supplier list if they aren't on it already.
// Mirrors ensureSupplier() in createSampleOrder() against real rows.

const PREFIX = "ZZ-SUP-";
let failures = 0;
const check = (label: string, actual: unknown, expected: unknown) => {
  const ok = String(actual) === String(expected);
  if (!ok) failures++;
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${label.padEnd(60)} ${actual}${ok ? "" : `   (expected ${expected})`}`
  );
};

const prisma = new PrismaClient({
  adapter: new PrismaMssql(parseMssqlUrl(process.env.DATABASE_URL!)),
});

async function ensureSupplier(raw: string | null | undefined) {
  const name = (raw ?? "").trim();
  if (!name) return;
  const existing = await prisma.supplier.findFirst({ where: { name }, select: { id: true } });
  if (existing) return;
  try {
    await prisma.supplier.create({ data: { name } });
  } catch {
    /* already added concurrently — the outcome we wanted */
  }
}

async function main() {
  const existing = await prisma.supplier.findFirst({ orderBy: { name: "asc" } });
  const before = await prisma.supplier.count();
  const brandNew = PREFIX + "Novel Chemicals SA";

  console.log(`starting from ${before} suppliers; existing sample: ${existing?.name ?? "(none)"}`);

  try {
    console.log("\n=== a supplier not on the list is added ===");
    await ensureSupplier(brandNew);
    check("one new supplier created", (await prisma.supplier.count()) - before, 1);
    check("stored with the typed name",
      (await prisma.supplier.findFirst({ where: { name: brandNew } }))?.name, brandNew);

    console.log("\n=== an existing one is reused, never duplicated ===");
    await ensureSupplier(brandNew);
    check("submitting the same name again adds nothing",
      await prisma.supplier.count({ where: { name: brandNew } }), 1);
    // The collation is case-insensitive, so a different casing must not make a twin.
    await ensureSupplier(brandNew.toLowerCase());
    check("a different casing doesn't create a twin",
      await prisma.supplier.count({ where: { name: brandNew } }), 1);
    if (existing) {
      await ensureSupplier(existing.name.toUpperCase());
      check("an already-listed supplier is untouched",
        await prisma.supplier.count({ where: { name: existing.name } }), 1);
    }

    console.log("\n=== blanks are ignored ===");
    const beforeBlanks = await prisma.supplier.count();
    for (const blank of ["", "   ", null, undefined]) await ensureSupplier(blank);
    check("nothing created from empty input",
      (await prisma.supplier.count()) - beforeBlanks, 0);

    console.log("\n=== padding is trimmed, not stored ===");
    await ensureSupplier(`  ${PREFIX}Padded Co  `);
    check("stored without surrounding spaces",
      await prisma.supplier.count({ where: { name: PREFIX + "Padded Co" } }), 1);

    console.log("\n=== wiring ===");
    const form = readFileSync("src/app/(app)/orders/order-form.tsx", "utf8");
    check("suppliers are suggested, not a closed set", /list="supplierOptions"/.test(form), true);
    check("one datalist feeds every supplier box",
      (form.match(/list="supplierOptions"/g) ?? []).length >= 2, true);
    check("the single supplier field is no longer a <Select>",
      /id="supplierName"[\s\S]{0,200}<option value="">Select/.test(form), false);
    check("the form says new suppliers get saved", /added to it on submit/.test(form), true);

    const action = readFileSync("src/app/(app)/orders/actions.ts", "utf8");
    check("the action ensures each supplier exists", /ensureSupplierNamed/.test(action), true);
    check("all three boxes are covered",
      /ensureSupplierNamed\(data\.supplier1\)[\s\S]*ensureSupplierNamed\(data\.supplier3\)/.test(action), true);
    check("the single-supplier types are covered too",
      /ensureSupplierNamed\(data\.supplierName\)/.test(action), true);
    // Editing a request names suppliers too, so it has to ensure them as well.
    check("editing a request ensures them too",
      (action.match(/ensureSupplierNamed\(data\.supplierName\)/g) ?? []).length, 2);
    check("the reference list page is revalidated",
      /revalidatePath\("\/settings\/lists"\)/.test(action), true);

    const newPage = readFileSync("src/app/(app)/orders/new/page.tsx", "utf8");
    check("suggestions come from the managed table", /prisma\.supplier\.findMany/.test(newPage), true);
    check("names already used on samples are suggested too",
      /distinct: \["supplier"\]/.test(newPage), true);
  } finally {
    await prisma.supplier.deleteMany({ where: { name: { startsWith: PREFIX } } });
    console.log(`\ncleanup done — suppliers back to ${await prisma.supplier.count()}`);
    await prisma.$disconnect();
  }

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}
main();
