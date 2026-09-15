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
