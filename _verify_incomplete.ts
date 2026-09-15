import "dotenv/config";
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { PrismaMssql } from "@prisma/adapter-mssql";
import { parseMssqlUrl } from "./src/lib/mssql-url";
import { isIncomplete, filledSafetyFields, SAFETY_FIELDS } from "./src/lib/ingredients";

// SLT-18's incomplete-data warning: which fields count, what "empty" means, and the rule
// that one filled field is enough to clear it.

const PREFIX = "ZZ-INC-";
let failures = 0;
const check = (label: string, actual: unknown, expected: unknown) => {
  const ok = String(actual) === String(expected);
  if (!ok) failures++;
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${label.padEnd(62)} ${actual}${ok ? "" : `   (expected ${expected})`}`
  );
};

const prisma = new PrismaClient({
  adapter: new PrismaMssql(parseMssqlUrl(process.env.DATABASE_URL!)),
});

async function main() {
  console.log("=== the 16 fields, and only those ===");
  check("exactly 16 safety fields", SAFETY_FIELDS.length, 16);
  for (const f of ["euRegulation", "euAnnex", "restriction", "euOpinion", "chinaListed",
    "endocrineDisruptor", "cmr", "dermalAbsorption", "noael", "biodegradability", "pbt",
    "aquaticToxicity", "aquaticHazardStatements", "yukaRating", "inciBeautyRating", "beeslineRating"]) {
    check(`  counts ${f}`, SAFETY_FIELDS.includes(f as never), true);
  }
  for (const f of ["molecularFormula", "molecularWeight", "chemicalFamily", "casNumbers",
    "regulatoryFunction", "comments", "inciName", "uid"]) {
    check(`  ignores ${f}`, SAFETY_FIELDS.includes(f as never), false);
  }

  console.log("\n=== what counts as empty ===");
  check("wholly empty record", isIncomplete({}), true);
  check("all 16 explicitly null", isIncomplete(Object.fromEntries(SAFETY_FIELDS.map((f) => [f, null]))), true);
  check("blank string is empty", isIncomplete({ noael: "" }), true);
  check("whitespace-only is empty", isIncomplete({ noael: "   " }), true);

  console.log("\n=== what counts as filled ===");
  check("'Not Available' on a tristate is an answer", isIncomplete({ cmr: "NA" }), false);
  check("'Not Applicable' biodegradability is an answer", isIncomplete({ biodegradability: "NOT_APPLICABLE" }), false);
  check("false on a Yes/No is an answer", isIncomplete({ euRegulation: false }), false);
  check("false on PBT is an answer", isIncomplete({ pbt: false }), false);
  check("true is an answer", isIncomplete({ chinaListed: true }), false);
  check("a rating is an answer", isIncomplete({ beeslineRating: 1 }), false);
  check("text is an answer", isIncomplete({ euAnnex: "No" }), false);

  console.log("\n=== one field is enough (AC2) ===");
  for (const field of SAFETY_FIELDS) {
    const only = { [field]: field.endsWith("Rating") ? 3 : typeof field === "string" ? "x" : true };
    check(`  only ${field} filled -> no warning`, isIncomplete(only), false);
  }

  console.log("\n=== identity fields don't satisfy the check (AC3) ===");
  check("name + CAS + comments only, still incomplete",
    isIncomplete({ molecularFormula: "C6H6", molecularWeight: "78", chemicalFamily: "Aromatic",
      regulatoryFunction: "Solvent", comments: "a long note" } as never), true);

  console.log("\n=== against real rows ===");
  const bare = await prisma.ingredientListEntry.create({
    data: { inciName: PREFIX + "BARE", uid: PREFIX + "1", comments: "identity only, no safety data",
      molecularFormula: "C2H6O", chemicalFamily: "Alcohol", regulatoryFunction: "Solvent" },
  });
  const oneField = await prisma.ingredientListEntry.create({
    data: { inciName: PREFIX + "ONE", uid: PREFIX + "2", beeslineRating: 4 },
  });
  const notAvailable = await prisma.ingredientListEntry.create({
    data: { inciName: PREFIX + "NA", uid: PREFIX + "3", cmr: "NA" },
  });
  const noFlag = await prisma.ingredientListEntry.create({
    data: { inciName: PREFIX + "NO", uid: PREFIX + "4", euRegulation: false },
  });

  try {
    const rows = await prisma.ingredientListEntry.findMany({
      where: { inciName: { startsWith: PREFIX } },
      orderBy: { uid: "asc" },
    });
    console.table(rows.map((r) => ({
      ingredient: r.inciName.replace(PREFIX, ""),
      incomplete: isIncomplete(r),
      filled: filledSafetyFields(r).join(", ") || "(none)",
    })));

    const by = (id: string) => rows.find((r) => r.id === id)!;
    check("identity-only record warns (AC1/AC3)", isIncomplete(by(bare.id)), true);
    check("one rating clears it (AC2)", isIncomplete(by(oneField.id)), false);
    check("an explicit 'Not Available' clears it", isIncomplete(by(notAvailable.id)), false);
    check("an explicit No clears it", isIncomplete(by(noFlag.id)), false);
    check("filled list is accurate", filledSafetyFields(by(oneField.id)).join(","), "beeslineRating");

    console.log("\n=== styling is a nudge, not an error (AC4) ===");
    const lib = readFileSync("src/lib/ingredients.ts", "utf8");
    check("row tint is amber", /INCOMPLETE_ROW_CLASS = "bg-warning\/10"/.test(lib), true);
    check("row tint is not red", /INCOMPLETE_ROW_CLASS = "[^"]*danger/.test(lib), false);
    const table = readFileSync("src/app/(app)/ingredients/page.tsx", "utf8");
    check("table tints incomplete rows", /isIncomplete\(ing\) \? INCOMPLETE_ROW_CLASS/.test(table), true);
    const detail = readFileSync("src/app/(app)/ingredients/[id]/page.tsx", "utf8");
    check("detail shows the note", /isIncomplete\(ing\) &&/.test(detail), true);
    check("note is amber, not red", /border-warning\/40 bg-warning\/10/.test(detail), true);
    check("note carries no danger styling", /isIncomplete[\s\S]{0,400}text-danger/.test(detail), false);
  } finally {
    await prisma.ingredientListEntry.deleteMany({ where: { inciName: { startsWith: PREFIX } } });
    console.log("\ncleanup done");
    await prisma.$disconnect();
  }

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}
main();
