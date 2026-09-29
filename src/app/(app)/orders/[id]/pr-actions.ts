"use server";

import { revalidatePath } from "next/cache";
import { verifySession } from "@/lib/dal";
import { prisma } from "@/lib/prisma";
import {
  MAX_PR_NUMBER_LENGTH,
  canIssuePr,
  checkPrReady,
  normalisePrNumber,
  orderStatusAfterPrIssued,
} from "@/lib/orders";

// Phase 8 — the PR itself is raised in the purchasing system. What happens here is that its
// reference is recorded against the request, which is what ties the two together when the
// material arrives and somebody has to match it to what was ordered.

export type PrState = { error?: string; ok?: string } | undefined;

export async function issuePurchaseRequisition(
  _prev: PrState,
  formData: FormData
): Promise<PrState> {
  const session = await verifySession();
  if (!canIssuePr(session.user.role)) {
    return { error: "Only an Admin can record a PR against a request." };
  }

  const orderId = String(formData.get("orderId") ?? "");
  if (!orderId) return { error: "Which request?" };

  const prNumber = normalisePrNumber(String(formData.get("prNumber") ?? ""));
  if (!prNumber) {
    return {
      error: `Enter the PR reference, up to ${MAX_PR_NUMBER_LENGTH} characters.`,
    };
  }

  const order = await prisma.sampleOrder.findUnique({
    where: { id: orderId },
    select: { id: true, status: true, prNumber: true },
  });
  if (!order) return { error: "That request no longer exists." };

  // Re-checked against the stored row: the page may have been open since before someone
  // else recorded one.
  const ready = checkPrReady(order);
  if (!ready.ok) return { error: ready.reason };

  try {
    await prisma.sampleOrder.update({
      where: { id: orderId },
      data: { prNumber, status: orderStatusAfterPrIssued() },
    });
  } catch (error) {
    console.error("issuePurchaseRequisition failed", error);
    return { error: "Could not record that PR. Try again." };
  }

  revalidatePath(`/orders/${orderId}`);
  revalidatePath("/orders");
  revalidatePath("/dashboard");

  return { ok: `PR ${prNumber} recorded. The request is now awaiting receipt.` };
}
