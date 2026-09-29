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
 * Whether the per-supplier work — chasing, pricing, reviewing — is still going on.
 *
 * Two statuses cover it: Supply Chain's own step, and the wait on CSS once every option has
 * been handed over. Both are stages where the order sits still while its supplier rows move,
 * so anything reading those rows has to accept either.
 */
export function isInSupplierWorkup(status: OrderStatus): boolean {
  return status === "APPROVED_PENDING_SUPPLY_CHAIN" || status === "DETAILS_SUBMITTED_AWAITING_CSS";
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
  // False for a repeat order from the same source, whose paperwork is already on file:
  // such a supplier would otherwise sit at "awaiting documents" forever, waiting for
  // something nobody is going to send.
  //
  // REQUIRED on purpose. It was optional and defaulted to true, and three separate
  // callers forgot it — each one silently answering as though documents were needed.
  // Required, the compiler finds them. Callers with the order in hand should use
  // supplierStageForOrder() below rather than working this out themselves.
  needsDocuments: boolean;
}): SupplierStage {
  if (supplier.cssDecision === "APPROVED") return "CSS_APPROVED";
  if (supplier.cssDecision === "REJECTED") return "CSS_REJECTED";
  // Submitted is the point of no return, so it is checked before the field-completeness
  // rules below — a submitted supplier stays submitted.
  if (supplier.submittedToCssAt) return "PENDING_CSS";
  if (supplier.needsDocuments && supplier.documentCount === 0) {
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

// Takes the order for the same reason supplierStageForOrder does: whether documents are
// needed is a property of the request, not something each caller should re-derive.
export function canSubmitSupplierToCss(
  order: { requestType: string },
  supplier: Omit<Parameters<typeof supplierStage>[0], "needsDocuments">
): boolean {
  return supplierStageForOrder(order, supplier) === "READY_TO_SUBMIT";
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

// ---------------------------------------------------------------------------
// What a request is actually waiting on
// ---------------------------------------------------------------------------

/**
 * The stored order status stops at "Approved – Pending Supply Chain" while the real work
 * happens per supplier (phase 0: "per-supplier states happen inside this"). That is fine
 * as a record, but it reads as a lie once Supply Chain has finished and CSS has decided.
 *
 * This derives what the request is genuinely waiting on from its supplier rows, so a badge
 * can say so without inventing a stored transition or pre-empting supplier selection.
 *
 * Returns null when the stored status already tells the whole truth — submitted, rejected,
 * or anything past selection.
 */
export type OrderWaitingOn = {
  label: string;
  // Matches the badge vocabulary the rest of the app uses.
  tone: "neutral" | "warning" | "info" | "success";
};

export function orderWaitingOn(
  order: { status: string; requestType: string },
  suppliers: Array<Omit<Parameters<typeof supplierStage>[0], "needsDocuments">>
): OrderWaitingOn | null {
  // Only the stages that hold the per-supplier work need explaining.
  if (!isInSupplierWorkup(order.status as OrderStatus)) return null;

  if (suppliers.length === 0) {
    return { label: "No supplier options recorded", tone: "neutral" };
  }

  const stages = suppliers.map((s) => supplierStageForOrder(order, s));
  const count = (stage: SupplierStage) => stages.filter((s) => s === stage).length;
  const total = stages.length;

  const awaitingDocs = count("AWAITING_DOCUMENTS");
  const awaitingPricing = count("AWAITING_PRICING");
  const readyToSend = count("READY_TO_SUBMIT");
  const withCss = count("PENDING_CSS");
  const approved = count("CSS_APPROVED");

  // Reported in workflow order, so the badge names the earliest thing still outstanding —
  // that is what someone has to do next.
  if (awaitingDocs > 0) {
    return { label: `Awaiting documents (${awaitingDocs} of ${total})`, tone: "neutral" };
  }
  if (awaitingPricing > 0) {
    return { label: `Awaiting price & MOQ (${awaitingPricing} of ${total})`, tone: "warning" };
  }
  if (readyToSend > 0) {
    return { label: `Ready to send to CSS (${readyToSend} of ${total})`, tone: "warning" };
  }
  if (withCss > 0) {
    return { label: `With CSS (${withCss} of ${total})`, tone: "info" };
  }
  // Nothing outstanding anywhere. The stored status now says "pending Formulator approval"
  // in its own right, so there is nothing left for this to add.
  if (approved > 0) return null;
  // Every option rejected is handled by the stored status; reaching here means the rows
  // and the status disagree, which is worth saying rather than hiding.
  return { label: "No options left", tone: "neutral" };
}

// ---------------------------------------------------------------------------
// Phase 5 — supplier selection
// ---------------------------------------------------------------------------

/**
 * Whether CSS has finished with every option on a request.
 *
 * "Finished" means a decision is recorded, not merely that the option was sent. A supplier
 * still sitting with Supply Chain — no documents, never submitted — is equally undecided,
 * and choosing between options while one is still being worked on would mean choosing
 * without knowing what it would have offered.
 */
export function allSuppliersCssDecided(
  suppliers: Array<{ cssDecision: string }>
): boolean {
  return (
    suppliers.length > 0 &&
    suppliers.every((s) => s.cssDecision === "APPROVED" || s.cssDecision === "REJECTED")
  );
}

// The options a Formulator may actually choose between: CSS approved the documents.
export function selectableSuppliers<T extends { cssDecision: string }>(suppliers: T[]): T[] {
  return suppliers.filter((s) => s.cssDecision === "APPROVED");
}

/**
 * Whether a request is ready for its supplier to be chosen, and if not, why.
 *
 * The reason is returned rather than a bare false so the Formulator is told what is holding
 * it up — "one option is still with CSS" is actionable, a disabled button is not.
 */
export function checkSelectionReady(
  order: { status: string },
  suppliers: Array<{ cssDecision: string }>
): { ok: true } | { ok: false; reason: string } {
  if (order.status === "REJECTED") {
    return { ok: false, reason: "This request was rejected." };
  }
  if (isInSupplierWorkup(order.status as OrderStatus)) {
    return { ok: false, reason: "Supply Chain and CSS haven't finished with this request yet." };
  }
  if (order.status !== "CSS_APPROVED_PENDING_FORMULATOR") {
    return { ok: false, reason: "A supplier has already been chosen for this request." };
  }
  if (suppliers.length === 0) {
    return { ok: false, reason: "No supplier options were recorded on this request." };
  }
  if (!allSuppliersCssDecided(suppliers)) {
    const undecided = suppliers.filter(
      (s) => s.cssDecision !== "APPROVED" && s.cssDecision !== "REJECTED"
    ).length;
    // The noun agrees with the total, the verb with how many are outstanding: "1 of 3
    // supplier options is", "2 of 3 supplier options are", "1 of 1 supplier option is".
    const noun = suppliers.length === 1 ? "supplier option" : "supplier options";
    const verb = undecided === 1 ? "is" : "are";
    return {
      ok: false,
      reason: `${undecided} of ${suppliers.length} ${noun} ${verb} still being reviewed. You can choose once every option has been decided.`,
    };
  }
  if (selectableSuppliers(suppliers).length === 0) {
    return { ok: false, reason: "Every supplier option was rejected, so there is nothing to choose." };
  }
  return { ok: true };
}

/**
 * Whether the Formulator may decline the whole request.
 *
 * Same gate as choosing, and deliberately so: declining is the other half of the same
 * decision. CSS approving a supplier's documents says the paperwork is in order, not that
 * the terms are worth accepting — an MOQ of 25 kg against a 100 g requirement is a perfectly
 * good reason to walk away, and only the person who raised it can judge that.
 */
export function checkDeclineReady(
  order: { status: string },
  suppliers: Array<{ cssDecision: string }>
): { ok: true } | { ok: false; reason: string } {
  return checkSelectionReady(order, suppliers);
}

/**
 * Selection belongs to whoever submitted the request, and to nobody else.
 *
 * Deliberately no Admin stand-in, unlike every earlier step. The earlier ones are
 * administrative — reviewing an intake, chasing paperwork, checking costing — and someone
 * can cover for an absent colleague without changing what the request means. This one is a
 * judgement about whether the terms suit the work the material is for, and only the person
 * who asked for it holds that. Signing for someone else here would record their name
 * against a decision they did not make (confirmed 2026-09-28: the formulator who signs is
 * the formulator who submits).
 */
export function canSelectSupplier(
  order: { orderedById: string },
  user: { id: string }
): boolean {
  return order.orderedById === user.id;
}

// ---------------------------------------------------------------------------
// Phase 6 — costing the chosen supplier
// ---------------------------------------------------------------------------

/**
 * Whether the request is waiting on Supply Chain to cost the supplier that was chosen.
 *
 * Costing happens here, after selection, and only for the one option that was picked —
 * working out cost and shipping for options nobody is going to order is work thrown away.
 * Landed price and MOQ came earlier and are a different thing: they are what CSS compared
 * the options on, not what the order will cost.
 */
export function isAwaitingCosting(status: OrderStatus): boolean {
  return status === "SUPPLIER_SELECTED";
}

/**
 * Whether costing may be entered against this supplier row, and if not, why.
 *
 * The chosen flag is checked on the row rather than taken from the page: the costing screen
 * shows one supplier, but the action has to know it is still the chosen one.
 */
export function checkCostingReady(
  order: { status: string },
  supplier: { isSelected: boolean }
): { ok: true } | { ok: false; reason: string } {
  if (order.status === "REJECTED") {
    return { ok: false, reason: "This request was rejected." };
  }
  if (!isAwaitingCosting(order.status as OrderStatus)) {
    return {
      ok: false,
      reason:
        order.status === "CSS_APPROVED_PENDING_FORMULATOR"
          ? "No supplier has been chosen yet, so there is nothing to cost."
          : "This request isn't waiting on costing.",
    };
  }
  if (!supplier.isSelected) {
    return { ok: false, reason: "Only the chosen supplier is costed." };
  }
  return { ok: true };
}

/**
 * What an order's status becomes once costing has been submitted.
 *
 * Unconditional: there is exactly one supplier to cost, so submitting it finishes the step.
 */
export function orderStatusAfterCosting(): OrderStatus {
  return "COSTING_SUBMITTED_PENDING_FORMULATOR";
}

// ---------------------------------------------------------------------------
// Phase 7 — the Formulator approves the costing
// ---------------------------------------------------------------------------

/** Whether the request is waiting on the Formulator to approve what it will cost. */
export function isAwaitingCostingApproval(status: OrderStatus): boolean {
  return status === "COSTING_SUBMITTED_PENDING_FORMULATOR";
}

/**
 * Whether the costing may be approved, and if not, why.
 *
 * The figures have to actually be there. Costing is written and the status advanced in one
 * transaction, so a request at this status without them means something went wrong — better
 * said out loud than approved as if the numbers existed.
 */
export function checkCostingApprovalReady(
  order: { status: string },
  suppliers: Array<{ isSelected: boolean; cost: unknown; shippingCost: unknown }>
): { ok: true } | { ok: false; reason: string } {
  if (order.status === "REJECTED") {
    return { ok: false, reason: "This request was rejected." };
  }
  if (!isAwaitingCostingApproval(order.status as OrderStatus)) {
    return {
      ok: false,
      reason:
        order.status === "SUPPLIER_SELECTED"
          ? "Supply Chain hasn't submitted the costing yet."
          : "This request isn't waiting on costing approval.",
    };
  }
  const chosen = suppliers.find((s) => s.isSelected);
  if (!chosen) {
    return { ok: false, reason: "No supplier is marked as chosen on this request." };
  }
  if (chosen.cost == null || chosen.shippingCost == null) {
    return { ok: false, reason: "The costing is incomplete — ask Supply Chain to re-enter it." };
  }
  return { ok: true };
}

/**
 * Approving is the submitter's, exactly as choosing was.
 *
 * Same rule and the same reason: this is a judgement about whether the cost is worth paying
 * for the work the material is for, and the person who raised the request holds it. An
 * Admin signing here would put their name to a decision they did not make.
 */
export const canApproveCosting = canSelectSupplier;

/** What an order becomes once its costing is approved: waiting for the PR to be raised. */
export function orderStatusAfterCostingApproval(): OrderStatus {
  return "FORMULATOR_APPROVED_PENDING_PR";
}

// ---------------------------------------------------------------------------
// Phase 8 — raising the purchase requisition
// ---------------------------------------------------------------------------

/** Whether the request is waiting on a PR being raised against it. */
export function isAwaitingPr(status: OrderStatus): boolean {
  return status === "FORMULATOR_APPROVED_PENDING_PR";
}

/**
 * Raising the PR is administrative, so an Admin does it and a colleague can cover.
 *
 * Deliberately unlike the two decisions before it: choosing a supplier and approving its
 * cost are judgements only the requester can make, but the PR is created in the purchasing
 * system against a decision that has already been made here. Nobody is signing for anything
 * new — they are recording a reference.
 */
export function canIssuePr(role: string): boolean {
  return role === "ADMIN";
}

/**
 * Whether a PR reference may be recorded, and if not, why.
 */
export function checkPrReady(order: {
  status: string;
  prNumber?: string | null;
}): { ok: true } | { ok: false; reason: string } {
  if (order.status === "REJECTED") {
    return { ok: false, reason: "This request was rejected." };
  }
  if (!isAwaitingPr(order.status as OrderStatus)) {
    return {
      ok: false,
      reason:
        order.status === "COSTING_SUBMITTED_PENDING_FORMULATOR"
          ? "The costing hasn't been approved yet."
          : order.prNumber
            ? `A PR was already raised for this request (${order.prNumber}).`
            : "This request isn't waiting on a PR.",
    };
  }
  return { ok: true };
}

/**
 * A PR reference as it will be stored, or null if it isn't one.
 *
 * Only trimmed and length-checked. The format belongs to the purchasing system, not to this
 * one, and a rule invented here would eventually reject a real PR number — which would mean
 * the reference that matters cannot be recorded at all.
 */
export const MAX_PR_NUMBER_LENGTH = 50;

export function normalisePrNumber(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > MAX_PR_NUMBER_LENGTH) return null;
  return trimmed;
}

/** What an order becomes once its PR is raised: waiting for the material to arrive. */
export function orderStatusAfterPrIssued(): OrderStatus {
  return "PR_ISSUED_AWAITING_RECEIPT";
}

// ---------------------------------------------------------------------------
// Phase 9 — reception, and the sample it produces
// ---------------------------------------------------------------------------

/** Whether the request is waiting on the material turning up. */
export function isAwaitingReceipt(status: OrderStatus): boolean {
  return status === "PR_ISSUED_AWAITING_RECEIPT";
}

/** Receiving is the Admin's, like raising the PR: it records what happened, not a judgement. */
export function canReceiveOrder(role: string): boolean {
  return role === "ADMIN";
}

/**
 * Whether a reception may be recorded, and if not, why.
 *
 * The produced-sample check is the one that matters. Receiving twice would put two samples
 * on the shelf for one delivery, and the second would look exactly as real as the first.
 */
export function checkReceiptReady(order: {
  status: string;
  producedSampleId?: string | null;
}): { ok: true } | { ok: false; reason: string } {
  if (order.producedSampleId) {
    return { ok: false, reason: "This request has already been received." };
  }
  if (order.status === "REJECTED") {
    return { ok: false, reason: "This request was rejected." };
  }
  if (!isAwaitingReceipt(order.status as OrderStatus)) {
    return {
      ok: false,
      reason:
        order.status === "FORMULATOR_APPROVED_PENDING_PR"
          ? "No PR has been raised for this request yet."
          : "This request isn't waiting on a delivery.",
    };
  }
  return { ok: true };
}

/** What an order becomes once its material is on the shelf. */
export function orderStatusAfterReceipt(): OrderStatus {
  return "RECEIVED";
}

/**
 * What an order's status should become once a supplier has been handed to CSS. Null means it
 * stays where it is.
 *
 * It moves only when EVERY option has been submitted. Suppliers are worked independently, so
 * one sitting with CSS while another still needs its price means Supply Chain's step is not
 * finished — and an order-level status that said otherwise would send Samer's own queue the
 * wrong answer about his own work.
 */
export function orderStatusAfterCssSubmission(
  suppliers: Array<{ submittedToCssAt?: Date | null }>
): OrderStatus | null {
  if (suppliers.length === 0) return null;
  if (!suppliers.every((s) => s.submittedToCssAt)) return null;
  return "DETAILS_SUBMITTED_AWAITING_CSS";
}

/**
 * What an order's status should become once a CSS decision has been recorded against one
 * of its suppliers. Null means it stays where it is — CSS hasn't finished.
 *
 * Until this existed the status sat at "Approved — pending Supply Chain" through the whole
 * of CSS review and out the other side, so a request that was actually waiting on the
 * Formulator still claimed to be waiting on Supply Chain.
 */
export function orderStatusAfterCssDecision(
  suppliers: Array<{ cssDecision: string }>
): OrderStatus | null {
  if (!allSuppliersCssDecided(suppliers)) return null;
  // Nothing survived: there is nothing to choose between, so the request ends.
  if (selectableSuppliers(suppliers).length === 0) return "REJECTED";
  return "CSS_APPROVED_PENDING_FORMULATOR";
}
