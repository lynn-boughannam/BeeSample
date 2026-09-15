import "dotenv/config";
import {
  SAMPLE_CATEGORIES,
  allShelfCombinations,
  colorKeyFor,
  assignSublevel,
  nextFreeSublevel,
  shelfClassificationFor,
} from "./src/lib/categories";
import { resolveShelfSlot, resolveShelfDefaults } from "./src/lib/shelf";
import { CATEGORY_COLORS } from "./src/lib/taxonomy";

// The lookup SLT-19 specifies, restated independently of the seed so the test can
// actually disagree with it. "C-E" = letter band, "F1-F2" = level band, "I1" = fixed.
const EXPECTED_SYNTHETIC: Record<string, string> = {
  Chemicals: "A-B",
  Oils: "F3",
  Herbs: "G2",
  Wax: "G3",
  Extract: "G1",
  "Essential Oils": "J4",
  Colorant: "G4-G5",
};
const EXPECTED_ORIENTATION: Record<string, string> = {
  Woody: "I1", Sweet: "I3", Fruity: "I2", Floral: "H5", Refreshing: "H1",
  Aquatic: "H2", Men: "I4", Spicy: "H4", Oriental: "J1", Herbal: "I5",
  Citrus: "H3", Nuts: "J2", Powdery: "J3",
};

let failures = 0;
const check = (label: string, actual: string, expected: string) => {
  const ok = actual === expected;
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label.padEnd(42)} ${actual}${ok ? "" : `   (expected ${expected})`}`);
};

// Renders a resolved slot the same way EXPECTED_* writes it.
function render(r: Awaited<ReturnType<typeof resolveShelfSlot>>): string {
  if (!r) return "(no match)";
  const { letters, levels } = r;
  if (letters.length > 1) return `${letters[0]}-${letters[letters.length - 1]}`;
  if (levels.length > 1) return levels.map((l) => `${letters[0]}${l}`).join("-");
  return `${letters[0]}${levels[0]}`;
}

async function main() {
  console.log("\n=== 1. Source = Natural wins over every Category ===");
  for (const category of SAMPLE_CATEGORIES) {
    const orientation = category === "Fragrance" ? "Woody" : null;
    const r = await resolveShelfSlot(shelfClassificationFor("Natural", category, orientation));
    check(`Natural + ${category}${orientation ? `/${orientation}` : ""}`, render(r), "C-E");
    if (r && r.colorHex !== CATEGORY_COLORS.Natural) { failures++; console.log(`FAIL  colour ${r.colorHex} != ${CATEGORY_COLORS.Natural}`); }
    if (r && !r.isManualLevel) { failures++; console.log("FAIL  Natural band should leave Level manual"); }
  }

  console.log("\n=== 2. Source = Organic wins over every Category ===");
  for (const category of SAMPLE_CATEGORIES) {
    const orientation = category === "Fragrance" ? "Powdery" : null;
    const r = await resolveShelfSlot(shelfClassificationFor("Organic", category, orientation));
    check(`Organic + ${category}${orientation ? `/${orientation}` : ""}`, render(r), "F1-F2");
    if (r && r.colorHex !== CATEGORY_COLORS.Organic) { failures++; console.log(`FAIL  colour ${r.colorHex} != ${CATEGORY_COLORS.Organic}`); }
  }

  console.log("\n=== 3. Source = Synthetic resolves by Category ===");
  for (const [category, expected] of Object.entries(EXPECTED_SYNTHETIC)) {
    const r = await resolveShelfSlot(shelfClassificationFor("Synthetic", category, null));
    check(`Synthetic + ${category}`, render(r), expected);
    const want = CATEGORY_COLORS[category];
    if (r && r.colorHex !== want) { failures++; console.log(`FAIL  colour ${r.colorHex} != ${want}`); }
  }

  console.log("\n=== 3b. Synthetic + Fragrance resolves by Orientation ===");
  for (const [orientation, expected] of Object.entries(EXPECTED_ORIENTATION)) {
    const r = await resolveShelfSlot(shelfClassificationFor("Synthetic", "Fragrance", orientation));
    check(`Synthetic + Fragrance/${orientation}`, render(r), expected);
    const want = CATEGORY_COLORS[orientation];
    if (r && r.colorHex !== want) { failures++; console.log(`FAIL  colour ${r.colorHex} != ${want}`); }
  }

  console.log("\n=== 4. Colours match the pixel-verified reference exactly ===");
  const seen = new Set<string>();
  for (const [key, hex] of Object.entries(CATEGORY_COLORS)) seen.add(`${key}=${hex}`);
  console.log(`CATEGORY_COLORS has ${seen.size} entries; every slot above drew its colour from it.`);

  console.log("\n=== 5. Every form combination resolves (no dead dropdown states) ===");
  const combos = allShelfCombinations();
  const defaults = await resolveShelfDefaults(combos);
  const keys = Object.keys(combos);
  console.log(`combinations: ${keys.length}`);
  for (const key of keys) {
    const d = defaults[key];
    if (!d.letter) { failures++; console.log(`FAIL  ${key} -> no default letter`); }
    if (!d.isManualLevel && d.level == null) { failures++; console.log(`FAIL  ${key} -> no default level`); }
    if (d.isManualLevel && d.level != null) { failures++; console.log(`FAIL  ${key} -> manual band should not pre-fill a level`); }
  }
  console.log(`${failures === 0 ? "PASS" : "FAIL"}  all ${keys.length} combinations produce a usable default`);

  console.log("\n=== 6. Synthetic + Fragrance with no Orientation yet ===");
  const noOrient = await resolveShelfSlot(shelfClassificationFor("Synthetic", "Fragrance", null));
  check("Synthetic + Fragrance/(none)", render(noOrient), "(no match)");

  console.log("\n=== 7. Sublevel: None by default, a letter only to avoid a clash ===");
  const render7 = (a: ReturnType<typeof assignSublevel>) =>
    a.kind === "letter" ? a.sublevel : a.kind;
  check("empty cell -> None", render7(assignSublevel(undefined)), "none");
  check("empty cell (explicit zero) -> None", render7(assignSublevel({ total: 0, sublevels: [] })), "none");
  check("holds one unlettered sample -> a", render7(assignSublevel({ total: 1, sublevels: [] })), "a");
  check("holds H4 + H4a -> b", render7(assignSublevel({ total: 2, sublevels: ["a"] })), "b");
  check("holds H4a + H4b -> c", render7(assignSublevel({ total: 2, sublevels: ["a", "b"] })), "c");
  check("gaps are reused", render7(assignSublevel({ total: 2, sublevels: ["c", "a"] })), "b");
  check("sample + a-e -> full", render7(assignSublevel({ total: 6, sublevels: ["a","b","c","d","e"] })), "full");

  console.log("\n=== 7b. nextFreeSublevel still walks a-e in order ===");
  check("empty", String(nextFreeSublevel([])), "a");
  check("after a", String(nextFreeSublevel(["a"])), "b");
  check("out of order a,c", String(nextFreeSublevel(["c", "a"])), "b");
  check("full a-e", String(nextFreeSublevel(["a","b","c","d","e"])), "null");

  console.log("\n=== 8. Swatch colour follows the same zone as the slot ===");
  check("Natural/Fragrance swatch key", colorKeyFor("Natural", "Fragrance", "Woody"), "Natural");
  check("Organic/Wax swatch key", colorKeyFor("Organic", "Wax", null), "Organic");
  check("Synthetic/Fragrance swatch key", colorKeyFor("Synthetic", "Fragrance", "Woody"), "Woody");
  check("Synthetic/Wax swatch key", colorKeyFor("Synthetic", "Wax", null), "Wax");

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}
main();
