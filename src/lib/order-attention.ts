import "server-only";

import { prisma } from "@/lib/prisma";
import { checkCostingApprovalReady, checkSelectionReady, orderLabel } from "@/lib/orders";

/**
 * Requests waiting on a decision from one particular person.
 *
 * Both of the requester's signatures — choosing a supplier, then approving what it costs.
 * One place, because three screens say this now (the dashboard, the orders list and the
 * bell) and three copies of the query would eventually disagree about which requests
 * qualify. The rules themselves are the same check functions the panels gate on, so the
 * prompt can't offer a decision the page then refuses.
 */
export type AwaitingDecision = {
  orderId: string;
  label: string;
  needs: "SUPPLIER" | "COSTING";
};

export async function awaitingDecisionFor(userId: string): Promise<AwaitingDecision[]> {
  const orders = await prisma.sampleOrder.findMany({
    where: {
      orderedById: userId,
      status: { in: ["CSS_APPROVED_PENDING_FORMULATOR", "COSTING_SUBMITTED_PENDING_FORMULATOR"] },
    },
    select: {
      id: true,
      status: true,
      inciName: true,
      existingSample: { select: { sampleCode: true, rmName: true } },
      suppliers: {
        select: { cssDecision: true, isSelected: true, cost: true, shippingCost: true },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return orders.flatMap<AwaitingDecision>((order) => {
    const label = orderLabel(order);
    if (checkSelectionReady(order, order.suppliers).ok) {
      return [{ orderId: order.id, label, needs: "SUPPLIER" }];
    }
    if (checkCostingApprovalReady(order, order.suppliers).ok) {
      return [{ orderId: order.id, label, needs: "COSTING" }];
    }
    return [];
  });
}
