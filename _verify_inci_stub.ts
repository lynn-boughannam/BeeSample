import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaMssql } from "@prisma/adapter-mssql";
import { parseMssqlUrl } from "./src/lib/mssql-url";
import { isIncomplete } from "./src/lib/ingredients";

// Typed INCI that isn't in the master list becomes a real, linked record rather than loose
// text. Mirrors the resolution step in createSampleOrder() against real rows.

const PREFIX = "ZZ-STUB-";
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

// Mirrors createSampleOrder()'s handling of the free-text box.
async function resolveTyped(raw: string): Promise<string[]> {
  const names = raw.split(",").map((n) => n.trim()).filter(Boolean);
  const ids: string[] = [];
  for (const name of names) {
    const existing = await prisma.ingredientListEntry.findFirst({
      where: { inciName: name },
      select: { id: true },
    });
    if (existing) {
      ids.push(existing.id);
      continue;
    }
    const seq = await prisma.ingredientCodeSequence.upsert({
      where: { id: "INCI" },
      update: { lastValue: { increment: 1 } },
      create: { id: "INCI", lastValue: 1 },
    });
    const created = await prisma.ingredientListEntry.create({
      data: { uid: `INCI${String(seq.lastValue).padStart(4, "0")}`, inciName: name },
      select: { id: true },
    });
    ids.push(created.id);
  }
  return ids;
}

async function main() {
  const admin = await prisma.user.findFirstOrThrow({ where: { role: { name: "ADMIN" } } });
  // An INCI that already exists, to prove reuse rather than duplication.
  const existing = await prisma.ingredientListEntry.findFirstOrThrow({
    orderBy: { inciName: "asc" },
  });

  const newName = PREFIX + "Novel Isethionate";
  const before = await prisma.ingredientListEntry.count();

  const createdIds = await resolveTyped(
    // A brand-new name, one already in the list (different case), and padding/blanks.
    `${newName}, ${existing.inciName.toLowerCase()} ,  , ${newName}`
  );

  const order = await prisma.sampleOrder.create({
    data: {
      requestType: "NEW",
      directorApprovalConfirmed: true,
      orderedById: admin.id,
      inciName: null,
      ingredients: { create: [...new Set(createdIds)].map((id) => ({ ingredientId: id })) },
    },
    include: { ingredients: { include: { ingredient: true } } },
  });

  try {
    const after = await prisma.ingredientListEntry.count();
    console.log("=== what got created ===");
    console.table(
      order.ingredients.map((l) => ({
        uid: l.ingredient.uid,
        inci: l.ingredient.inciName.slice(0, 30),
        incomplete: isIncomplete(l.ingredient),
      }))
    );

    check("exactly one new ingredient was added", after - before, 1);
    check("the existing INCI was reused, not duplicated",
      await prisma.ingredientListEntry.count({ where: { inciName: existing.inciName } }), 1);
    check("a repeated name links once", order.ingredients.length, 2);

    const stub = order.ingredients.find((l) => l.ingredient.inciName === newName)!.ingredient;
    check("the stub carries the typed name", stub.inciName, newName);
    check("it gets a proper INCI#### code", /^INCI\d{4,}$/.test(stub.uid ?? ""), true);
    check("it is flagged as needing safety data", isIncomplete(stub), true);
    check("nothing but the name was invented",
      [stub.chemicalFamily, stub.molecularFormula, stub.comments, stub.regulatoryFunction]
        .every((v) => v === null), true);

    check("the order links it rather than restating it", order.inciName, "null");
    check("the link resolves to the record",
      order.ingredients.every((l) => Boolean(l.ingredient.id)), true);

    console.log("\n=== case-insensitive match uses the existing record ===");
    const reused = order.ingredients.find((l) => l.ingredient.id === existing.id);
    check("lowercase input matched the existing entry", Boolean(reused), true);
    check("its name kept the list's spelling", reused?.ingredient.inciName, existing.inciName);
  } finally {
    await prisma.sampleOrderIngredient.deleteMany({ where: { orderId: order.id } });
    await prisma.sampleOrder.delete({ where: { id: order.id } });
    await prisma.ingredientListEntry.deleteMany({ where: { inciName: { startsWith: PREFIX } } });
    console.log("\ncleanup done");
    console.log("ingredients now:", await prisma.ingredientListEntry.count());
    await prisma.$disconnect();
  }

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}
main();
