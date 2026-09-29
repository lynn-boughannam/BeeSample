"use server";

import { revalidatePath } from "next/cache";
import { verifySession } from "@/lib/dal";
import { prisma } from "@/lib/prisma";
import {
  ALLOWED_DOCUMENT_TYPES,
  canEditSupplierSubmission,
  canSubmitSupplierToCss,
  checkCostingReady,
  orderStatusAfterCosting,
  orderStatusAfterCssSubmission,
  MAX_DOCUMENTS_PER_UPLOAD,
  MAX_DOCUMENT_BYTES,
  MAX_UPLOAD_TOTAL_BYTES,
  isAwaitingSupplyChain,
  needsDocumentRequest,
  type OrderRequestType,
} from "@/lib/orders";
import type { OrderStatus } from "@/lib/types";

// Phases 2 and 3 — Supply Chain records what came back from a supplier: its documents and
// the terms it quoted. Attaching is what closes that supplier's step; the SLA it is measured
// against started when the request was approved, not when anything was logged here.

export type DocumentUploadState = { error?: string; ok?: string } | undefined;

// Supply Chain owns this step; an Admin can do it too, since they run the queue when
// Supply Chain is away.
async function requireSupplyChain() {
  const session = await verifySession();
  const role = session.user.role;
  if (role !== "SUPPLY_CHAIN" && role !== "ADMIN") return null;
  return session;
}

// Whatever a supplier sent back, recorded in one go. Two forms meant two saves to log one
// email, and a row that was half-entered in between; this takes the files, the terms, or
// both, and complains only about what it was actually given.
export async function saveSupplierSubmission(
  _prev: DocumentUploadState,
  formData: FormData
): Promise<DocumentUploadState> {
  const session = await requireSupplyChain();
  if (!session) return { error: "Only Supply Chain can record a supplier's reply." };

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
  if (!canEditSupplierSubmission(row)) {
    return { error: `${row.supplierName} has been sent to CSS and can no longer be changed.` };
  }

  // Several documents per supplier is the normal case, not the exception: a COA and an SDS
  // usually arrive together.
  const files = formData
    .getAll("documents")
    .filter((f): f is File => f instanceof File && f.size > 0);

  const wantsDocuments = needsDocumentRequest(row.order.requestType as OrderRequestType);
  if (files.length > 0 && !wantsDocuments) {
    return {
      error: "This is a repeat order from the same source — its documents are already on file.",
    };
  }
  if (files.length > MAX_DOCUMENTS_PER_UPLOAD) {
    return { error: `Attach at most ${MAX_DOCUMENTS_PER_UPLOAD} files at a time.` };
  }
  if (files.reduce((sum, f) => sum + f.size, 0) > MAX_UPLOAD_TOTAL_BYTES) {
    return { error: "That's more than 20 MB at once. Attach them in smaller batches." };
  }
  for (const file of files) {
    if (file.size > MAX_DOCUMENT_BYTES) {
      return { error: `${file.name} is larger than 10 MB.` };
    }
    if (file.type && !ALLOWED_DOCUMENT_TYPES.has(file.type)) {
      return { error: `${file.name} isn't a document type we accept (PDF, image, Word or Excel).` };
    }
  }

  // Landed price and MOQ are what CSS weighs one option against another with, so they move
  // as a pair: both or neither. Neither is allowed on purpose — paperwork usually turns up
  // before the quote does, and it shouldn't have to wait for it.
  const rawPrice = String(formData.get("landedPrice") ?? "").trim();
  const moq = String(formData.get("moq") ?? "").trim();
  let price: string | null = null;
  if (rawPrice || moq) {
    if (!rawPrice) return { error: "Enter the landed price as well — CSS compares the two." };
    if (!moq) return { error: "Enter the MOQ as well — CSS compares the two." };
    const parsed = Number(rawPrice);
    if (!Number.isFinite(parsed) || parsed < 0) {
      return { error: "The landed price must be a number that isn't negative." };
    }
    // Held as a string so the Decimal column keeps the exact figure quoted, rather than
    // whatever a float rounds it to.
    price = parsed.toFixed(2);
  }

  if (files.length === 0 && price === null) {
    return {
      error: wantsDocuments
        ? "Nothing to save — choose a document, or fill in the price and MOQ."
        : "Nothing to save — fill in the price and MOQ.",
    };
  }

  // Read every file before opening the transaction: a slow read shouldn't hold one open.
  const payloads = await Promise.all(
    files.map(async (file) => ({
      fileName: file.name,
      contentType: file.type || null,
      sizeBytes: file.size,
      content: Buffer.from(await file.arrayBuffer()),
      uploadedById: session.user.id,
    }))
  );

  try {
    await prisma.$transaction(async (tx) => {
      for (const payload of payloads) {
        await tx.sampleOrderSupplierDocument.create({
          data: { orderSupplierId, ...payload },
        });
      }

      // documentsReceivedAt is stamped on the first attachment, which is what stops this
      // supplier's SLA clock. Later attachments don't move it — the documents were in hand
      // from the first one.
      const data: { documentsReceivedAt?: Date; landedPrice?: string; moq?: string } = {};
      if (payloads.length > 0 && !row.documentsReceivedAt) data.documentsReceivedAt = new Date();
      if (price !== null) {
        data.landedPrice = price;
        data.moq = moq;
      }
      if (Object.keys(data).length > 0) {
        await tx.sampleOrderSupplier.update({ where: { id: orderSupplierId }, data });
      }
    });
  } catch (error) {
    console.error("saveSupplierSubmission failed", error);
    return { error: "Could not save that. Try again." };
  }

  revalidatePath("/supply-chain");
  revalidatePath(`/orders/${row.order.id}`);

  const n = payloads.length;
  const parts = [
    n > 0 ? `attached ${n} document${n === 1 ? "" : "s"}` : null,
    price !== null ? "saved price and MOQ" : null,
  ].filter(Boolean);
  const said = parts.join(" and ");
  return { ok: `${said.charAt(0).toUpperCase()}${said.slice(1)} for ${row.supplierName}.` };
}

// Kept separate from attaching: telling a supplier you need their paperwork and actually
// having it are different facts, and Samer may want to record the first before the second.
export async function requestSupplierDocuments(
  _prev: DocumentUploadState,
  formData: FormData
): Promise<DocumentUploadState> {
  const session = await requireSupplyChain();
  if (!session) return { error: "Only Supply Chain can record a document request." };

  const orderSupplierId = String(formData.get("orderSupplierId") ?? "");
  if (!orderSupplierId) return { error: "Which supplier?" };

  const row = await prisma.sampleOrderSupplier.findUnique({
    where: { id: orderSupplierId },
    include: { order: { select: { id: true, status: true, requestType: true } } },
  });
  if (!row) return { error: "That supplier is no longer on the request." };
  if (!isAwaitingSupplyChain(row.order.status as OrderStatus)) {
    return { error: "This request isn't with Supply Chain." };
  }
  if (!needsDocumentRequest(row.order.requestType as OrderRequestType)) {
    return { error: "This is a repeat order from the same source." };
  }
  if (row.documentsRequestedAt) {
    return { error: `Already recorded as requested from ${row.supplierName}.` };
  }

  try {
    await prisma.sampleOrderSupplier.update({
      where: { id: orderSupplierId },
      data: { documentsRequestedAt: new Date() },
    });
  } catch (error) {
    console.error("requestSupplierDocuments failed", error);
    return { error: "Could not record that. Try again." };
  }

  revalidatePath("/supply-chain");
  revalidatePath(`/orders/${row.order.id}`);
  return { ok: `Recorded as requested from ${row.supplierName}.` };
}

export async function deleteSupplierDocument(
  _prev: DocumentUploadState,
  formData: FormData
): Promise<DocumentUploadState> {
  const session = await requireSupplyChain();
  if (!session) return { error: "Only Supply Chain can remove a document." };

  const documentId = String(formData.get("documentId") ?? "");
  const doc = await prisma.sampleOrderSupplierDocument.findUnique({
    where: { id: documentId },
    include: { orderSupplier: { include: { order: { select: { id: true, status: true } } } } },
  });
  if (!doc) return { error: "That document is already gone." };
  if (!isAwaitingSupplyChain(doc.orderSupplier.order.status as OrderStatus)) {
    return { error: "This request has moved on — its documents can no longer be changed." };
  }
  if (!canEditSupplierSubmission(doc.orderSupplier)) {
    return { error: "That supplier has been sent to CSS and can no longer be changed." };
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.sampleOrderSupplierDocument.delete({ where: { id: documentId } });
      // Removing the last document reopens the step, and with it the SLA clock: the
      // paperwork is not in hand after all.
      const left = await tx.sampleOrderSupplierDocument.count({
        where: { orderSupplierId: doc.orderSupplierId },
      });
      if (left === 0) {
        await tx.sampleOrderSupplier.update({
          where: { id: doc.orderSupplierId },
          data: { documentsReceivedAt: null },
        });
      }
    });
  } catch (error) {
    console.error("deleteSupplierDocument failed", error);
    return { error: "Could not remove that document. Try again." };
  }

  revalidatePath("/supply-chain");
  revalidatePath(`/orders/${doc.orderSupplier.order.id}`);
  return { ok: `Removed ${doc.fileName}.` };
}

// Handing one supplier to CSS. An explicit step rather than something implied by the
// fields being filled: Samer gets to check a price before committing to it, and this is
// the point after which he can't.
export async function submitSupplierToCss(
  _prev: DocumentUploadState,
  formData: FormData
): Promise<DocumentUploadState> {
  const session = await requireSupplyChain();
  if (!session) return { error: "Only Supply Chain can send a supplier to CSS." };

  const orderSupplierId = String(formData.get("orderSupplierId") ?? "");
  const row = await prisma.sampleOrderSupplier.findUnique({
    where: { id: orderSupplierId },
    include: {
      order: { select: { id: true, status: true, requestType: true } },
      _count: { select: { documents: true } },
    },
  });
  if (!row) return { error: "That supplier is no longer on the request." };
  if (!isAwaitingSupplyChain(row.order.status as OrderStatus)) {
    return { error: "This request isn't with Supply Chain." };
  }
  if (!canEditSupplierSubmission(row)) {
    return { error: `${row.supplierName} has already been sent to CSS.` };
  }

  // Re-checked against the row rather than trusted from the page, which could be stale.
  // Takes the order, so a repeat order isn't held up waiting for paperwork it already has.
  const ready = canSubmitSupplierToCss(row.order, {
    documentCount: row._count.documents,
    landedPrice: row.landedPrice,
    moq: row.moq,
    cssDecision: row.cssDecision,
    submittedToCssAt: row.submittedToCssAt,
  });
  if (!ready) {
    const missing = needsDocumentRequest(row.order.requestType as OrderRequestType)
      ? "its documents, landed price and MOQ"
      : "its landed price and MOQ";
    return { error: `${row.supplierName} still needs ${missing} before CSS can review it.` };
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.sampleOrderSupplier.update({
        where: { id: orderSupplierId },
        data: { submittedToCssAt: new Date() },
      });

      // Read back inside the transaction: whether this was the last option to hand over has
      // to be judged against the row just written, not the one loaded before it.
      const siblings = await tx.sampleOrderSupplier.findMany({
        where: { orderId: row.order.id },
        select: { submittedToCssAt: true },
      });

      // With every option handed over, Supply Chain's step is done and the wait is CSS's.
      const next = orderStatusAfterCssSubmission(siblings);
      if (next) {
        await tx.sampleOrder.update({ where: { id: row.order.id }, data: { status: next } });
      }
    });
  } catch (error) {
    console.error("submitSupplierToCss failed", error);
    return { error: "Could not send that to CSS. Try again." };
  }

  revalidatePath("/supply-chain");
  revalidatePath(`/orders/${row.order.id}`);
  return { ok: `${row.supplierName} sent to CSS. Its documents and pricing are now locked.` };
}

// Phase 6 — costing the supplier the Formulator chose. Cost and shipping are entered for
// that one option only: working them out for options nobody is going to order is work
// thrown away, which is why this comes after selection rather than before it.
//
// Saving and submitting are one act here, unlike the earlier per-supplier step. There is a
// single row to fill in and nothing to compare it against, so a separate submit would be a
// second click for no decision.
export async function submitSupplierCosting(
  _prev: DocumentUploadState,
  formData: FormData
): Promise<DocumentUploadState> {
  const session = await requireSupplyChain();
  if (!session) return { error: "Only Supply Chain can enter costing." };

  const orderSupplierId = String(formData.get("orderSupplierId") ?? "");
  if (!orderSupplierId) return { error: "Which supplier?" };

  const row = await prisma.sampleOrderSupplier.findUnique({
    where: { id: orderSupplierId },
    include: { order: { select: { id: true, status: true } } },
  });
  if (!row) return { error: "That supplier is no longer on the request." };

  // Re-checked against the stored row: the page shows one supplier, but only the row knows
  // whether it is still the chosen one.
  const ready = checkCostingReady(row.order, row);
  if (!ready.ok) return { error: ready.reason };

  const amounts: Record<string, string> = {};
  for (const [field, label] of [
    ["cost", "cost"],
    ["shippingCost", "shipping cost"],
  ] as const) {
    const raw = String(formData.get(field) ?? "").trim();
    if (!raw) return { error: `Enter the ${label}.` };
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed < 0) {
      return { error: `The ${label} must be a number that isn't negative.` };
    }
    // Held as a string so the Decimal column keeps the exact figure, not what a float
    // rounds it to.
    amounts[field] = parsed.toFixed(2);
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.sampleOrderSupplier.update({
        where: { id: orderSupplierId },
        data: { cost: amounts.cost, shippingCost: amounts.shippingCost },
      });
      await tx.sampleOrder.update({
        where: { id: row.order.id },
        data: { status: orderStatusAfterCosting() },
      });
    });
  } catch (error) {
    console.error("submitSupplierCosting failed", error);
    return { error: "Could not save that costing. Try again." };
  }

  revalidatePath("/supply-chain");
  revalidatePath(`/orders/${row.order.id}`);
  revalidatePath("/orders");
  revalidatePath("/dashboard");

  return {
    ok: `Costing submitted for ${row.supplierName}. The request is now with the Formulator.`,
  };
}
