import "dotenv/config";
import { loadShelfCellColors } from "./src/lib/shelf";
import { SHELF_LETTERS, SHELF_LEVELS, shelfCellKey } from "./src/lib/categories";
import { CATEGORY_COLORS } from "./src/lib/taxonomy";

let failures = 0;
const check = (label: string, actual: unknown, expected: unknown) => {
  const ok = String(actual) === String(expected);
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label.padEnd(34)} ${actual}${ok ? "" : `   (expected ${expected})`}`);
};

async function main() {
  const colors = await loadShelfCellColors();

  console.log("\n=== The shelf grid, level 5 down to 1 ===");
  const swatch = (hex?: string) => hex ?? "  —    ";
  for (const level of [...SHELF_LEVELS].reverse()) {
    console.log(
      `L${level}  ` +
        SHELF_LETTERS.map((l) => `${l}${level}:${swatch(colors[shelfCellKey(l, level)])}`).join("  ")
    );
  }

  console.log("\n=== Cells match the pixel-verified plan ===");
  check("I1 = Woody", colors["I1"], CATEGORY_COLORS.Woody);
  check("H5 = Floral", colors["H5"], CATEGORY_COLORS.Floral);
  check("J4 = Essential Oils", colors["J4"], CATEGORY_COLORS["Essential Oils"]);
  check("G4 = Colorant", colors["G4"], CATEGORY_COLORS.Colorant);
  check("G5 = Colorant", colors["G5"], CATEGORY_COLORS.Colorant);
  check("F1 = Organic", colors["F1"], CATEGORY_COLORS.Organic);
  check("F2 = Organic", colors["F2"], CATEGORY_COLORS.Organic);
  check("F3 = Oils", colors["F3"], CATEGORY_COLORS.Oils);

  console.log("\n=== Bands are one flat colour across every cell ===");
  const band = (letters: string[], expected: string, label: string) => {
    const cells = letters.flatMap((l) => SHELF_LEVELS.map((lv) => shelfCellKey(l, lv)));
    const distinct = new Set(cells.map((c) => colors[c]));
    check(`${label} (${cells.length} cells, 1 colour)`, [...distinct].join(","), expected);
  };
  band(["A", "B"], CATEGORY_COLORS.Chemicals, "Chemicals A-B");
  band(["C", "D", "E"], CATEGORY_COLORS.Natural, "Natural C-E");

  console.log("\n=== Cells the plan leaves blank have no colour ===");
  check("F4 uncoloured", colors["F4"] ?? "none", "none");
  check("F5 uncoloured", colors["F5"] ?? "none", "none");
  check("J5 uncoloured", colors["J5"] ?? "none", "none");

  console.log("\n=== Coverage ===");
  const total = SHELF_LETTERS.length * SHELF_LEVELS.length;
  check("coloured cells", Object.keys(colors).length, total - 3);
  console.log(`(${total} cells in the grid, 3 left blank by the plan)`);

  console.log("\n=== Legacy samples now get a real colour ===");
  // These sit at cells the plan colours, even though their category/source predate the taxonomy.
  check("J2 (legacy sample)", colors["J2"], CATEGORY_COLORS.Nuts);
  check("J3 (legacy sample)", colors["J3"], CATEGORY_COLORS.Powdery);
  check("H4 (legacy sample)", colors["H4"], CATEGORY_COLORS.Spicy);

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}
main();
