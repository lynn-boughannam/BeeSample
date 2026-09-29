import "server-only";

import { prisma } from "@/lib/prisma";
import {
  CANCELLATION_NOTICE_DAYS,
  cancellationRecipients,
  orderLabel,
} from "@/lib/orders";

/**
 * Cancellations the person looking needs to hear about.
 *
 * Derived rather than delivered, like everything else that tells someone about work in this
 * app: there is no message table and no read-state, so a recipient list is computed from the
 * request itself and recent cancellations age out after CANCELLATION_NOTICE_DAYS.
 *
 * That is a real limitation, not a design flourish — someone who doesn't open the app for a
 * fortnight will never see it. It is the same standard as the overdue bell, and the right
 * fix for both is stored notifications, which is a separate piece of work.
 */
export type CancellationNotice = {
  orderId: string;
  label: string;
  cancelledBy: string;
  cancelledAt: Date;
  reason: string | null;
  // Why this person is being told: they signed something, or they coordinate procurement.
  because: "APPROVED" | "ADMIN";
};

export async function cancellationsFor(
  viewerId: string,
  role: string
): Promise<CancellationNotice[]> {
  const since = new Date(Date.now() - CANCELLATION_NOTICE_DAYS * 24 * 60 * 60 * 1000);

  const cancelled = await prisma.sampleOrder.findMany({
    where: { status: "CANCELLED", decidedAt: { gte: since } },
    select: {
      id: true,
      inciName: true,
      decidedAt: true,
      rejectionReason: true,
      orderedById: true,
      approvedById: true,
      orderedBy: { select: { name: true } },
      existingSample: { select: { sampleCode: true, rmName: true } },
      suppliers: { select: { cssDecision: true, cssDecidedById: true } },
    },
    orderBy: { decidedAt: "desc" },
  });
  if (cancelled.length === 0) return [];

  // Admins are told about every cancellation because procurement coordination is theirs;
  // everyone else hears only about requests they personally approved.
  const adminIds =
    role === "ADMIN"
      ? [viewerId]
      : [];

  return cancelled
    .filter((order) => cancellationRecipients(order, adminIds).includes(viewerId))
    .map<CancellationNotice>((order) => {
      // An Admin who also approved it is told as an approver: that is the more specific
      // reason, and the one that explains why this particular request is their business.
      const approvedIt =
        order.approvedById === viewerId ||
        order.suppliers.some(
          (s) => s.cssDecision === "APPROVED" && s.cssDecidedById === viewerId
        );
      return {
        orderId: order.id,
        label: orderLabel(order),
        cancelledBy: order.orderedBy.name,
        cancelledAt: order.decidedAt!,
        reason: order.rejectionReason,
        because: approvedIt ? "APPROVED" : "ADMIN",
      };
    });
}
