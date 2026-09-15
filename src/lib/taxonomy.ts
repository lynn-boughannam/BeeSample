// Category taxonomy per category_shelf_mapping_final.md (pixel-verified shelf plan +
// real taxonomy sheet). This supersedes the earlier "22 flat categories" draft: most of
// those 22 values are actually Subcategory1 options under the top-level category
// "Fragrance", plus a few real top-level Categories and two Subcategory2 values.

export const CATEGORIES = [
  "Chemicals",
  "Wax",
  "Colorant",
  "Extract",
  "Oils",
  "Herbs",
  "Essential Oils",
  "Fragrance",
] as const;

export type Category = (typeof CATEGORIES)[number];

export const SUBCATEGORY1_BY_CATEGORY: Partial<Record<Category, readonly string[]>> = {
  Fragrance: [
    "Woody",
    "Sweet",
    "Fruity",
    "Floral",
    "Refreshing",
    "Aquatic",
    "Men",
    "Spicy",
    "Oriental",
    "Herbal",
    "Citrus",
    "Nuts",
    "Powdery",
  ],
  Chemicals: [
    "Liquid",
    "Powder",
    "Gel/Paste",
    "Viscous Liquid",
    "Solid",
    "Flakes",
    "Fiber",
  ],
};

// Applicability across categories is unconfirmed (doc flags Wax/Extract as likely
// candidates only). Offered as an optional field for every category until confirmed.
export const SUBCATEGORY2_OPTIONS = ["Natural", "Organic"] as const;

export const CATEGORY_COLORS: Record<string, string> = {
  Chemicals: "#FFE699",
  Spicy: "#FEE2D6",
  Nuts: "#FF0000",
  Organic: "#375623",
  Natural: "#BDD7EE",
  Floral: "#1CAA52",
  Colorant: "#92D050",
  Wax: "#66FFCC",
  "Essential Oils": "#CCFF66",
  Sweet: "#FFF2CC",
  Extract: "#66CCFF",
  Refreshing: "#C6E0B4",
  Woody: "#00B0F0",
  Oriental: "#A96BED",
  Herbs: "#FF33CC",
  Aquatic: "#F4B084",
  Fruity: "#FFFF00",
  Herbal: "#FFC000",
  Powdery: "#3366FF",
  Citrus: "#C65911",
  Men: "#F3C5E0",
  Oils: "#FF6600",
};

export function subcategory1Options(category: string): readonly string[] {
  return SUBCATEGORY1_BY_CATEGORY[category as Category] ?? [];
}
