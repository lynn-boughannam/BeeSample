import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaMssql } from "@prisma/adapter-mssql";
import { parseMssqlUrl } from "./src/lib/mssql-url";

// Fetches a sample's edit page with a real session and compares what each control renders
// against what the database holds, so "some fields get cleared" becomes a specific list.

const BASE = "http://localhost:3000";
const COOKIE = process.env.VERIFY_COOKIE ?? "";

const day = (d: Date) => d.toISOString().slice(0, 10);

// Pulls value="..." off the input with this name, or the selected option of a select.
function renderedValue(html: string, name: string): string | null {
  const input = new RegExp(`<input[^>]*name="${name}"[^>]*>`, "i").exec(html)?.[0];
  if (input) return /value="([^"]*)"/.exec(input)?.[1] ?? "";

  const select = new RegExp(`<select[^>]*name="${name}"[^>]*>([\\s\\S]*?)</select>`, "i").exec(html);
  if (select) {
    const selected = /<option[^>]*selected[^>]*value="([^"]*)"/i.exec(select[1])
      ?? /<option[^>]*value="([^"]*)"[^>]*selected/i.exec(select[1]);
    return selected?.[1] ?? "";
  }
  return null;
}

async function main() {
  const prisma = new PrismaClient({
    adapter: new PrismaMssql(parseMssqlUrl(process.env.DATABASE_URL!)),
  });

  // The sample with the most fields populated gives the best signal.
  const samples = await prisma.sample.findMany({
    where: { isDiscarded: false },
    include: { ingredients: true },
  });
  const richest = samples.sort(
    (a, b) =>
      Object.values(b).filter((v) => v !== null && v !== "").length -
      Object.values(a).filter((v) => v !== null && v !== "").length
  )[0];

  console.log(`sample: ${richest.sampleCode} (${richest.id})\n`);

  const res = await fetch(`${BASE}/library/${richest.id}/edit`, { headers: { cookie: COOKIE } });
  const html = await res.text();
  console.log(`edit page: HTTP ${res.status}, ${html.length} bytes\n`);

  const expected: Record<string, string> = {
    sampleCode: richest.sampleCode,
    rmName: richest.rmName,
    category: richest.category,
    fragranceOrientation: richest.fragranceOrientation ?? "",
    function: richest.function,
    physicalForm: richest.physicalForm,
    source: richest.source,
    supplier: richest.supplier,
    projectName: richest.projectName ?? "",
    hazardClass: richest.hazardClass ?? "",
    receptionDate: day(richest.receptionDate),
    expiryDate: day(richest.expiryDate),
    receivedQtyG: richest.totalQtyG.toString(),
    receivedQtyPcs: richest.receivedQtyPcs != null ? String(richest.receivedQtyPcs) : "",
    netWeightG: richest.netWeightG != null ? richest.netWeightG.toString() : "",
    batchLot: richest.batchLot ?? "",
    documentAvailability: richest.documentAvailability ?? "",
    shelfLetter: richest.shelfLetter,
    shelfLevel: String(richest.shelfLevel),
    shelfSublevel: richest.shelfSublevel != null ? String(richest.shelfSublevel) : "",
  };

  const rows: Array<Record<string, string>> = [];
  const cleared: string[] = [];

  for (const [name, want] of Object.entries(expected)) {
    const got = renderedValue(html, name);
    const status =
      got === null ? "NOT RENDERED" : got === want ? "ok" : want === "" ? "ok (empty in db)" : "CLEARED";
    if (status === "CLEARED" || status === "NOT RENDERED") cleared.push(name);
    rows.push({ field: name, inDatabase: want || "(empty)", onForm: got ?? "(absent)", status });
  }

  console.table(rows);

  console.log(`\ningredients in db: ${richest.ingredients.length}`);
  const checked = (html.match(/name="ingredientIds"[^>]*checked/g) ?? []).length;
  console.log(`ingredient boxes checked on form: ${checked}`);
  if (checked !== richest.ingredients.length) cleared.push("ingredientIds");

  console.log(
    cleared.length === 0
      ? "\nNo fields are cleared — every control renders its stored value."
      : `\nFIELDS NOT CARRYING THEIR VALUE: ${cleared.join(", ")}`
  );

  await prisma.$disconnect();
}
main();
