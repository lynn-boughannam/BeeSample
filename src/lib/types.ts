// SQL Server has no native enum type, so these are plain strings at the DB layer
// (see prisma/schema.prisma). These unions are the single source of truth for
// valid values in application code.

export const ROLES = [
  "ADMIN",
  "FORMULATOR",
  "DIRECTOR",
  // Added for the sample order workflow: Supply Chain runs the supplier/document stage,
  // CSS reviews costing.
  "SUPPLY_CHAIN",
  "CSS",
] as const;
export type Role = (typeof ROLES)[number];

export const REQUEST_STATUSES = ["PENDING", "APPROVED", "DENIED", "RETURNED"] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

// The sample order workflow, in the order it actually runs. Declared as a sequence
// because the UI reads position from it — a status list in arbitrary order would make
// "where is this request up to" impossible to answer without a second lookup table.
export const ORDER_STATUSES = [
  "SUBMITTED",
  "REJECTED",
  // Withdrawn by whoever raised it, which is not the same as being turned down. Both end a
  // request, but "we decided against this" and "we no longer need it" are different facts,
  // and a report that couldn't tell them apart would blame the reviewer for both.
  "CANCELLED",
  "APPROVED_PENDING_SUPPLY_CHAIN",
  // Every option is with CSS and Supply Chain has nothing left to enter. Reached only when
  // ALL of them have been submitted: one supplier under review while another still needs a
  // price means Supply Chain's step isn't finished, whatever the first supplier's row says.
  "DETAILS_SUBMITTED_AWAITING_CSS",
  // CSS has cleared the documents and the request is back with whoever raised it, to pick
  // one option and correct the quantity. Nothing has been costed yet — landed price and MOQ
  // are what CSS compared, and they are not the cost.
  "CSS_APPROVED_PENDING_FORMULATOR",
  "SUPPLIER_SELECTED",
  // Costing comes AFTER selection: Supply Chain works out cost and shipping for the one
  // supplier that was chosen, not for options that were never going to be ordered. I had
  // these the other way round on 2026-09-28, which put the costing status where the wait on
  // the Formulator's choice belonged; the phase 0 brief had the order right all along
  // (corrected 2026-09-29).
  "COSTING_SUBMITTED_PENDING_FORMULATOR",
  // Back, and this time something writes it. Removed on 2026-09-28 as a second name for
  // SUPPLIER_SELECTED, which it was while costing sat before selection — with costing after,
  // approving it is a distinct act by a different person and needs its own state.
  "FORMULATOR_APPROVED_PENDING_PR",
  "PR_ISSUED_AWAITING_RECEIPT",
  "RECEIVED",
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  SUBMITTED: "Submitted",
  REJECTED: "Rejected",
  CANCELLED: "Cancelled by requester",
  APPROVED_PENDING_SUPPLY_CHAIN: "Approved — awaiting documents & details from Supply Chain",
  DETAILS_SUBMITTED_AWAITING_CSS: "Details submitted — awaiting CSS approval on documents",
  CSS_APPROVED_PENDING_FORMULATOR: "CSS approved — awaiting Submitter/Formulator",
  SUPPLIER_SELECTED: "Supplier chosen — pending Supply Chain details",
  COSTING_SUBMITTED_PENDING_FORMULATOR: "Costing submitted — pending Formulator approval",
  FORMULATOR_APPROVED_PENDING_PR: "Formulator approved — pending PR",
  PR_ISSUED_AWAITING_RECEIPT: "PR issued — awaiting receipt",
  RECEIVED: "Received",
};

// Rejection and cancellation are dead ends rather than steps, so progress is measured along
// the rest.
export const ORDER_STATUS_SEQUENCE: readonly OrderStatus[] = ORDER_STATUSES.filter(
  (s) => s !== "REJECTED" && s !== "CANCELLED"
);

// Per-supplier CSS review outcome. Separate from the order status because three suppliers
// on one request are reviewed independently.
export const CSS_DECISIONS = ["PENDING", "APPROVED", "REJECTED"] as const;
export type CssDecision = (typeof CSS_DECISIONS)[number];

export const TRANSACTION_TYPES = [
  "RECEIPT",
  "CHECKOUT",
  "RETURN_USAGE",
  "DISCARD",
  "MOVE",
] as const;
export type TransactionType = (typeof TRANSACTION_TYPES)[number];
