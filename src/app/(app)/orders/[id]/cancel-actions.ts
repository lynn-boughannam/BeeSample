"use server";

import { revalidatePath } from "next/cache";
import { verifySession } from "@/lib/dal";
import { prisma } from "@/lib/prisma";
import {
  canCancelOrder,
  checkCancelReady,
  orderStatusAfterCancellation,
} from "@/lib/orders";

// Withdrawing a request. The requester decides the material is no longer needed — different
// from an Admin rejecting it, which is a decision about the request rather than a change of
// need, and which carries that Admin's name.
//
// Whoever was working it has to hear about it. That is derived rather than delivered: see
// cancellationRecipients and the banner on the orders list.

export type CancelState = { error?: string; ok?: string } | undefined;

export async function cancelOrder(
  _prev: CancelState,
  formData: FormData
): Promise<CancelState> {
  const session = await verifySession();

  const orderId = String(formData.get("orderId") ?? "");
  if (!orderId) return { error: "Which request?" };

  // Required. A request that disappears with no explanation leaves Samer chasing documents
  // for a material nobody is buying, and no way to know whether to re-raise it.
  const reason = String(formData.get("cancellationReason") ?? "").trim();
  if (!reason) return { error: "Say why this request is being cancelled." };

  const order = await prisma.sampleOrder.findUnique({
    where: { id: orderId },
    select: { id: true, status: true, orderedById: true },
  });
  if (!order) return { error: "That request no longer exists." };

  if (!canCancelOrder(order, { id: session.user.id })) {
    return { error: "Only the person who submitted this request can cancel it." };
  }

  // Re-checked against the stored row rather than trusted from the page, which may have
  // been open since before the request was received or ended some other way.
  const ready = checkCancelReady(order);
  if (!ready.ok) return { error: ready.reason };

  try {
    await prisma.sampleOrder.update({
      where: { id: orderId },
      data: {
        status: orderStatusAfterCancellation(),
        // decidedAt is when the request ended, whichever way it ended, and rejectionReason
        // is why. The column name predates cancellation and reads narrowly for it — worth
        // renaming to endedAt/endReason next time the schema is touched.
        decidedAt: new Date(),
        rejectionReason: reason,
      },
    });
  } catch (error) {
    console.error("cancelOrder failed", error);
    return { error: "Could not cancel that request. Try again." };
  }

  revalidatePath(`/orders/${orderId}`);
  revalidatePath("/orders");
  revalidatePath("/supply-chain");
  revalidatePath("/css-review");
  revalidatePath("/dashboard");

  return { ok: "Request cancelled. Anyone working on it has been told." };
}
