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
 * How a supplier's outstanding documents are doing against the SLA.
 *
 * The clock starts when the request reaches Supply Chain — its approval — not when Samer
 * gets round to logging anything. An SLA that only starts once the person it measures
 * chooses to start it cannot be missed, which makes it not an SLA.
 *
 * It stops for a supplier the moment that supplier's documents are attached. `now` is
 * injectable so the thresholds can be tested without waiting a week.
 */
export function supplierDocumentSlaLevel(
  receivedAt: Date | null,
  completedAt: Date | null = null,
  now: Date = new Date()
): SlaLevel {
  if (!receivedAt) return "NONE";
  // Documents in hand: judged on how long it took, not on how long ago that was.
  const end = completedAt ?? now;
  const elapsed = workingDaysBetween(receivedAt, end);
  if (elapsed >= SUPPLIER_DOCUMENT_SLA_DAYS) return "OVERDUE";
  if (elapsed >= SUPPLIER_DOCUMENT_WARNING_DAYS) return "WARNING";
  return "NONE";
}

// Working days a supplier's documents have been outstanding, or took to arrive.
export function documentWorkingDaysElapsed(
  receivedAt: Date | null,
  completedAt: Date | null = null,
  now: Date = new Date()
): number {
  if (!receivedAt) return 0;
  return workingDaysBetween(receivedAt, completedAt ?? now);
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

export function slaLabel(
  level: SlaLevel,
  elapsedWorkingDays: number,
  done = false
): string | null {
  const days = `${elapsedWorkingDays} working day${elapsedWorkingDays === 1 ? "" : "s"}`;
  if (done) return `${days} to collect`;
  if (level === "OVERDUE") return `${days} — overdue`;
  if (level === "WARNING") return days;
  return null;
}

// The CSS review SLA turns amber a day before it turns red, same shape as the document
// one: day 2 of 3 still leaves a working day to act.
export const CSS_REVIEW_WARNING_DAYS = 2;

/**
 * How a supplier's outstanding CSS review is doing, in working days since Supply Chain
 * handed it over. Stops when a decision is recorded — and, like the document SLA, then
 * keeps reporting how long it took rather than how long ago that was.
 */
export function cssReviewSlaLevel(
  submittedAt: Date | null,
  decidedAt: Date | null = null,
  now: Date = new Date()
): SlaLevel {
  if (!submittedAt) return "NONE";
  const elapsed = workingDaysBetween(submittedAt, decidedAt ?? now);
  if (elapsed >= CSS_REVIEW_SLA_DAYS) return "OVERDUE";
  if (elapsed >= CSS_REVIEW_WARNING_DAYS) return "WARNING";
  return "NONE";
}

export function cssReviewWorkingDaysElapsed(
  submittedAt: Date | null,
  decidedAt: Date | null = null,
  now: Date = new Date()
): number {
  if (!submittedAt) return 0;
  return workingDaysBetween(submittedAt, decidedAt ?? now);
}
