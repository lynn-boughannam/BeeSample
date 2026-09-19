"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/dal";
import { prisma } from "@/lib/prisma";
import { checkReviewAllowed, REVIEW_TARGET } from "@/lib/orders";
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
    select: { id: true, status: true },
  });
  if (!order) return { error: "That request no longer exists." };

  // Re-checked against the stored status rather than trusted from the page, which may
  // have been open since before someone else decided it. This is what makes rejection
  // terminal in fact and not just in the UI.
  const allowed = checkReviewAllowed(order.status as OrderStatus);
  if (!allowed.ok) return { error: allowed.reason };

  try {
    await prisma.sampleOrder.update({
      where: { id: orderId },
      data: {
        status: REVIEW_TARGET[decision],
        approvedById: session.user.id,
        decidedAt: new Date(),
        // Cleared on approval so a reason left over from a previous draft can't linger on
        // a request that wasn't rejected.
        rejectionReason: decision === "REJECT" ? rejectionReason : null,
      },
    });
  } catch (error) {
    console.error("sample order review failed", error);
    return { error: "Could not record that decision. Try again." };
  }

  revalidatePath("/orders");
  revalidatePath(`/orders/${orderId}`);
  revalidatePath("/dashboard");

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
