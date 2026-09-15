import { CreateSampleWithPiecesSchema, UpdateSampleSchema } from "./src/lib/validation";

let failures = 0;
const check = (label: string, actual: unknown, expected: unknown) => {
  const ok = String(actual) === String(expected);
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label.padEnd(56)} ${actual}${ok ? "" : `   (expected ${expected})`}`);
};

const base = {
  pieceMode: "AUTO", pieceWeights: [],
  sampleCode: "S-9001", rmName: "Test RM",
  category: "Wax", fragranceOrientation: "",
  function: "Emollient", physicalForm: "Solid",
  source: "Natural", supplier: "ACME", projectName: "P1",
  hazardClass: "Non-Hazardous",
  expiryDate: "2030-01-01", receptionDate: "2026-01-01",
  receivedQtyG: "100", receivedQtyPcs: "4", netWeightG: "",
  batchLot: "", documentAvailability: "",
  ingredientIds: ["x"],
  shelfLetter: "C", shelfLevel: "2", shelfSublevel: "",
};

const errorFor = (r: ReturnType<typeof CreateSampleWithPiecesSchema.safeParse>, field: string) =>
  r.success ? "(valid)" : r.error.issues.find((i) => String(i.path[0]) === field)?.message ?? "(no error on field)";

console.log("\n=== Fragrance Orientation is required only for Fragrance (SLT-13) ===");
check("Natural Wax, no orientation",
  CreateSampleWithPiecesSchema.safeParse(base).success, true);
check("Synthetic Chemicals, no orientation",
  CreateSampleWithPiecesSchema.safeParse({ ...base, source: "Synthetic", category: "Chemicals", shelfLetter: "A", shelfLevel: "1" }).success, true);
check("Synthetic Fragrance, no orientation -> blocked",
  errorFor(CreateSampleWithPiecesSchema.safeParse({ ...base, source: "Synthetic", category: "Fragrance", shelfLetter: "I", shelfLevel: "1" }), "fragranceOrientation"),
  "Select a fragrance orientation — it sets the shelf row for fragrances.");
check("Synthetic Fragrance, with orientation",
  CreateSampleWithPiecesSchema.safeParse({ ...base, source: "Synthetic", category: "Fragrance", fragranceOrientation: "Woody", shelfLetter: "I", shelfLevel: "1" }).success, true);
check("Natural Fragrance still needs its orientation",
  CreateSampleWithPiecesSchema.safeParse({ ...base, category: "Fragrance", shelfLetter: "C", shelfLevel: "1" }).success, false);

console.log("\n=== Blank orientation normalises to null, not \"\" ===");
const parsed = CreateSampleWithPiecesSchema.safeParse(base);
check("stored value", parsed.success ? String(parsed.data.fragranceOrientation) : "(invalid)", "null");

console.log("\n=== Sublevel stays optional; blank means 'assign one' ===");
check("blank sublevel parses to null", parsed.success ? String(parsed.data.shelfSublevel) : "(invalid)", "null");
const explicit = CreateSampleWithPiecesSchema.safeParse({ ...base, shelfSublevel: "c" });
check("explicit sublevel kept", explicit.success ? String(explicit.data.shelfSublevel) : "(invalid)", "c");
check("bogus sublevel rejected", CreateSampleWithPiecesSchema.safeParse({ ...base, shelfSublevel: "z" }).success, false);

console.log("\n=== Shelf Level required 1-5 (SLT-13) ===");
check("blank level blocked", CreateSampleWithPiecesSchema.safeParse({ ...base, shelfLevel: "" }).success, false);
check("level 6 blocked", CreateSampleWithPiecesSchema.safeParse({ ...base, shelfLevel: "6" }).success, false);
check("level 5 allowed", CreateSampleWithPiecesSchema.safeParse({ ...base, shelfLevel: "5" }).success, true);

console.log("\n=== Edit inherits the same orientation rule ===");
check("Edit: Natural Wax without orientation",
  UpdateSampleSchema.safeParse({ ...base, id: "abc" }).success, true);
check("Edit: Fragrance without orientation blocked",
  UpdateSampleSchema.safeParse({ ...base, id: "abc", source: "Synthetic", category: "Fragrance" }).success, false);

console.log("\n=== Piece-weight rules still intact (SLT-13 regression) ===");
check("manual weights summing to total",
  CreateSampleWithPiecesSchema.safeParse({ ...base, pieceMode: "MANUAL", pieceWeights: ["25","25","25","25"] }).success, true);
check("manual weights not summing -> blocked",
  CreateSampleWithPiecesSchema.safeParse({ ...base, pieceMode: "MANUAL", pieceWeights: ["25","25","25","20"] }).success, false);

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
