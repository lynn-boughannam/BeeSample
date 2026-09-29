import "server-only";
import { prisma } from "@/lib/prisma";
import { needsDocumentRequest, orderLabel, type OrderRequestType } from "@/lib/orders";
import { CHECKOUT_OVERDUE_DAYS, daysSinceCheckout, getCheckoutWarningLevel } from "@/lib/stock";
import {
  cssReviewSlaLevel,
  cssReviewWorkingDaysElapsed,
  documentWorkingDaysElapsed,
  supplierDocumentSlaLevel,
} from "@/lib/working-days";
import { awaitingDecisionFor } from "@/lib/order-attention";
import { cancellationsFor } from "@/lib/order-cancellations";
import type { Role } from "@/lib/types";

// The bell in the top bar lists what is waiting on the person looking: work past a deadline
// the app already enforces (the 14-day checkout limit and the two supplier SLAs), decisions
// only they can make, and requests they were working that have since been withdrawn.
//
// Every rule is the same function the owning screen uses, so the bell can't disagree with
// the page it links to. Sample requests and feedback have no due date and no decision
// attached, so none appear here.

export type NotificationKind =
  | "CHECKOUT"
  | "DOCUMENTS"
  | "CSS_REVIEW"
  | "DECISION"
  | "CANCELLED";

export type OverdueNotification = {
  id: string;
  kind: NotificationKind;
  title: string;
  detail: string;
  // The short label on the right of the row. Days late for the three SLA kinds; for the
  // other two it says what the row is instead, since neither is late for anything.
  overdueBy: string;
  href: string;
  // Sort weight, highest first — days late where something is late, and recency where it
  // isn't, so the newest cancellation leads its group rather than trailing it.
  daysLate: number;
};

const WORK_UP_STATUSES = ["APPROVED_PENDING_SUPPLY_CHAIN", "DETAILS_SUBMITTED_AWAITING_CSS"];

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

async function overdueCheckouts(userId: string, role: Role, now: Date) {
  if (role !== "ADMIN" && role !== "FORMULATOR") return [];
  // Admins watch every piece that's out; a Formulator only hears about their own.
  const cutoff = new Date(now.getTime() - CHECKOUT_OVERDUE_DAYS * 24 * 60 * 60 * 1000);
  const pieces = await prisma.samplePiece.findMany({
    where: {
      status: "CHECKED_OUT",
      checkedOutAt: { lte: cutoff },
      ...(role === "FORMULATOR" ? { checkedOutToUserId: userId } : {}),
    },
    select: {
      id: true,
      pieceIndex: true,
      checkedOutAt: true,
      sample: { select: { sampleCode: true, rmName: true } },
      checkedOutToUser: { select: { name: true } },
    },
  });

  return pieces
    .filter((p) => getCheckoutWarningLevel(p.checkedOutAt, now) === "OVERDUE")
    .map<OverdueNotification>((p) => {
      const days = daysSinceCheckout(p.checkedOutAt, now);
      const holder = role === "ADMIN" ? ` · ${p.checkedOutToUser?.name ?? "Unassigned"}` : "";
      return {
        id: `checkout-${p.id}`,
        kind: "CHECKOUT",
        title: `${p.sample.sampleCode} · ${p.sample.rmName}`,
        detail: `Piece #${p.pieceIndex}${holder}`,
        overdueBy: `${plural(days, "day")} out`,
        href: role === "ADMIN" ? "/checked-out" : "/my-checkouts",
        daysLate: days - CHECKOUT_OVERDUE_DAYS,
      };
    });
}

async function overdueDocuments(role: Role, now: Date) {
  if (role !== "ADMIN" && role !== "SUPPLY_CHAIN") return [];
  const orders = await prisma.sampleOrder.findMany({
    where: { status: "APPROVED_PENDING_SUPPLY_CHAIN", decidedAt: { not: null } },
    select: {
      id: true,
      requestType: true,
      inciName: true,
      decidedAt: true,
      existingSample: { select: { sampleCode: true, rmName: true } },
      suppliers: {
        where: { documentsReceivedAt: null },
        select: { id: true, supplierName: true, documentsReceivedAt: true },
      },
    },
  });

  return orders
    .filter((o) => needsDocumentRequest(o.requestType as OrderRequestType))
    .flatMap((o) =>
      o.suppliers
        .filter((s) => supplierDocumentSlaLevel(o.decidedAt, s.documentsReceivedAt, now) === "OVERDUE")
        .map<OverdueNotification>((s) => {
          const elapsed = documentWorkingDaysElapsed(o.decidedAt, s.documentsReceivedAt, now);
          return {
            id: `docs-${s.id}`,
            kind: "DOCUMENTS",
            title: orderLabel(o),
            detail: `Documents from ${s.supplierName}`,
            overdueBy: plural(elapsed, "working day"),
            href: "/supply-chain",
            daysLate: elapsed,
          };
        })
    );
}

async function overdueCssReviews(role: Role, now: Date) {
  if (role !== "ADMIN" && role !== "CSS") return [];
  const orders = await prisma.sampleOrder.findMany({
    where: {
      status: { in: WORK_UP_STATUSES },
      suppliers: { some: { submittedToCssAt: { not: null }, cssDecision: "PENDING" } },
    },
    select: {
      id: true,
      inciName: true,
      existingSample: { select: { sampleCode: true, rmName: true } },
      suppliers: {
        where: { submittedToCssAt: { not: null }, cssDecision: "PENDING" },
        select: { id: true, supplierName: true, submittedToCssAt: true },
      },
    },
  });

  return orders.flatMap((o) =>
    o.suppliers
      .filter((s) => cssReviewSlaLevel(s.submittedToCssAt, null, now) === "OVERDUE")
      .map<OverdueNotification>((s) => {
        const elapsed = cssReviewWorkingDaysElapsed(s.submittedToCssAt, null, now);
        return {
          id: `css-${s.id}`,
          kind: "CSS_REVIEW",
          title: orderLabel(o),
          detail: `CSS review of ${s.supplierName}`,
          overdueBy: plural(elapsed, "working day"),
          href: "/css-review",
          daysLate: elapsed,
        };
      })
  );
}

// Decisions that are this person's to make: choosing a supplier, then approving what it
// costs. Not late — there is no clock on them — but they sit until someone acts, and the
// bell is where someone looks to find out what is theirs.
async function decisionsWaiting(userId: string) {
  const waiting = await awaitingDecisionFor(userId);
  return waiting.map<OverdueNotification>((item) => ({
    id: `decision-${item.orderId}`,
    kind: "DECISION",
    title: item.label,
    detail:
      item.needs === "SUPPLIER"
        ? "Choose a supplier, or decline them all"
        : "Approve what the chosen supplier will cost",
    overdueBy: "waiting on you",
    href: `/orders/${item.orderId}`,
    // Above the SLA rows: this is the one kind nobody else can clear.
    daysLate: Number.MAX_SAFE_INTEGER,
  }));
}

// Requests withdrawn by whoever raised them, shown to the people who were working them —
// otherwise the first they know is a queue quietly getting shorter.
async function cancellations(userId: string, role: Role, now: Date) {
  const notices = await cancellationsFor(userId, role);
  return notices.map<OverdueNotification>((notice) => {
    const daysAgo = Math.floor(
      (now.getTime() - notice.cancelledAt.getTime()) / (24 * 60 * 60 * 1000)
    );
    return {
      id: `cancelled-${notice.orderId}`,
      kind: "CANCELLED",
      title: notice.label,
      detail: notice.reason
        ? `${notice.cancelledBy} — “${notice.reason}”`
        : `Withdrawn by ${notice.cancelledBy}`,
      overdueBy: daysAgo === 0 ? "today" : `${plural(daysAgo, "day")} ago`,
      href: `/orders/${notice.orderId}`,
      // Negated so the most recent leads the group: nothing here is late, and the newest
      // withdrawal is the one most likely to still be acted on.
      daysLate: -daysAgo,
    };
  });
}

export async function loadOverdueNotifications(
  userId: string,
  role: Role,
  now: Date = new Date()
): Promise<OverdueNotification[]> {
  const groups = await Promise.all([
    decisionsWaiting(userId),
    overdueCheckouts(userId, role, now),
    overdueDocuments(role, now),
    overdueCssReviews(role, now),
    cancellations(userId, role, now),
  ]);
  return groups.flat().sort((a, b) => b.daysLate - a.daysLate);
}
