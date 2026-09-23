"use server";

import { revalidatePath } from "next/cache";
import { verifySession } from "@/lib/dal";
import { prisma } from "@/lib/prisma";
import { canSelectSupplier, checkDeclineReady, checkSelectionReady } from "@/lib/orders";

// Phase 5 — the Formulator chooses between the options CSS approved, and may correct the
// quantity while doing so. Choosing is what moves the request off Supply Chain's desk.

export type SelectionState = { error?: string; ok?: string } | undefined;

export async function selectSupplier(
  _prev: SelectionState,
  formData: FormData
): Promise<SelectionState> {
  const session = await verifySession();

  const orderId = String(formData.get("orderId") ?? "");
  const orderSupplierId = String(formData.get("orderSupplierId") ?? "");
  const rawQuantity = String(formData.get("requiredQuantityG") ?? "").trim();

  if (!orderId || !orderSupplierId) return { error: "Which supplier?" };

  const order = await prisma.sampleOrder.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      status: true,
      orderedById: true,
      suppliers: { select: { id: true, supplierName: true, cssDecision: true } },
    },
  });
  if (!order) return { error: "That request no longer exists." };

  if (!canSelectSupplier(order, { id: session.user.id, role: session.user.role })) {
    return { error: "Only the person who raised this request can choose its supplier." };
  }

  // Re-checked against the stored rows rather than trusted from the page, which may have
  // been open since before CSS finished — or since someone else already chose.
  const ready = checkSelectionReady(order, order.suppliers);
  if (!ready.ok) return { error: ready.reason };

  const chosen = order.suppliers.find((s) => s.id === orderSupplierId);
  if (!chosen) return { error: "That supplier is no longer on this request." };
  if (chosen.cssDecision !== "APPROVED") {
    return { error: `${chosen.supplierName} wasn't approved, so it can't be chosen.` };
  }

  // A quantity correction is optional; an empty box leaves what was requested alone.
  let requiredQuantityG: string | undefined;
  if (rawQuantity) {
    const quantity = Number(rawQuantity);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      return { error: "The required quantity must be a number greater than zero." };
    }
    requiredQuantityG = String(quantity);
  }

  try {
    await prisma.$transaction(async (tx) => {
      // Cleared first so the chosen one is the only one flagged, even if an earlier
      // selection somehow left a flag behind.
      await tx.sampleOrderSupplier.updateMany({
        where: { orderId },
        data: { isSelected: false },
      });
      await tx.sampleOrderSupplier.update({
        where: { id: orderSupplierId },
        data: { isSelected: true },
      });
      await tx.sampleOrder.update({
        where: { id: orderId },
        data: {
          status: "SUPPLIER_SELECTED",
          ...(requiredQuantityG ? { requiredQuantityG } : {}),
        },
      });
    });
  } catch (error) {
    console.error("selectSupplier failed", error);
    return { error: "Could not record that choice. Try again." };
  }

  revalidatePath(`/orders/${orderId}`);
  revalidatePath("/orders");
  revalidatePath("/supply-chain");
  revalidatePath("/css-review");

  return { ok: `${chosen.supplierName} chosen. This request is ready for costing.` };
}

/**
 * Declining every remaining option, which ends the request.
 *
 * The other half of the same decision as choosing: CSS approving a supplier's documents
 * says the paperwork is in order, not that the terms are worth accepting. An MOQ far above
 * what was asked for is a good reason to walk away, and only the person who raised the
 * request can judge that.
 */
export async function declineAllSuppliers(
  _prev: SelectionState,
  formData: FormData
): Promise<SelectionState> {
  const session = await verifySession();

  const orderId = String(formData.get("orderId") ?? "");
  const reason = String(formData.get("declineReason") ?? "").trim();
  if (!orderId) return { error: "Which request?" };

  // Required: Supply Chain sourced these options, and "no" without a reason is an
  // instruction to source the same ones again.
  if (!reason) return { error: "Say why none of these options work." };

  const order = await prisma.sampleOrder.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      status: true,
      orderedById: true,
      suppliers: { select: { cssDecision: true } },
    },
  });
  if (!order) return { error: "That request no longer exists." };

  if (!canSelectSupplier(order, { id: session.user.id, role: session.user.role })) {
    return { error: "Only the person who raised this request can decline it." };
  }

  const ready = checkDeclineReady(order, order.suppliers);
  if (!ready.ok) return { error: ready.reason };

  try {
    await prisma.sampleOrder.update({
      where: { id: orderId },
      data: {
        status: "REJECTED",
        decidedAt: new Date(),
        rejectionReason: `Declined by the requester: ${reason}`,
      },
    });
  } catch (error) {
    console.error("declineAllSuppliers failed", error);
    return { error: "Could not record that. Try again." };
  }

  revalidatePath(`/orders/${orderId}`);
  revalidatePath("/orders");
  revalidatePath("/supply-chain");
  revalidatePath("/css-review");

  return { ok: "Request declined. None of the approved options will be ordered." };
}
