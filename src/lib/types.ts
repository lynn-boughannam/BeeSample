// SQL Server has no native enum type, so these are plain strings at the DB layer
// (see prisma/schema.prisma). These unions are the single source of truth for
// valid values in application code.

export const ROLES = ["ADMIN", "FORMULATOR", "DIRECTOR"] as const;
export type Role = (typeof ROLES)[number];

export const REQUEST_STATUSES = ["PENDING", "APPROVED", "DENIED", "RETURNED"] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

export const ORDER_STATUSES = ["PENDING", "APPROVED", "DENIED", "RECEIVED"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const TRANSACTION_TYPES = [
  "RECEIPT",
  "CHECKOUT",
  "RETURN_USAGE",
  "DISCARD",
  "MOVE",
] as const;
export type TransactionType = (typeof TRANSACTION_TYPES)[number];
