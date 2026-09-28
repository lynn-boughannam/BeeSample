"use client";

import { useActionState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { FormField, Input } from "@/components/ui/input";
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

// Phases 2 and 3, in one step. What a supplier sends back — the paperwork and the terms —
// arrives as one reply, so it is recorded with one button. As two forms it took two saves
// to log one email, and left the row half-entered in between.
//
// The document list stays a sibling of that form rather than a part of it: each Remove is
// its own submission, and a form cannot be nested inside another.
export function SupplierEntryForm({
  orderSupplierId,
  supplierName,
  documents,
  acceptsDocuments,
  canEdit,
  landedPrice,
  moq,
  saveAction,
  deleteAction,
}: {
  orderSupplierId: string;
  supplierName: string;
  documents: SupplierDocument[];
  // A repeat order from the same source has its documents on file already; only the terms
  // are asked for.
  acceptsDocuments: boolean;
  canEdit: boolean;
  landedPrice: string;
  moq: string;
  saveAction: (prev: DocumentUploadState, fd: FormData) => Promise<DocumentUploadState>;
  deleteAction: (prev: DocumentUploadState, fd: FormData) => Promise<DocumentUploadState>;
}) {
  const [saveState, save, saving] = useActionState(saveAction, undefined);
  const [removeState, remove, removing] = useActionState(deleteAction, undefined);
  const fileRef = useRef<HTMLInputElement>(null);

  // Clear the picker once its files are stored, so a second Save doesn't attach them twice.
  useEffect(() => {
    if (saveState?.ok && fileRef.current) fileRef.current.value = "";
  }, [saveState]);

  const error = saveState?.error ?? removeState?.error;
  const ok = !error ? (saveState?.ok ?? removeState?.ok) : undefined;

  return (
    <div className="mt-3">
      {!acceptsDocuments ? (
        <p className="text-caption text-neutral-dark/60">
          No documents chased — same supplier as before.
        </p>
      ) : documents.length === 0 ? (
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
        <form action={save} className="mt-3 flex flex-wrap items-end gap-3">
          <input type="hidden" name="orderSupplierId" value={orderSupplierId} />
          {acceptsDocuments && (
            <FormField label="Documents" htmlFor={`docs-${orderSupplierId}`}>
              <input
                ref={fileRef}
                id={`docs-${orderSupplierId}`}
                type="file"
                name="documents"
                multiple
                accept=".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx,.xls,.xlsx"
                className="text-caption file:mr-3 file:rounded-md file:border file:border-neutral-dark/15 file:bg-white file:px-3 file:py-1.5 file:text-neutral-dark hover:file:bg-neutral-dark/[0.03]"
              />
            </FormField>
          )}
          <FormField label="Landed price" htmlFor={`price-${orderSupplierId}`}>
            <Input
              id={`price-${orderSupplierId}`}
              name="landedPrice"
              type="number"
              step="0.01"
              min="0"
              defaultValue={landedPrice}
              className="w-36"
            />
          </FormField>
          <FormField label="MOQ" htmlFor={`moq-${orderSupplierId}`}>
            <Input
              id={`moq-${orderSupplierId}`}
              name="moq"
              defaultValue={moq}
              placeholder="e.g. 25 kg"
              className="w-40"
            />
          </FormField>
          <Button type="submit" variant="secondary" disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
          <span className="sr-only">for {supplierName}</span>
        </form>
      )}

      {error && <p className="text-caption mt-2 text-danger">{error}</p>}
      {ok && <p className="text-caption mt-2 text-on-success">{ok}</p>}
    </div>
  );
}
