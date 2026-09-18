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
  "APPROVED_PENDING_SUPPLY_CHAIN",
  "SUPPLIER_SELECTED",
  "COSTING_SUBMITTED_PENDING_FORMULATOR",
  "FORMULATOR_APPROVED_PENDING_PR",
  "PR_ISSUED_AWAITING_RECEIPT",
  "RECEIVED",
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  SUBMITTED: "Submitted",
  REJECTED: "Rejected",
  APPROVED_PENDING_SUPPLY_CHAIN: "Approved — pending Supply Chain",
  SUPPLIER_SELECTED: "Supplier selected",
  COSTING_SUBMITTED_PENDING_FORMULATOR: "Costing submitted — pending Formulator approval",
  FORMULATOR_APPROVED_PENDING_PR: "Formulator approved — pending PR",
  PR_ISSUED_AWAITING_RECEIPT: "PR issued — awaiting receipt",
  RECEIVED: "Received",
};

// Rejection is a dead end rather than a step, so progress is measured along the rest.
export const ORDER_STATUS_SEQUENCE: readonly OrderStatus[] = ORDER_STATUSES.filter(
  (s) => s !== "REJECTED"
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
