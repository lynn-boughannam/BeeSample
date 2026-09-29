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
import type { Role } from "@/lib/types";

// The bell in the top bar lists only things that are past a deadline the app already
// enforces — the 14-day checkout limit and the two supplier SLAs. Each rule is the same
// function the owning screen uses to paint its row red, so the bell can't disagree with
// the page it links to. Sample requests and feedback have no due date, so nothing of
// theirs can be "overdue" and none appear here.

export type NotificationKind = "CHECKOUT" | "DOCUMENTS" | "CSS_REVIEW";

export type OverdueNotification = {
  id: string;
  kind: NotificationKind;
  title: string;
  detail: string;
  overdueBy: string;
  href: string;
  // For ordering: the most overdue first, across kinds.
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

export async function loadOverdueNotifications(
  userId: string,
  role: Role,
  now: Date = new Date()
): Promise<OverdueNotification[]> {
  const groups = await Promise.all([
    overdueCheckouts(userId, role, now),
    overdueDocuments(role, now),
    overdueCssReviews(role, now),
  ]);
  return groups.flat().sort((a, b) => b.daysLate - a.daysLate);
}
