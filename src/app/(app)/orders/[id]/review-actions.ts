"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/dal";
import { prisma } from "@/lib/prisma";
import { checkReviewAllowed, orderSupplierNames, REVIEW_TARGET } from "@/lib/orders";
import type { OrderStatus } from "@/lib/types";

// Phase 1 — Admin review. Approve moves a request on to Supply Chain; Reject ends it.

export type ReviewState = { error?: string; ok?: string } | undefined;

async function decide(
  orderId: string,
  decision: "APPROVE" | "REJECT",
  rejectionReason: string | null
): Promise<ReviewState> {
  const session = await requireAdmin();

  const order = await prisma.sampleOrder.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      status: true,
      requestType: true,
      supplierName: true,
      supplier1: true,
      supplier2: true,
      supplier3: true,
      _count: { select: { suppliers: true } },
    },
  });
  if (!order) return { error: "That request no longer exists." };

  // Re-checked against the stored status rather than trusted from the page, which may
  // have been open since before someone else decided it. This is what makes rejection
  // terminal in fact and not just in the UI.
  const allowed = checkReviewAllowed(order.status as OrderStatus);
  if (!allowed.ok) return { error: allowed.reason };

  // Approval is where the supplier options stop being three text boxes on a form and
  // become things Supply Chain works on one at a time: documents chased, prices quoted,
  // a CSS decision recorded. Created here rather than at submission because a rejected
  // request should leave no supplier rows behind.
  const supplierRows =
    decision === "APPROVE" && order._count.suppliers === 0 ? orderSupplierNames(order) : [];

  try {
    await prisma.$transaction(async (tx) => {
      if (supplierRows.length > 0) {
        await tx.sampleOrderSupplier.createMany({
          data: supplierRows.map((s) => ({ orderId, ...s })),
        });
      }

      await tx.sampleOrder.update({
        where: { id: orderId },
        data: {
          status: REVIEW_TARGET[decision],
          approvedById: session.user.id,
          decidedAt: new Date(),
          // Cleared on approval so a reason left over from a previous draft can't linger
          // on a request that wasn't rejected.
          rejectionReason: decision === "REJECT" ? rejectionReason : null,
        },
      });
    });
  } catch (error) {
    console.error("sample order review failed", error);
    return { error: "Could not record that decision. Try again." };
  }

  revalidatePath("/orders");
  revalidatePath(`/orders/${orderId}`);
  revalidatePath("/dashboard");
  revalidatePath("/supply-chain");

  return {
    ok:
      decision === "APPROVE"
        ? "Approved. This request is now with Supply Chain."
        : "Rejected. No further action can be taken on this request.",
  };
}

export async function approveOrder(_prev: ReviewState, formData: FormData): Promise<ReviewState> {
  return decide(String(formData.get("orderId") ?? ""), "APPROVE", null);
}

export async function rejectOrder(_prev: ReviewState, formData: FormData): Promise<ReviewState> {
  const reason = String(formData.get("rejectionReason") ?? "").trim();
  // Required: a rejection the requester can't understand is one they'll just raise again.
  if (!reason) {
    return { error: "Give a reason for rejecting this request." };
  }
  return decide(String(formData.get("orderId") ?? ""), "REJECT", reason);
}
