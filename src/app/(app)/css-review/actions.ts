"use server";

import { revalidatePath } from "next/cache";
import { verifySession } from "@/lib/dal";
import { prisma } from "@/lib/prisma";
import { canRecordCssDecision, orderIsExhausted } from "@/lib/orders";

// Phase 4 — CSS approves or rejects each supplier's documents independently. Costing is a
// later step and belongs to the Formulator (COSTING_SUBMITTED_PENDING_FORMULATOR), so what
// is judged here is the paperwork; price and MOQ are shown alongside it only as context for
// comparing the options.
//
// A rejected option is eliminated, not sent back to Supply Chain; an order with every
// option eliminated has nowhere left to go and is rejected outright.

export type CssReviewState = { error?: string; ok?: string } | undefined;

// CSS owns this step; an Admin can work it when they're away, matching how the Supply
// Chain queue is handled.
async function requireCss() {
  const session = await verifySession();
  const role = session.user.role;
  if (role !== "CSS" && role !== "ADMIN") return null;
  return session;
}

async function decide(
  orderSupplierId: string,
  decision: "APPROVED" | "REJECTED",
  note: string | null
): Promise<CssReviewState> {
  const session = await requireCss();
  if (!session) return { error: "Only CSS can record a document decision." };
  if (!orderSupplierId) return { error: "Which supplier?" };

  const row = await prisma.sampleOrderSupplier.findUnique({
    where: { id: orderSupplierId },
    include: { order: { select: { id: true, status: true } } },
  });
  if (!row) return { error: "That supplier is no longer on the request." };

  // Re-checked against the stored row rather than trusted from the page, which may have
  // been open since before someone else decided it.
  if (!canRecordCssDecision(row)) {
    return row.cssDecision === "PENDING"
      ? { error: `${row.supplierName} hasn't been sent to CSS yet.` }
      : { error: `${row.supplierName} was already ${row.cssDecision.toLowerCase()}.` };
  }

  const decidedAt = new Date();

  try {
    await prisma.$transaction(async (tx) => {
      await tx.sampleOrderSupplier.update({
        where: { id: orderSupplierId },
        data: {
          cssDecision: decision,
          cssDecisionAt: decidedAt,
          cssDecidedById: session.user.id,
          cssNote: note,
        },
      });

      // Read back inside the transaction: whether this was the last option standing has
      // to be judged against the row just written, not the one loaded before it.
      const siblings = await tx.sampleOrderSupplier.findMany({
        where: { orderId: row.order.id },
        select: { cssDecision: true },
      });

      if (orderIsExhausted(siblings)) {
        await tx.sampleOrder.update({
          where: { id: row.order.id },
          data: {
            status: "REJECTED",
            decidedAt,
            rejectionReason:
              "Every supplier option was rejected at document review, so there is nothing left to order.",
          },
        });
      }
    });
  } catch (error) {
    console.error("recordCssDecision failed", error);
    return { error: "Could not record that decision. Try again." };
  }

  revalidatePath("/css-review");
  revalidatePath("/supply-chain");
  revalidatePath(`/orders/${row.order.id}`);
  revalidatePath("/orders");

  const remaining = await prisma.sampleOrderSupplier.count({
    where: { orderId: row.order.id, cssDecision: { not: "REJECTED" } },
  });

  if (decision === "REJECTED" && remaining === 0) {
    return {
      ok: `${row.supplierName} rejected. That was the last option, so the whole request is now rejected.`,
    };
  }
  if (decision === "REJECTED") {
    return {
      ok: `${row.supplierName} rejected and removed from this request. ${remaining} option${
        remaining === 1 ? "" : "s"
      } left.`,
    };
  }
  return { ok: `${row.supplierName} approved.` };
}

export async function approveSupplierDocuments(
  _prev: CssReviewState,
  formData: FormData
): Promise<CssReviewState> {
  const note = String(formData.get("cssNote") ?? "").trim();
  return decide(String(formData.get("orderSupplierId") ?? ""), "APPROVED", note || null);
}

export async function rejectSupplierDocuments(
  _prev: CssReviewState,
  formData: FormData
): Promise<CssReviewState> {
  const note = String(formData.get("cssNote") ?? "").trim();
  // Required: an elimination nobody can explain is one Supply Chain will re-source
  // identically next time.
  if (!note) return { error: "Give a reason for rejecting this supplier." };
  return decide(String(formData.get("orderSupplierId") ?? ""), "REJECTED", note);
}
