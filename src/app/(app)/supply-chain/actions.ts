"use server";

import { revalidatePath } from "next/cache";
import { verifySession } from "@/lib/dal";
import { prisma } from "@/lib/prisma";
import {
  ALLOWED_DOCUMENT_TYPES,
  MAX_DOCUMENTS_PER_UPLOAD,
  MAX_DOCUMENT_BYTES,
  isAwaitingSupplyChain,
  needsDocumentRequest,
  type OrderRequestType,
} from "@/lib/orders";
import type { OrderStatus } from "@/lib/types";

// Phase 2 — Supply Chain attaches the documents that came back from a supplier. Attaching
// is what closes that supplier's step; the SLA it is measured against started when the
// request was approved, not when anything was logged here.

export type DocumentUploadState = { error?: string; ok?: string } | undefined;

// Supply Chain owns this step; an Admin can do it too, since they run the queue when
// Supply Chain is away.
async function requireSupplyChain() {
  const session = await verifySession();
  const role = session.user.role;
  if (role !== "SUPPLY_CHAIN" && role !== "ADMIN") return null;
  return session;
}

export async function attachSupplierDocuments(
  _prev: DocumentUploadState,
  formData: FormData
): Promise<DocumentUploadState> {
  const session = await requireSupplyChain();
  if (!session) return { error: "Only Supply Chain can attach supplier documents." };

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

  // Several documents per supplier is the normal case, not the exception: a COA and an SDS
  // usually arrive together.
  const files = formData
    .getAll("documents")
    .filter((f): f is File => f instanceof File && f.size > 0);

  if (files.length === 0) return { error: "Choose at least one file to attach." };
  if (files.length > MAX_DOCUMENTS_PER_UPLOAD) {
    return { error: `Attach at most ${MAX_DOCUMENTS_PER_UPLOAD} files at a time.` };
  }

  for (const file of files) {
    if (file.size > MAX_DOCUMENT_BYTES) {
      return { error: `${file.name} is larger than 10 MB.` };
    }
    if (file.type && !ALLOWED_DOCUMENT_TYPES.has(file.type)) {
      return { error: `${file.name} isn't a document type we accept (PDF, image, Word or Excel).` };
    }
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

      // Stamped on the first attachment, which is what stops this supplier's SLA clock.
      // Later attachments don't move it — the documents were in hand from the first one.
      if (!row.documentsReceivedAt) {
        await tx.sampleOrderSupplier.update({
          where: { id: orderSupplierId },
          data: { documentsReceivedAt: new Date() },
        });
      }
    });
  } catch (error) {
    console.error("attachSupplierDocuments failed", error);
    return { error: "Could not attach those documents. Try again." };
  }

  revalidatePath("/supply-chain");
  revalidatePath(`/orders/${row.order.id}`);

  const n = payloads.length;
  return { ok: `Attached ${n} document${n === 1 ? "" : "s"} for ${row.supplierName}.` };
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
