// Option sets for the ingredient compliance record. Kept here so the form, the
// validation schema and the read-only views all agree on the stored values.

// "Not Available" is a real answer from a compliance dossier, distinct from a field
// nobody has filled in yet (which stays null).
export const TRISTATE = ["YES", "NO", "NA"] as const;
export type Tristate = (typeof TRISTATE)[number];

export const TRISTATE_LABELS: Record<Tristate, string> = {
  YES: "Yes",
  NO: "No",
  NA: "Not available",
};

export const BIODEGRADABILITY = [
  "NOT_BIODEGRADABLE",
  "READILY_BIODEGRADABLE",
  "NOT_APPLICABLE",
] as const;
export type Biodegradability = (typeof BIODEGRADABILITY)[number];

export const BIODEGRADABILITY_LABELS: Record<Biodegradability, string> = {
  NOT_BIODEGRADABLE: "Not biodegradable",
  READILY_BIODEGRADABLE: "Readily biodegradable",
  NOT_APPLICABLE: "Not applicable",
};

export const RATINGS = [1, 2, 3, 4, 5] as const;

// Yes/No fields are submitted as these strings and stored as a nullable boolean, where
// an unset value means "not recorded".
export const YES_NO = ["YES", "NO"] as const;

export function toBool(value: FormDataEntryValue | null): boolean | null {
  if (value === "YES") return true;
  if (value === "NO") return false;
  return null;
}

export function fromBool(value: boolean | null | undefined): string {
  if (value === true) return "YES";
  if (value === false) return "NO";
  return "";
}

// The safety and regulatory half of an ingredient record (SLT-18, 2026-09-15). Listed
// explicitly rather than derived, so adding an unrelated column to the model can't quietly
// change what "incomplete" means.
//
// Identity fields — Molecular Formula, Molecular Weight, Chemical Family, CAS Number,
// Regulatory Function, Comments — are deliberately NOT here. They say what the substance
// is, not whether it's safe or permitted, so filling them in doesn't make a record
// compliant-complete and leaving them out doesn't make it incomplete.
export const SAFETY_FIELDS = [
  "euRegulation",
  "euAnnex",
  "restriction",
  "euOpinion",
  "chinaListed",
  "endocrineDisruptor",
  "cmr",
  "dermalAbsorption",
  "noael",
  "biodegradability",
  "pbt",
  "aquaticToxicity",
  "aquaticHazardStatements",
  "yukaRating",
  "inciBeautyRating",
  "beeslineRating",
] as const;

export type SafetyField = (typeof SAFETY_FIELDS)[number];
export type SafetyData = Partial<Record<SafetyField, unknown>>;

// Only null/undefined and blank text count as empty. Everything an Admin can deliberately
// choose counts as filled — including "Not Available" on a tristate and false on a Yes/No,
// both of which are answers from a dossier rather than an absence of one. A 0 rating isn't
// reachable through the form (ratings are 1-5) but is treated as filled for the same
// reason: someone put it there.
function isBlank(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.trim() === "";
  return false;
}

/**
 * True when none of the 16 safety/regulatory fields has been filled in — the record is
 * little more than a name.
 *
 * One filled field is enough to clear the warning: this flags records nobody has started
 * on, not records that are merely missing something. Partial completeness is normal, since
 * not every field applies to every substance.
 */
export function isIncomplete(ingredient: SafetyData): boolean {
  return SAFETY_FIELDS.every((field) => isBlank(ingredient[field]));
}

// Which of the 16 are filled, for anywhere that wants to say how far along a record is.
export function filledSafetyFields(ingredient: SafetyData): SafetyField[] {
  return SAFETY_FIELDS.filter((field) => !isBlank(ingredient[field]));
}

export const INCOMPLETE_NOTE = "Safety and regulatory data has not been filled in yet.";

// A soft nudge, not an error: amber rather than red, and nothing about it blocks saving or
// using the ingredient.
export const INCOMPLETE_ROW_CLASS = "bg-warning/10";
