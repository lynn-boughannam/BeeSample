"use server";

import { revalidatePath } from "next/cache";
import { verifySession } from "@/lib/dal";
import { prisma } from "@/lib/prisma";
import {
  canApproveCosting,
  checkCostingApprovalReady,
  checkCostingRejectionReady,
  orderStatusAfterCostingApproval,
  orderStatusAfterCostingRejection,
} from "@/lib/orders";

// Phase 7 — the Formulator approves what the chosen supplier will cost, and the request is
// ready for a PR to be raised against it.
//
// The Director attestation is asked for again here, as it was on submission. It is not a
// formality repeated for its own sake: the figures approved now are not the ones that
// existed when the request was raised, and this is the point at which money is committed
// against them.

export type CostingApprovalState = { error?: string; ok?: string } | undefined;

export async function approveCosting(
  _prev: CostingApprovalState,
  formData: FormData
): Promise<CostingApprovalState> {
  const session = await verifySession();

  const orderId = String(formData.get("orderId") ?? "");
  if (!orderId) return { error: "Which request?" };

  const order = await prisma.sampleOrder.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      status: true,
      orderedById: true,
      suppliers: {
        select: { id: true, supplierName: true, isSelected: true, cost: true, shippingCost: true },
      },
    },
  });
  if (!order) return { error: "That request no longer exists." };

  // Signing belongs to whoever raised it, exactly as choosing did — no Admin stand-in.
  if (!canApproveCosting(order, { id: session.user.id })) {
    return { error: "Only the person who submitted this request can approve its costing." };
  }

  // The attestation is the act, so the server requires it rather than trusting the dialog
  // to have been shown. A page with its JavaScript broken must not be able to approve.
  if (formData.get("directorApprovalConfirmed") !== "on") {
    return { error: "Confirm the Director has approved this before the costing is approved." };
  }

  // Re-checked against the stored rows: the page may have been open since before Supply
  // Chain submitted, or since someone already approved.
  const ready = checkCostingApprovalReady(order, order.suppliers);
  if (!ready.ok) return { error: ready.reason };

  try {
    await prisma.sampleOrder.update({
      where: { id: orderId },
      data: { status: orderStatusAfterCostingApproval() },
    });
  } catch (error) {
    console.error("approveCosting failed", error);
    return { error: "Could not record that approval. Try again." };
  }

  revalidatePath(`/orders/${orderId}`);
  revalidatePath("/orders");
  revalidatePath("/supply-chain");
  revalidatePath("/dashboard");

  const chosen = order.suppliers.find((s) => s.isSelected);
  return {
    ok: `Costing approved${chosen ? ` for ${chosen.supplierName}` : ""}. The request is ready for a PR.`,
  };
}

// Sending a costing back. "This price doesn't work" is a request for different numbers, not
// the end of the request — so it returns to Supply Chain rather than to Rejected. A
// Formulator who wants it over cancels it instead, which is a different act with a different
// name and its own confirmation.
//
// No attestation here, unlike approving: rejecting commits nothing and costs nobody money.
export async function rejectCosting(
  _prev: CostingApprovalState,
  formData: FormData
): Promise<CostingApprovalState> {
  const session = await verifySession();

  const orderId = String(formData.get("orderId") ?? "");
  if (!orderId) return { error: "Which request?" };

  // Required. Supply Chain has to redo this, and "too dear" and "you priced the wrong
  // quantity" call for completely different work.
  const reason = String(formData.get("costingRejectionReason") ?? "").trim();
  if (!reason) return { error: "Say what is wrong with the costing." };

  const order = await prisma.sampleOrder.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      status: true,
      orderedById: true,
      suppliers: {
        select: { id: true, supplierName: true, isSelected: true, cost: true, shippingCost: true },
      },
    },
  });
  if (!order) return { error: "That request no longer exists." };

  if (!canApproveCosting(order, { id: session.user.id })) {
    return { error: "Only the person who submitted this request can reject its costing." };
  }

  const ready = checkCostingRejectionReady(order, order.suppliers);
  if (!ready.ok) return { error: ready.reason };

  try {
    await prisma.sampleOrder.update({
      where: { id: orderId },
      data: {
        status: orderStatusAfterCostingRejection(),
        costingRejectionReason: reason,
        costingRejectedAt: new Date(),
      },
    });
  } catch (error) {
    console.error("rejectCosting failed", error);
    return { error: "Could not record that. Try again." };
  }

  revalidatePath(`/orders/${orderId}`);
  revalidatePath("/orders");
  revalidatePath("/supply-chain");
  revalidatePath("/dashboard");

  return { ok: "Costing sent back to Supply Chain with your reason." };
}
