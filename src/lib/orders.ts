import type { OrderStatus } from "@/lib/types";

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

// ---------------------------------------------------------------------------
// Phase 1 — Admin review
// ---------------------------------------------------------------------------


// Rejection ends a request. Nothing further may be done to one — not approving it, not
// editing it, not rejecting it again. Kept as a predicate rather than a scattered
// `status === "REJECTED"` so every guard agrees about what terminal means.
export function isTerminal(status: OrderStatus): boolean {
  return status === "REJECTED";
}

// Admin review acts on a request that is still waiting for it, and only then. An order
// already with Supply Chain is past this stage, not available to it.
export function isAwaitingAdminReview(status: OrderStatus): boolean {
  return status === "SUBMITTED";
}

// Editing is part of reviewing, so it stops when review does. Once approved the request
// has been handed on, and changing it underneath whoever picked it up would be worse than
// making them ask for a new one.
export function canEditOrder(status: OrderStatus): boolean {
  return isAwaitingAdminReview(status);
}

export type ReviewDecision = "APPROVE" | "REJECT";

export const REVIEW_TARGET: Record<ReviewDecision, OrderStatus> = {
  APPROVE: "APPROVED_PENDING_SUPPLY_CHAIN",
  REJECT: "REJECTED",
};

/**
 * Whether a review decision may be applied to an order in this state, and if not, why.
 *
 * Takes no decision argument on purpose: approve and reject are allowed under exactly the
 * same condition — the request is still awaiting review — and a parameter here would imply
 * they differ.
 *
 * Returns the reason rather than a bare false so the refusal can be shown to whoever
 * tried: "this was already rejected" is useful, "no" is not.
 */
export function checkReviewAllowed(
  status: OrderStatus
): { ok: true } | { ok: false; reason: string } {
  if (isTerminal(status)) {
    return { ok: false, reason: "This request was rejected. Nothing further can be done to it." };
  }
  if (!isAwaitingAdminReview(status)) {
    return {
      ok: false,
      reason: "This request has already been reviewed and moved on to Supply Chain.",
    };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Phase 2 — Supply Chain document requests
// ---------------------------------------------------------------------------

export function isAwaitingSupplyChain(status: OrderStatus): boolean {
  return status === "APPROVED_PENDING_SUPPLY_CHAIN";
}

/**
 * Whether a supplier on this request needs documents chased at all.
 *
 * A repeat order from the same source already has everything on file, so the step is
 * skipped outright rather than opened and immediately closed — an SLA clock started for a
 * document nobody is waiting on would be noise that trains people to ignore the real ones.
 */
export function needsDocumentRequest(type: OrderRequestType): boolean {
  return type !== "EXISTING_SAME_SOURCE";
}

/**
 * The supplier options on a request, in position order.
 *
 * A new material carries up to three; the two existing-sample types carry the single named
 * supplier. Blank boxes are dropped, so positions reflect what was actually given.
 */
export function orderSupplierNames(order: {
  requestType: string;
  supplierName?: string | null;
  supplier1?: string | null;
  supplier2?: string | null;
  supplier3?: string | null;
}): Array<{ position: number; supplierName: string }> {
  const raw = usesThreeSuppliers(order.requestType as OrderRequestType)
    ? [order.supplier1, order.supplier2, order.supplier3]
    : [order.supplierName];

  return raw
    .map((name) => (name ?? "").trim())
    .filter(Boolean)
    .map((supplierName, i) => ({ position: i + 1, supplierName }));
}

// Limits on supplier paperwork. Here rather than in the action because a "use server"
// module may only export async functions, and the form needs these to describe itself.
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
export const MAX_DOCUMENTS_PER_UPLOAD = 10;
// One upload has to fit inside serverActions.bodySizeLimit in next.config.ts, which is
// 25 MB. Checked here too so an oversized batch gets a sentence explaining itself rather
// than the framework's opaque rejection.
export const MAX_UPLOAD_TOTAL_BYTES = 20 * 1024 * 1024;

// A COA or SDS is a PDF, sometimes a scan or an office document. Anything else is very
// likely a mistake, and refusing it on the way in is kinder than storing it and finding
// out later.
export const ALLOWED_DOCUMENT_TYPES: ReadonlySet<string> = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);

// ---------------------------------------------------------------------------
// Phase 3 — documents attached and priced, per supplier
// ---------------------------------------------------------------------------

/**
 * Where one supplier option has got to.
 *
 * Derived from the row rather than stored: a supplier is "pending CSS review" exactly
 * when its documents and its pricing are both in, and a stored status could disagree with
 * the very fields it claims to summarise.
 */
export const SUPPLIER_STAGES = [
  "AWAITING_DOCUMENTS",
  "AWAITING_PRICING",
  "READY_TO_SUBMIT",
  "PENDING_CSS",
  "CSS_APPROVED",
  "CSS_REJECTED",
] as const;

export type SupplierStage = (typeof SUPPLIER_STAGES)[number];

export const SUPPLIER_STAGE_LABELS: Record<SupplierStage, string> = {
  AWAITING_DOCUMENTS: "Awaiting documents",
  AWAITING_PRICING: "Awaiting price & MOQ",
  READY_TO_SUBMIT: "Ready to send to CSS",
  PENDING_CSS: "Documents attached – pending CSS review",
  CSS_APPROVED: "CSS approved",
  CSS_REJECTED: "CSS rejected",
};

export function supplierStage(supplier: {
  documentCount: number;
  landedPrice: unknown;
  moq: string | null;
  cssDecision: string;
  submittedToCssAt?: Date | null;
  // False for a repeat order from the same source, whose paperwork is already on file.
  // Without this such a supplier would sit at "awaiting documents" forever, waiting for
  // something nobody is going to send.
  needsDocuments?: boolean;
}): SupplierStage {
  if (supplier.cssDecision === "APPROVED") return "CSS_APPROVED";
  if (supplier.cssDecision === "REJECTED") return "CSS_REJECTED";
  // Submitted is the point of no return, so it is checked before the field-completeness
  // rules below — a submitted supplier stays submitted.
  if (supplier.submittedToCssAt) return "PENDING_CSS";
  if ((supplier.needsDocuments ?? true) && supplier.documentCount === 0) {
    return "AWAITING_DOCUMENTS";
  }
  // Both are needed before CSS has anything to review: a quote without an MOQ can't be
  // compared against one that has it.
  if (supplier.landedPrice == null || !(supplier.moq ?? "").trim()) return "AWAITING_PRICING";
  return "READY_TO_SUBMIT";
}

// Supply Chain may change a supplier's documents and pricing right up to submitting it,
// and not afterwards: once CSS has it, changing the quote underneath them would make
// their decision about something that no longer exists.
export function canEditSupplierSubmission(supplier: {
  submittedToCssAt?: Date | null;
}): boolean {
  return !supplier.submittedToCssAt;
}

export function canSubmitSupplierToCss(
  supplier: Parameters<typeof supplierStage>[0]
): boolean {
  return supplierStage(supplier) === "READY_TO_SUBMIT";
}

// Ready to hand to CSS: every supplier that is going to be considered has its documents
// and its price in.
export function readyForCssReview(
  suppliers: Array<Parameters<typeof supplierStage>[0]>
): boolean {
  return suppliers.length > 0 && suppliers.every((s) => supplierStage(s) === "PENDING_CSS");
}

// ---------------------------------------------------------------------------
// Phase 4 — CSS review
// ---------------------------------------------------------------------------

export const CSS_DECISIONS = ["PENDING", "APPROVED", "REJECTED"] as const;
export type CssDecisionValue = (typeof CSS_DECISIONS)[number];

// On CSS's desk: handed over by Supply Chain and not yet decided.
export function isAwaitingCssReview(supplier: {
  submittedToCssAt?: Date | null;
  cssDecision: string;
}): boolean {
  return Boolean(supplier.submittedToCssAt) && supplier.cssDecision === "PENDING";
}

// A decision is made once. Reversing one would change what a later step was based on.
export function canRecordCssDecision(supplier: {
  submittedToCssAt?: Date | null;
  cssDecision: string;
}): boolean {
  return isAwaitingCssReview(supplier);
}

/**
 * Whether every option on an order has been eliminated.
 *
 * A rejected supplier does not go back to Supply Chain — it is simply out. But an order
 * whose every option is out has nowhere left to go, so it is rejected outright rather
 * than sitting in a queue waiting for an option that will never come.
 */
export function orderIsExhausted(suppliers: Array<{ cssDecision: string }>): boolean {
  return suppliers.length > 0 && suppliers.every((s) => s.cssDecision === "REJECTED");
}

// What is still live on an order: anything CSS hasn't eliminated.
export function survivingSuppliers<T extends { cssDecision: string }>(suppliers: T[]): T[] {
  return suppliers.filter((s) => s.cssDecision !== "REJECTED");
}

/**
 * A supplier's stage, with `needsDocuments` derived from the request it belongs to.
 *
 * Prefer this over calling supplierStage() directly. The two screens that show a stage
 * used to assemble its input by hand, and one of them forgot `needsDocuments` — so a
 * repeat order read "awaiting documents" on the very page that said its documents were
 * already on file and offered no way to attach any. Taking the order closes that gap.
 */
export function supplierStageForOrder(
  order: { requestType: string },
  supplier: Omit<Parameters<typeof supplierStage>[0], "needsDocuments">
): SupplierStage {
  return supplierStage({
    ...supplier,
    needsDocuments: needsDocumentRequest(order.requestType as OrderRequestType),
  });
}
