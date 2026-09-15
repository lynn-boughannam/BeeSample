import { nextShelfAddress, type ShelfZone } from "./src/lib/categories";

// Editing a sample and changing Category / Source / Orientation must not silently empty
// or move an address the new zone still covers. Zone shapes below are the real ones from
// resolveShelfDefaults against the seeded plan.

let failures = 0;
const check = (label: string, actual: unknown, expected: unknown) => {
  const ok = String(actual) === String(expected);
  if (!ok) failures++;
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${label.padEnd(60)} ${actual}${ok ? "" : `   (expected ${expected})`}`
  );
};

const NATURAL: ShelfZone = { letter: "C", level: null, zoneLetters: ["C", "D", "E"], zoneLevels: [1, 2, 3, 4, 5] };
const CHEMICALS: ShelfZone = { letter: "A", level: null, zoneLetters: ["A", "B"], zoneLevels: [1, 2, 3, 4, 5] };
const ORGANIC: ShelfZone = { letter: "F", level: 1, zoneLetters: ["F"], zoneLevels: [1, 2] };
const WAX: ShelfZone = { letter: "G", level: 3, zoneLetters: ["G"], zoneLevels: [3] };
const NO_MATCH = undefined;

const at = (letter: string, level: string) => ({ letter, level });
const render = (r: { letter: string; level: string }) =>
  `${r.letter || "(none)"}${r.level || "(blank)"}`;

function main() {
  console.log("=== the reported bug: a manual-level band kept its level ===");
  // Natural reserves columns C-E and says nothing about the level, so an Admin picked one.
  // Changing Category while still Natural used to blank it and snap the row back to C.
  check("Natural D4, Category changes (still Natural)", render(nextShelfAddress(at("D", "4"), NATURAL)), "D4");
  check("Natural C1, Category changes", render(nextShelfAddress(at("C", "1"), NATURAL)), "C1");
  check("Natural E5, Category changes", render(nextShelfAddress(at("E", "5"), NATURAL)), "E5");
  check("Chemicals B2, Category changes", render(nextShelfAddress(at("B", "2"), CHEMICALS)), "B2");

  console.log("\n=== a zone that fixes only some of the address ===");
  // Organic is F1-F2: the row is fixed, the level is a choice between two.
  check("Organic F2 stays F2, not re-defaulted to F1", render(nextShelfAddress(at("F", "2"), ORGANIC)), "F2");
  check("Organic F1 stays F1", render(nextShelfAddress(at("F", "1"), ORGANIC)), "F1");
  check("Organic F4 is outside the zone -> F1", render(nextShelfAddress(at("F", "4"), ORGANIC)), "F1");

  console.log("\n=== a genuine move still re-defaults ===");
  check("Wax G3 -> Natural keeps the level, takes the band", render(nextShelfAddress(at("G", "3"), NATURAL)), "C3");
  check("Natural C5 -> Wax (fixed G3)", render(nextShelfAddress(at("C", "5"), WAX)), "G3");
  check("Natural C3 -> Wax (level already 3)", render(nextShelfAddress(at("C", "3"), WAX)), "G3");
  check("Chemicals A2 -> Organic (level 2 is in F1-F2)", render(nextShelfAddress(at("A", "2"), ORGANIC)), "F2");
  check("Chemicals A5 -> Organic (5 is outside F1-F2)", render(nextShelfAddress(at("A", "5"), ORGANIC)), "F1");

  console.log("\n=== empty and unmatched states ===");
  check("nothing chosen yet, manual band", render(nextShelfAddress(at("", ""), NATURAL)), "C(blank)");
  check("nothing chosen yet, fixed slot", render(nextShelfAddress(at("", ""), WAX)), "G3");
  check("letter set, level not, manual band", render(nextShelfAddress(at("D", ""), NATURAL)), "D(blank)");
  check("no zone matches -> cleared", render(nextShelfAddress(at("D", "4"), NO_MATCH)), "(none)(blank)");

  console.log("\n=== the rule is idempotent ===");
  // Re-applying the same zone must not creep — a second unrelated edit shouldn't move it.
  const once = nextShelfAddress(at("D", "4"), NATURAL);
  const twice = nextShelfAddress(once, NATURAL);
  check("applying twice changes nothing", render(twice), render(once));
  const orgOnce = nextShelfAddress(at("F", "2"), ORGANIC);
  check("Organic applied twice", render(nextShelfAddress(orgOnce, ORGANIC)), "F2");

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}
main();
