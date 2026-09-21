"use client";

import { useActionState, useRef } from "react";
import { Button } from "@/components/ui/button";
import type { DocumentUploadState } from "./actions";

export type SupplierDocument = {
  id: string;
  fileName: string;
  sizeBytes: number | null;
  uploadedAt: string;
  uploadedByName: string | null;
};

const prettySize = (bytes: number | null) => {
  if (bytes == null) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

// Phase 2 — attaching what came back from a supplier. Several documents per supplier is the
// normal case: a COA and an SDS usually arrive together.
export function DocumentPanel({
  orderSupplierId,
  supplierName,
  documents,
  canEdit,
  attachAction,
  deleteAction,
}: {
  orderSupplierId: string;
  supplierName: string;
  documents: SupplierDocument[];
  canEdit: boolean;
  attachAction: (prev: DocumentUploadState, fd: FormData) => Promise<DocumentUploadState>;
  deleteAction: (prev: DocumentUploadState, fd: FormData) => Promise<DocumentUploadState>;
}) {
  const [attachState, attach, attaching] = useActionState(attachAction, undefined);
  const [removeState, remove, removing] = useActionState(deleteAction, undefined);
  const fileRef = useRef<HTMLInputElement>(null);

  const error = attachState?.error ?? removeState?.error;

  return (
    <div className="mt-3">
      {documents.length === 0 ? (
        <p className="text-caption text-neutral-dark/60">No documents attached yet.</p>
      ) : (
        <ul className="divide-y divide-neutral-dark/8 rounded-md border border-neutral-dark/10">
          {documents.map((doc) => (
            <li key={doc.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
              {/* Streamed back through a route that checks the session — supplier paperwork
                  isn't public just because it has a URL. */}
              <a
                href={`/api/order-documents/${doc.id}`}
                target="_blank"
                rel="noreferrer"
                className="text-body font-medium text-neutral-dark hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-secondary"
              >
                {doc.fileName}
              </a>
              <span className="text-caption text-neutral-dark/50">
                {prettySize(doc.sizeBytes)}
              </span>
              <span className="text-caption text-neutral-dark/50">
                {doc.uploadedByName ? `${doc.uploadedByName} · ` : ""}
                {doc.uploadedAt}
              </span>
              {canEdit && (
                <form action={remove} className="ml-auto">
                  <input type="hidden" name="documentId" value={doc.id} />
                  <button
                    type="submit"
                    disabled={removing}
                    className="text-caption text-danger hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger/40"
                  >
                    Remove
                  </button>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}

      {canEdit && (
        <form action={attach} className="mt-3 flex flex-wrap items-center gap-3">
          <input type="hidden" name="orderSupplierId" value={orderSupplierId} />
          <input
            ref={fileRef}
            type="file"
            name="documents"
            multiple
            accept=".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx,.xls,.xlsx"
            className="text-caption file:mr-3 file:rounded-md file:border file:border-neutral-dark/15 file:bg-white file:px-3 file:py-1.5 file:text-neutral-dark hover:file:bg-neutral-dark/[0.03]"
          />
          <Button type="submit" variant="secondary" disabled={attaching}>
            {attaching ? "Attaching…" : "Attach documents"}
          </Button>
          <span className="sr-only">for {supplierName}</span>
        </form>
      )}

      {error && <p className="text-caption mt-2 text-danger">{error}</p>}
      {!error && attachState?.ok && (
        <p className="text-caption mt-2 text-on-success">{attachState.ok}</p>
      )}
    </div>
  );
}
