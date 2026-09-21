// Working-day date maths, shared by every SLA in the sample order workflow: the
// 7-working-day supplier document deadline and the 2-3-working-day CSS review.
//
// Weekend confirmed 2026-09-18: Beesline works Monday to Friday, so Saturday and Sunday
// are non-working. Kept as a named set rather than inlined, since it is the one assumption
// every SLA in the workflow rests on — if it ever changes, it changes here and nowhere
// else.
//
// Public holidays are deliberately NOT handled (also confirmed 2026-09-18). A due date
// landing on a holiday is slightly optimistic, which is the acceptable failure; tracking
// them properly needs a maintained calendar, since Lebanon's religious holidays move
// year to year. Add one here if that changes.

// 0 = Sunday, 6 = Saturday, matching Date.getDay().
export const WEEKEND_DAYS: ReadonlySet<number> = new Set([0, 6]);

export function isWeekend(date: Date): boolean {
  return WEEKEND_DAYS.has(date.getDay());
}

export function isWorkingDay(date: Date): boolean {
  return !isWeekend(date);
}

// Dates are compared and advanced at local midnight: an SLA is a number of days, not a
// number of hours, so the time of day a request happened to be raised must not affect
// which calendar day it falls due.
function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

/**
 * The date `count` working days after `from`, skipping weekends.
 *
 * Counts working days *forward from* the start date rather than including it: a request
 * raised on a Monday with a 7-working-day SLA is due the following Wednesday, not Tuesday
 * of the same week. Raising it on a Saturday gives the same due date as the Monday after,
 * since nothing is worked over the weekend either way.
 *
 * `count` of 0 returns the next working day on or after `from` — useful for "due today,
 * unless today is a weekend".
 */
export function addWorkingDays(from: Date, count: number): Date {
  if (!Number.isInteger(count) || count < 0) {
    throw new RangeError(`addWorkingDays needs a non-negative whole number, got ${count}`);
  }

  let cursor = startOfDay(from);

  // A start date on a weekend is pulled forward first, so the count always begins from a
  // day someone could actually have worked.
  while (isWeekend(cursor)) cursor = addDays(cursor, 1);

  let remaining = count;
  while (remaining > 0) {
    cursor = addDays(cursor, 1);
    if (isWorkingDay(cursor)) remaining--;
  }

  return cursor;
}

/**
 * Working days between two dates, not counting the start day. Negative when `to` is before
 * `from`, so it reads naturally as "days late" once a due date has passed.
 */
export function workingDaysBetween(from: Date, to: Date): number {
  const start = startOfDay(from);
  const end = startOfDay(to);
  if (start.getTime() === end.getTime()) return 0;

  const backwards = end < start;
  let cursor = backwards ? end : start;
  const target = backwards ? start : end;

  let days = 0;
  while (cursor < target) {
    cursor = addDays(cursor, 1);
    if (isWorkingDay(cursor)) days++;
  }

  return backwards ? -days : days;
}

// The two SLAs this workflow runs on. Named here so a phase that enforces them can't
// quietly disagree with a phase that displays them.
export const SUPPLIER_DOCUMENT_SLA_DAYS = 7;
export const CSS_REVIEW_SLA_DAYS = 3;

export function supplierDocumentDueDate(requestedAt: Date): Date {
  return addWorkingDays(requestedAt, SUPPLIER_DOCUMENT_SLA_DAYS);
}

export function cssReviewDueDate(submittedAt: Date): Date {
  return addWorkingDays(submittedAt, CSS_REVIEW_SLA_DAYS);
}

// The document SLA turns amber before it turns red, so a chase can happen while there is
// still time to act. Day 5 of 7 leaves two working days.
export const SUPPLIER_DOCUMENT_WARNING_DAYS = 5;

export type SlaLevel = "NONE" | "WARNING" | "OVERDUE";

/**
 * How a supplier's outstanding document request is doing, counted in working days since it
 * was made. `now` is injectable so the thresholds can be tested without waiting a week.
 *
 * Measured from the request rather than against the stored due date on purpose: the due
 * date is a promise made to a supplier and is deliberately frozen, but the warning is about
 * how long we have actually been waiting.
 */
export function supplierDocumentSlaLevel(
  requestedAt: Date | null,
  now: Date = new Date()
): SlaLevel {
  if (!requestedAt) return "NONE";
  const elapsed = workingDaysBetween(requestedAt, now);
  if (elapsed >= SUPPLIER_DOCUMENT_SLA_DAYS) return "OVERDUE";
  if (elapsed >= SUPPLIER_DOCUMENT_WARNING_DAYS) return "WARNING";
  return "NONE";
}

// Shared presentation, so a supplier row can't read amber on one screen and red on another
// — the same rule the checkout warning follows in src/lib/stock.ts.
export const SLA_TEXT_CLASS: Record<SlaLevel, string> = {
  NONE: "text-neutral-dark/55",
  WARNING: "font-medium text-warning",
  OVERDUE: "font-semibold text-danger",
};

export const SLA_ROW_CLASS: Record<SlaLevel, string> = {
  NONE: "",
  WARNING: "border-l-4 border-l-warning bg-warning/[0.07]",
  OVERDUE: "border-l-4 border-l-danger bg-danger/[0.06]",
};

export function slaLabel(level: SlaLevel, elapsedWorkingDays: number): string | null {
  if (level === "OVERDUE") return `${elapsedWorkingDays} working days — overdue`;
  if (level === "WARNING") return `${elapsedWorkingDays} working days`;
  return null;
}
