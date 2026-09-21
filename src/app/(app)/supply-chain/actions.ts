"use server";

import { revalidatePath } from "next/cache";
import { verifySession } from "@/lib/dal";
import { prisma } from "@/lib/prisma";
import { isAwaitingSupplyChain, needsDocumentRequest, type OrderRequestType } from "@/lib/orders";
import { supplierDocumentDueDate } from "@/lib/working-days";
import type { OrderStatus } from "@/lib/types";

// Phase 2 — Supply Chain logs that documents have been asked for, which starts the
// 7-working-day SLA clock on that supplier.

export type DocumentRequestState = { error?: string; ok?: string } | undefined;

// Supply Chain owns this step; an Admin can do it too, since they run the queue when
// Supply Chain is away.
async function requireSupplyChain() {
  const session = await verifySession();
  const role = session.user.role;
  if (role !== "SUPPLY_CHAIN" && role !== "ADMIN") {
    return null;
  }
  return session;
}

export async function requestSupplierDocuments(
  _prev: DocumentRequestState,
  formData: FormData
): Promise<DocumentRequestState> {
  const session = await requireSupplyChain();
  if (!session) return { error: "Only Supply Chain can record a document request." };

  const orderSupplierId = String(formData.get("orderSupplierId") ?? "");
  if (!orderSupplierId) return { error: "Which supplier?" };

  const row = await prisma.sampleOrderSupplier.findUnique({
    where: { id: orderSupplierId },
    include: { order: { select: { id: true, status: true, requestType: true } } },
  });
  if (!row) return { error: "That supplier is no longer on the request." };

  // Re-checked against the stored state rather than trusted from the page.
  if (!isAwaitingSupplyChain(row.order.status as OrderStatus)) {
    return { error: "This request isn't with Supply Chain." };
  }
  if (!needsDocumentRequest(row.order.requestType as OrderRequestType)) {
    return {
      error: "This is a repeat order from the same source — its documents are already on file.",
    };
  }
  // Re-requesting would move a deadline already agreed with a supplier.
  if (row.documentsRequestedAt) {
    return { error: `Documents were already requested from ${row.supplierName}.` };
  }

  const requestedAt = new Date();

  try {
    await prisma.sampleOrderSupplier.update({
      where: { id: orderSupplierId },
      data: {
        documentsRequestedAt: requestedAt,
        // Stored, not derived on read: a deadline given to a supplier shouldn't move if
        // the working-day rule is ever changed.
        documentsDueAt: supplierDocumentDueDate(requestedAt),
      },
    });
  } catch (error) {
    console.error("requestSupplierDocuments failed", error);
    return { error: "Could not record that request. Try again." };
  }

  revalidatePath("/supply-chain");
  revalidatePath(`/orders/${row.order.id}`);

  return { ok: `Documents requested from ${row.supplierName}.` };
}
