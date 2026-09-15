import "dotenv/config";
import { PrismaClient, type Prisma } from "@prisma/client";
import { PrismaMssql } from "@prisma/adapter-mssql";
import { parseMssqlUrl } from "../src/lib/mssql-url";
import { CATEGORY_COLORS } from "../src/lib/taxonomy";

const adapter = new PrismaMssql(parseMssqlUrl(process.env.DATABASE_URL!));
const prisma = new PrismaClient({ adapter });

// The shelf-slot lookup table (SLT-19). Rows are matched Source first: Natural and
// Organic each claim a zone whatever the sample is, and only then does Category decide —
// with Fragrance deferring to its Orientation instead. See resolveShelfSlot() and the
// ShelfSlotConfig comment in schema.prisma.
//
// Colours are read from CATEGORY_COLORS rather than restated here, so the pixel-verified
// palette has exactly one definition and the swatch on a sample row can never disagree
// with the zone it resolves to.
type SlotRow = {
  source: string;
  // Null on the two Source-driven zones, which apply across every Category.
  category?: string;
  fragranceOrientation?: string;
  letter?: string;
  level?: number;
  letterRangeStart?: string;
  letterRangeEnd?: string;
  levelRangeStart?: number;
  levelRangeEnd?: number;
  // Set on the letter bands, where the plan reserves whole columns and says nothing
  // about which level a sample sits on (mapping doc §5 — still open with Rawan).
  isManualLevel?: boolean;
  // Key into CATEGORY_COLORS.
  colorKey: string;
};

const slots: SlotRow[] = [
  // 1–2. Source-driven zones. Category is deliberately absent: a Natural fragrance and a
  // Natural wax are filed in the same band. Natural's band grew from D–E to C–E and
  // Chemicals' shrank from A–C to A–B in the corrected plan.
  {
    source: "Natural",
    letterRangeStart: "C",
    letterRangeEnd: "E",
    isManualLevel: true,
    colorKey: "Natural",
  },
  { source: "Organic", letter: "F", levelRangeStart: 1, levelRangeEnd: 2, colorKey: "Organic" },

  // 3. Synthetic, by Category.
  {
    source: "Synthetic",
    category: "Chemicals",
    letterRangeStart: "A",
    letterRangeEnd: "B",
    isManualLevel: true,
    colorKey: "Chemicals",
  },
  { source: "Synthetic", category: "Oils", letter: "F", level: 3, colorKey: "Oils" },
  { source: "Synthetic", category: "Extract", letter: "G", level: 1, colorKey: "Extract" },
  { source: "Synthetic", category: "Herbs", letter: "G", level: 2, colorKey: "Herbs" },
  { source: "Synthetic", category: "Wax", letter: "G", level: 3, colorKey: "Wax" },
  {
    source: "Synthetic",
    category: "Colorant",
    letter: "G",
    levelRangeStart: 4,
    levelRangeEnd: 5,
    colorKey: "Colorant",
  },
  {
    source: "Synthetic",
    category: "Essential Oils",
    letter: "J",
    level: 4,
    colorKey: "Essential Oils",
  },

  // 3 (cont.). Synthetic + Fragrance resolves on Orientation, not Category — all 13 of
  // them, filling columns H and I and three of J's slots.
  ...(
    [
      ["Refreshing", "H", 1],
      ["Aquatic", "H", 2],
      ["Citrus", "H", 3],
      ["Spicy", "H", 4],
      ["Floral", "H", 5],
      ["Woody", "I", 1],
      ["Fruity", "I", 2],
      ["Sweet", "I", 3],
      ["Men", "I", 4],
      ["Herbal", "I", 5],
      ["Oriental", "J", 1],
      ["Nuts", "J", 2],
      ["Powdery", "J", 3],
    ] as const
  ).map(([orientation, letter, level]): SlotRow => ({
    source: "Synthetic",
    category: "Fragrance",
    fragranceOrientation: orientation,
    letter,
    level,
    colorKey: orientation,
  })),
];

// SQL Server's composite-unique lookup type won't accept `null` for nullable
// columns, so upsert manually (findFirst + create/update) instead of .upsert().
async function upsertSlot(
  match: { source: string; category: string | null; fragranceOrientation: string | null },
  data: Omit<Prisma.ShelfSlotConfigCreateInput, keyof typeof match>
) {
  const existing = await prisma.shelfSlotConfig.findFirst({ where: match });
  if (existing) {
    await prisma.shelfSlotConfig.update({ where: { id: existing.id }, data });
  } else {
    await prisma.shelfSlotConfig.create({ data: { ...match, ...data } });
  }
}

async function main() {
  for (const slot of slots) {
    const colorHex = CATEGORY_COLORS[slot.colorKey];
    if (!colorHex) {
      throw new Error(`No pixel-verified colour for "${slot.colorKey}" in CATEGORY_COLORS.`);
    }

    await upsertSlot(
      {
        source: slot.source,
        category: slot.category ?? null,
        fragranceOrientation: slot.fragranceOrientation ?? null,
      },
      {
        letter: slot.letter ?? null,
        level: slot.level ?? null,
        letterRangeStart: slot.letterRangeStart ?? null,
        letterRangeEnd: slot.letterRangeEnd ?? null,
        levelRangeStart: slot.levelRangeStart ?? null,
        levelRangeEnd: slot.levelRangeEnd ?? null,
        isManualLevel: slot.isManualLevel ?? false,
        colorHex,
      }
    );
  }

  // Starter INCI entries so the Add Sample checklist (SLT-13) has something to select
  // and search against. The real master list is SLT-18's job; these are a working set,
  // spread across chemical families so filtering by family is exercisable.
  const ingredientRows: Array<{ inciName: string; chemicalFamily: string }> = [
    { inciName: "Limonene", chemicalFamily: "Terpene" },
    { inciName: "Linalool", chemicalFamily: "Terpene alcohol" },
    { inciName: "Citral", chemicalFamily: "Aldehyde" },
    { inciName: "Geraniol", chemicalFamily: "Terpene alcohol" },
    { inciName: "Benzyl Alcohol", chemicalFamily: "Aromatic alcohol" },
    { inciName: "Benzyl Salicylate", chemicalFamily: "Ester" },
    { inciName: "Coumarin", chemicalFamily: "Lactone" },
    { inciName: "Eugenol", chemicalFamily: "Phenol" },
    { inciName: "Vanillin", chemicalFamily: "Aldehyde" },
    { inciName: "Glycerin", chemicalFamily: "Polyol" },
    { inciName: "Cetearyl Alcohol", chemicalFamily: "Fatty alcohol" },
    { inciName: "Tocopherol", chemicalFamily: "Antioxidant" },
    { inciName: "Butyrospermum Parkii Butter", chemicalFamily: "Plant butter" },
    { inciName: "Cera Alba", chemicalFamily: "Wax" },
    { inciName: "Titanium Dioxide", chemicalFamily: "Mineral pigment" },
  ];
  for (const ing of ingredientRows) {
    const existing = await prisma.ingredientListEntry.findFirst({
      where: { inciName: ing.inciName },
    });
    if (!existing) {
      await prisma.ingredientListEntry.create({ data: ing });
    }
  }

  // The 64 sample Function values. Seeded into the admin-managed reference list rather
  // than hardcoded, so they stay editable at /settings/lists.
  // "Gelatinizing" and "Disintegrant" are spelling-corrected from the supplied list.
  const functionNames = [
    "Cleansing", "Emulsifier", "Sunscreen", "Thickener", "Fragrance", "Smoothing",
    "Colorant", "Conditioning", "Structuring", "Emollient", "Anti-bacterial/antiseptic",
    "Solvent", "Anti-sebum", "Humectant/Moisturizer", "Antiperspirant/Deodorizing",
    "Astringent", "Fragrance/Flavouring", "Solidification", "Anti-aging", "Anti-acne",
    "Enhancer", "Surfactant", "Exfoliating", "Foaming", "Stabilizer", "Antioxidant",
    "Dispersing", "Absorbent", "Whitening", "Anti-inflammatory", "Anti-frizz", "Fixing",
    "Purifying", "Film former", "Fragrance/Flavouring agent", "Hair nourishing",
    "Deodorizing", "Film Former/Thickener", "Finishing", "Oils Absorbing", "SPF Booster",
    "Transparency", "Cold Process Enhancer", "Preservative", "Binding", "Antimicrobial",
    "Essential Oils", "pH adjuster", "Opacifying", "Antiperspirant", "Gelatinizing",
    "Anti-irritant", "Skin Whitening", "Anti-Dandruff", "Anti-fungal", "Anti-bacterial",
    "Lifting", "Thickener/Stabilizer", "Moisturizer/Anti-aging", "Lubricant",
    "Disintegrant", "Cooling", "Hair strength", "Gelling",
  ];
  let addedFunctions = 0;
  for (const name of functionNames) {
    const existing = await prisma.sampleFunction.findFirst({ where: { name } });
    if (!existing) {
      await prisma.sampleFunction.create({ data: { name } });
      addedFunctions++;
    }
  }
  console.log(`functions: ${addedFunctions} added (${functionNames.length} in the list)`);

  const roleRows: Array<{ name: string; description: string }> = [
    { name: "ADMIN", description: "Full system access" },
    { name: "FORMULATOR", description: "Own-scoped access" },
    { name: "DIRECTOR", description: "Scope not yet defined" },
  ];
  const roles: Record<string, { id: string }> = {};
  for (const r of roleRows) {
    roles[r.name] = await prisma.role.upsert({
      where: { name: r.name },
      update: {},
      create: { name: r.name, description: r.description, isSystem: true },
    });
  }

  const adminUsername = (process.env.SEED_ADMIN_USERNAME ?? "admin").toLowerCase();

  await prisma.user.upsert({
    where: { adUsername: adminUsername },
    update: {},
    create: {
      adUsername: adminUsername,
      name: "Admin",
      roleId: roles.ADMIN.id,
    },
  });

  await prisma.user.upsert({
    where: { adUsername: "lynn.boughannam" },
    update: { name: "Lynn Boughannam", roleId: roles.ADMIN.id, isActive: true },
    create: {
      adUsername: "lynn.boughannam",
      name: "Lynn Boughannam",
      roleId: roles.ADMIN.id,
      isActive: true,
    },
  });

  console.log(
    `Seed complete. Admin AD usernames: ${adminUsername}, lynn.boughannam. Both authenticate via the real AD bind now (src/lib/ldap.ts) — no password bypass anymore.`
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
