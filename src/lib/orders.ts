// Sample order requests (SLT-58). Pure values and rules, no database access, so the
// request form can import them directly.

export const ORDER_REQUEST_TYPES = [
  "NEW",
  "EXISTING_NEW_SOURCE",
  "EXISTING_SAME_SOURCE",
] as const;

export type OrderRequestType = (typeof ORDER_REQUEST_TYPES)[number];

export const ORDER_REQUEST_TYPE_LABELS: Record<OrderRequestType, string> = {
  NEW: "New sample",
  EXISTING_NEW_SOURCE: "Existing sample, new source",
  EXISTING_SAME_SOURCE: "Existing sample, same source",
};

export const ORDER_REQUEST_TYPE_HINTS: Record<OrderRequestType, string> = {
  NEW: "A raw material we have never ordered before. Nothing is pre-filled, and you'll be asked for three supplier options.",
  EXISTING_NEW_SOURCE:
    "A material already in the library, from a different or new supplier. Its details are pre-filled; the supplier is not.",
  EXISTING_SAME_SOURCE:
    "A repeat order of a material already in the library, from the same supplier. Details and supplier are both pre-filled.",
};

// The two "existing sample" types pick from the live Sample Library rather than a separate
// catalogue, so what's offered can't drift out of step with what's actually held.
export function needsExistingSample(type: OrderRequestType): boolean {
  return type === "EXISTING_NEW_SOURCE" || type === "EXISTING_SAME_SOURCE";
}

// Only a repeat order from the same source knows the supplier up front.
export function prefillsSupplier(type: OrderRequestType): boolean {
  return type === "EXISTING_SAME_SOURCE";
}

// A brand-new material is the only case asked for three supplier options, and so the only
// case the short-list nudge applies to.
export function usesThreeSuppliers(type: OrderRequestType): boolean {
  return type === "NEW";
}

/**
 * ============================ PLACEHOLDER VALUES ============================
 * The three lists below are DUMMY DATA, approved at the 2026-09-15 sprint review purely so
 * this story wasn't blocked. They are NOT real business values and must be replaced with
 * the actual lists before this story can be called Done.
 *
 * They are deliberately kept here, together and labelled, rather than seeded into the
 * managed reference tables — a placeholder sitting in the database alongside real data is
 * how a placeholder gets forgotten.
 * ===========================================================================
 */
export const PLACEHOLDER_APPLICATIONS = [
  "Skincare",
  "Haircare",
  "Makeup",
  "Fragrance",
  "Body Care",
  "Oral Care",
] as const;

export const PLACEHOLDER_PRODUCT_FORMATS = [
  "Cream",
  "Serum",
  "Gel",
  "Lotion",
  "Spray",
  "Stick",
  "Powder",
  "Oil",
] as const;

export const PLACEHOLDER_REQUIRED_DOCUMENTS = [
  "COA (Certificate of Analysis)",
  "SDS (Safety Data Sheet)",
  "Specification Sheet",
  "Certificate of Origin",
  "None",
] as const;

// Surfaced in the UI so the placeholder status is visible to whoever reviews this story,
// not just to whoever reads this file.
export const PLACEHOLDER_NOTE =
  "Application, Product Format and Required Documents use placeholder options pending the real lists.";

export const DIRECTOR_ATTESTATION =
  "By submitting this request, you confirm the Director has approved this request.";

export const SHORT_SUPPLIER_LIST_PROMPT =
  "You have not provided 3 supplier options. Proceed anyway?";

// How many of the three supplier boxes carry a value. Blank-only entries don't count, so
// spaces can't be used to dodge the nudge.
export function filledSupplierCount(suppliers: Array<string | null | undefined>): number {
  return suppliers.filter((s) => (s ?? "").trim() !== "").length;
}

export function needsShortSupplierListConfirmation(
  type: OrderRequestType,
  suppliers: Array<string | null | undefined>
): boolean {
  return usesThreeSuppliers(type) && filledSupplierCount(suppliers) < 3;
}

// What a submitted request is called in a list: its own INCI name, or the sample it was
// raised against.
export function orderLabel(order: {
  inciName?: string | null;
  existingSample?: { sampleCode: string; rmName: string } | null;
}): string {
  if (order.existingSample) {
    return `${order.existingSample.sampleCode} · ${order.existingSample.rmName}`;
  }
  return order.inciName?.trim() || "New raw material";
}
