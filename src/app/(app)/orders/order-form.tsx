"use client";

import Link from "next/link";
import { useActionState, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { FormField, Input, Select, Textarea } from "@/components/ui/input";
import {
  DIRECTOR_ATTESTATION,
  ORDER_REQUEST_TYPES,
  ORDER_REQUEST_TYPE_HINTS,
  ORDER_REQUEST_TYPE_LABELS,
  PLACEHOLDER_APPLICATIONS,
  PLACEHOLDER_NOTE,
  PLACEHOLDER_PRODUCT_FORMATS,
  PLACEHOLDER_REQUIRED_DOCUMENTS,
  SHORT_SUPPLIER_LIST_PROMPT,
  filledSupplierCount,
  needsExistingSample,
  needsShortSupplierListConfirmation,
  prefillsSupplier,
  usesThreeSuppliers,
  type OrderRequestType,
} from "@/lib/orders";
import type { OrderFormState } from "./actions";

// One row per sample in the live library, carrying everything the form pre-fills from.
export type SampleOption = {
  id: string;
  sampleCode: string;
  rmName: string;
  ingredients: Array<{ id: string; inciName: string }>;
  physicalForm: string;
  category: string;
  source: string;
  function: string;
  supplier: string;
  projectName: string | null;
};

export function OrderForm({
  samples,
  categories,
  sources,
  functions,
  physicalForms,
  suppliers,
  projects,
  action,
}: {
  samples: SampleOption[];
  categories: readonly string[];
  sources: readonly string[];
  functions: string[];
  physicalForms: string[];
  // Distinct Sample.supplier values rather than the managed Supplier table, so the list
  // reflects who has actually supplied something (SLT-58).
  suppliers: string[];
  projects: string[];
  action: (prev: OrderFormState, fd: FormData) => Promise<OrderFormState>;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);
  const formRef = useRef<HTMLFormElement>(null);

  const [requestType, setRequestType] = useState<OrderRequestType>("NEW");
  const [sampleId, setSampleId] = useState("");
  const [sampleSearch, setSampleSearch] = useState("");

  // Pre-filled fields are held in state so they can be populated on selection and still be
  // edited afterwards — the request records what was asked for, not a live pointer at the
  // sample.
  const [prefilled, setPrefilled] = useState({
    inciName: "",
    physicalForm: "",
    category: "",
    source: "",
    function: "",
    projectName: "",
    supplierName: "",
  });

  const [supplier1, setSupplier1] = useState("");
  const [supplier2, setSupplier2] = useState("");
  const [supplier3, setSupplier3] = useState("");

  // Two separate gates, deliberately not merged: the attestation applies to every
  // submission, the supplier prompt only to a new material with a short list.
  const [showAttestation, setShowAttestation] = useState(false);
  const [showSupplierPrompt, setShowSupplierPrompt] = useState(false);
  const [attested, setAttested] = useState(false);
  const [acknowledgedShortList, setAcknowledgedShortList] = useState(false);
  const [shortListReason, setShortListReason] = useState("");

  const errors = state?.fieldErrors ?? {};
  const showsSamplePicker = needsExistingSample(requestType);
  const threeSuppliers = usesThreeSuppliers(requestType);

  function clearPrefill() {
    setPrefilled({
      inciName: "",
      physicalForm: "",
      category: "",
      source: "",
      function: "",
      projectName: "",
      supplierName: "",
    });
  }

  function handleTypeChange(next: OrderRequestType) {
    setRequestType(next);
    setSampleId("");
    setSampleSearch("");
    // A brand-new material starts from nothing (AC1), and switching away from an existing
    // sample shouldn't leave that sample's details behind.
    clearPrefill();
    setAcknowledgedShortList(false);
    setShortListReason("");
  }

  function handleSampleChange(id: string) {
    setSampleId(id);
    const sample = samples.find((s) => s.id === id);
    if (!sample) {
      clearPrefill();
      return;
    }
    setPrefilled({
      inciName: sample.ingredients.map((i) => i.inciName).join(", "),
      physicalForm: sample.physicalForm,
      category: sample.category,
      source: sample.source,
      function: sample.function,
      projectName: sample.projectName ?? "",
      // AC2/AC3: only a repeat order from the same source knows the supplier.
      supplierName: prefillsSupplier(requestType) ? sample.supplier : "",
    });
  }

  function setPrefilledField(name: keyof typeof prefilled, value: string) {
    setPrefilled((prev) => ({ ...prev, [name]: value }));
  }

  // Submission runs the gates in order: the supplier prompt first, because it is about the
  // content of the request, then the attestation, which is the final act of submitting.
  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    if (
      !acknowledgedShortList &&
      needsShortSupplierListConfirmation(requestType, [supplier1, supplier2, supplier3])
    ) {
      event.preventDefault();
      setShowSupplierPrompt(true);
      return;
    }
    if (!attested) {
      event.preventDefault();
      setShowAttestation(true);
    }
  }

  function confirmAndSubmit(setter: (v: boolean) => void) {
    setter(true);
    setShowSupplierPrompt(false);
    setShowAttestation(false);
    // Re-submitted on the next tick so the state the gates check is already committed.
    setTimeout(() => formRef.current?.requestSubmit(), 0);
  }

  const supplierCount = filledSupplierCount([supplier1, supplier2, supplier3]);

  const selectedSample = samples.find((s) => s.id === sampleId) ?? null;

  // INCI is searchable too: "which sample has Limonene in it" is a routine question, and
  // the ingredient isn't otherwise visible in the row.
  const filteredSamples = useMemo(() => {
    const q = sampleSearch.trim().toLowerCase();
    if (!q) return samples;
    return samples.filter(
      (s) =>
        s.sampleCode.toLowerCase().includes(q) ||
        s.rmName.toLowerCase().includes(q) ||
        s.supplier.toLowerCase().includes(q) ||
        s.ingredients.some((i) => i.inciName.toLowerCase().includes(q))
    );
  }, [samples, sampleSearch]);

  return (
    <form ref={formRef} action={formAction} onSubmit={handleSubmit} className="space-y-6">
      <input type="hidden" name="requestType" value={requestType} />
      {/* Only ever posted once the requester has actually confirmed in the dialog. */}
      {attested && <input type="hidden" name="directorApprovalConfirmed" value="on" />}
      {acknowledgedShortList && (
        <>
          <input type="hidden" name="shortSupplierListAcknowledged" value="on" />
          {/* Carried outside the dialog, which unmounts on confirm — an input living
              inside it would be gone by the time the form submits. */}
          <input type="hidden" name="shortSupplierListReason" value={shortListReason} />
        </>
      )}

      {state?.formError && (
        <p className="text-body rounded-lg border border-danger/30 bg-danger/5 px-4 py-3 text-danger">
          {state.formError}
        </p>
      )}
      {/* Both of these belong to dialogs that have already closed by the time the server
          answers, so they surface as banners rather than field errors nobody can see. */}
      {(errors.directorApprovalConfirmed || errors.shortSupplierListReason) && (
        <p className="text-body rounded-lg border border-danger/30 bg-danger/5 px-4 py-3 text-danger">
          {errors.directorApprovalConfirmed ?? errors.shortSupplierListReason}
        </p>
      )}

      <section className="rounded-lg border border-neutral-dark/10 bg-white p-5 shadow-elevated">
        <h2 className="text-section-header mb-3 text-neutral-dark">Request type</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          {ORDER_REQUEST_TYPES.map((type) => (
            <label
              key={type}
              className={`cursor-pointer rounded-lg border p-3 transition-colors duration-150 ${
                requestType === type
                  ? "border-brand-secondary bg-brand-primary/10"
                  : "border-neutral-dark/15 hover:bg-neutral-dark/[0.02]"
              }`}
            >
              <span className="flex items-center gap-2">
                <input
                  type="radio"
                  name="requestTypeChoice"
                  value={type}
                  checked={requestType === type}
                  onChange={() => handleTypeChange(type)}
                  className="accent-brand-secondary"
                />
                <span className="text-body font-medium text-neutral-dark">
                  {ORDER_REQUEST_TYPE_LABELS[type]}
                </span>
              </span>
              <span className="text-caption mt-1 block text-neutral-dark/60">
                {ORDER_REQUEST_TYPE_HINTS[type]}
              </span>
            </label>
          ))}
        </div>

        {showsSamplePicker && (
          <div className="mt-4 max-w-xl">
            {/* Posted separately from the list, which uses radios rather than a <select>:
                the library runs to thousands of samples and a native dropdown can't be
                typed into. Same filter-then-pick shape as the ingredient picker. */}
            <input type="hidden" name="existingSampleId" value={sampleId} />

            <FormField
              label="Find the sample"
              htmlFor="sampleSearch"
              error={errors.existingSampleId}
            >
              <Input
                id="sampleSearch"
                type="search"
                value={sampleSearch}
                placeholder="Search by code, name, supplier or INCI"
                invalid={Boolean(errors.existingSampleId)}
                onChange={(e) => setSampleSearch(e.target.value)}
              />
            </FormField>

            {selectedSample && (
              <p className="text-caption mt-2 rounded-md border border-success/40 bg-success/10 px-3 py-2 text-on-success">
                Selected: {selectedSample.sampleCode} · {selectedSample.rmName}
              </p>
            )}

            <ul className="mt-2 max-h-56 divide-y divide-neutral-dark/8 overflow-y-auto rounded-md border border-neutral-dark/15">
              {filteredSamples.length === 0 ? (
                <li className="text-body px-4 py-6 text-center text-neutral-dark/50">
                  No samples match &ldquo;{sampleSearch}&rdquo;.
                </li>
              ) : (
                filteredSamples.map((s) => (
                  <li key={s.id}>
                    <label className="flex cursor-pointer items-baseline gap-3 px-3 py-2 transition-colors duration-150 hover:bg-neutral-dark/[0.03]">
                      <input
                        type="radio"
                        name="samplePick"
                        checked={sampleId === s.id}
                        onChange={() => handleSampleChange(s.id)}
                        className="accent-brand-secondary"
                      />
                      <span className="text-body font-medium text-neutral-dark">
                        {s.sampleCode}
                      </span>
                      <span className="text-body text-neutral-dark/80">{s.rmName}</span>
                      <span className="text-caption ml-auto text-neutral-dark/50">
                        {s.supplier}
                      </span>
                    </label>
                  </li>
                ))
              )}
            </ul>
            <p className="text-caption mt-1 text-neutral-dark/50">
              Showing {filteredSamples.length} of {samples.length}.
            </p>
          </div>
        )}
      </section>

      <section className="rounded-lg border border-neutral-dark/10 bg-white p-5 shadow-elevated">
        <h2 className="text-section-header mb-1 text-neutral-dark">Material</h2>
        <p className="text-caption mb-4 text-neutral-dark/60">
          {showsSamplePicker
            ? "Pre-filled from the selected sample. Edit anything that differs for this request."
            : "Nothing is pre-filled for a brand-new material."}
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="INCI Name" htmlFor="inciName">
            <Input
              id="inciName"
              name="inciName"
              value={prefilled.inciName}
              onChange={(e) => setPrefilledField("inciName", e.target.value)}
            />
            {/* Stays a free-text box because a brand-new material may have no ingredient
                record yet. When it came from a sample, each INCI links to its record so
                the requester can check what they're asking for. */}
            {selectedSample && selectedSample.ingredients.length > 0 && (
              <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <span className="text-caption text-neutral-dark/50">In the list:</span>
                {selectedSample.ingredients.map((i) => (
                  <Link
                    key={i.id}
                    href={`/ingredients/${i.id}`}
                    target="_blank"
                    className="text-caption rounded-full border border-neutral-dark/15 px-2 py-0.5 text-neutral-dark/80 transition-colors duration-150 hover:bg-neutral-dark/[0.04] hover:underline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand-primary"
                  >
                    {i.inciName}
                  </Link>
                ))}
              </span>
            )}
          </FormField>
          <FormField label="Physical Form" htmlFor="physicalForm">
            <Select
              id="physicalForm"
              name="physicalForm"
              value={prefilled.physicalForm}
              onChange={(e) => setPrefilledField("physicalForm", e.target.value)}
            >
              <option value="">Select…</option>
              {physicalForms.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </Select>
          </FormField>
          <FormField label="Category" htmlFor="category">
            <Select
              id="category"
              name="category"
              value={prefilled.category}
              onChange={(e) => setPrefilledField("category", e.target.value)}
            >
              <option value="">Select…</option>
              {categories.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </Select>
          </FormField>
          <FormField label="Source" htmlFor="source">
            <Select
              id="source"
              name="source"
              value={prefilled.source}
              onChange={(e) => setPrefilledField("source", e.target.value)}
            >
              <option value="">Select…</option>
              {sources.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </Select>
          </FormField>
          <FormField label="Function" htmlFor="function">
            <Select
              id="function"
              name="function"
              value={prefilled.function}
              onChange={(e) => setPrefilledField("function", e.target.value)}
            >
              <option value="">Select…</option>
              {functions.map((f) => (
                <option key={f} value={f}>{f}</option>
              ))}
            </Select>
          </FormField>
          <FormField label="Project" htmlFor="projectName">
            <Select
              id="projectName"
              name="projectName"
              value={prefilled.projectName}
              onChange={(e) => setPrefilledField("projectName", e.target.value)}
            >
              <option value="">Select…</option>
              {projects.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </Select>
          </FormField>
        </div>
      </section>

      <section className="rounded-lg border border-neutral-dark/10 bg-white p-5 shadow-elevated">
        <h2 className="text-section-header mb-1 text-neutral-dark">This request</h2>
        <p className="text-caption mb-4 text-neutral-dark/60">
          Always entered fresh — these describe what you need now, not the material itself.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Main Characteristic" htmlFor="mainCharacteristic">
            <Input id="mainCharacteristic" name="mainCharacteristic" defaultValue="" />
          </FormField>
          <FormField label="Application" htmlFor="application">
            <Select id="application" name="application" defaultValue="">
              <option value="">Select…</option>
              {PLACEHOLDER_APPLICATIONS.map((a) => (
                <option key={a} value={a}>{a}</option>
              ))}
            </Select>
          </FormField>
          <FormField label="Product Format" htmlFor="productFormat">
            <Select id="productFormat" name="productFormat" defaultValue="">
              <option value="">Select…</option>
              {PLACEHOLDER_PRODUCT_FORMATS.map((f) => (
                <option key={f} value={f}>{f}</option>
              ))}
            </Select>
          </FormField>
          <FormField label="Dosage of Use (%)" htmlFor="dosageOfUse">
            <Input id="dosageOfUse" name="dosageOfUse" defaultValue="" />
          </FormField>
          <FormField label="Required Quantity (g)" htmlFor="requiredQuantityG">
            <Input id="requiredQuantityG" name="requiredQuantityG" defaultValue="" />
          </FormField>
          <FormField label="Required Documents" htmlFor="requiredDocuments">
            <Select id="requiredDocuments" name="requiredDocuments" defaultValue="">
              <option value="">Select…</option>
              {PLACEHOLDER_REQUIRED_DOCUMENTS.map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </Select>
          </FormField>
          <div className="sm:col-span-2">
            <FormField label="Reference / Link" htmlFor="referenceLink">
              <Textarea id="referenceLink" name="referenceLink" rows={2} defaultValue="" />
            </FormField>
          </div>
        </div>
        <p className="text-caption mt-3 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-on-warning">
          {PLACEHOLDER_NOTE}
        </p>
      </section>

      <section className="rounded-lg border border-neutral-dark/10 bg-white p-5 shadow-elevated">
        <h2 className="text-section-header mb-1 text-neutral-dark">Supplier</h2>
        {threeSuppliers ? (
          <>
            <p className="text-caption mb-4 text-neutral-dark/60">
              Three options are wanted for a new material so procurement can compare. None is
              individually required — you&apos;ll be asked to confirm if you provide fewer.
            </p>
            <div className="grid gap-4 sm:grid-cols-3">
              {[
                ["supplier1", supplier1, setSupplier1],
                ["supplier2", supplier2, setSupplier2],
                ["supplier3", supplier3, setSupplier3],
              ].map(([name, value, setter], i) => (
                <FormField
                  key={name as string}
                  label={`Supplier ${i + 1}`}
                  htmlFor={name as string}
                  error={i === 0 ? errors.supplier1 : undefined}
                >
                  <Input
                    id={name as string}
                    name={name as string}
                    value={value as string}
                    invalid={i === 0 && Boolean(errors.supplier1)}
                    onChange={(e) => (setter as (v: string) => void)(e.target.value)}
                  />
                </FormField>
              ))}
            </div>
            <p className="text-caption mt-2 text-neutral-dark/60">
              {supplierCount} of 3 provided.
            </p>
          </>
        ) : (
          <div className="max-w-md">
            <p className="text-caption mb-4 text-neutral-dark/60">
              {prefillsSupplier(requestType)
                ? "Pre-filled from the selected sample, and editable."
                : "A new source for a material we already hold — choose or type the supplier."}
            </p>
            <FormField label="Supplier Name" htmlFor="supplierName">
              <Select
                id="supplierName"
                name="supplierName"
                value={prefilled.supplierName}
                onChange={(e) => setPrefilledField("supplierName", e.target.value)}
              >
                <option value="">Select…</option>
                {suppliers.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </Select>
            </FormField>
          </div>
        )}
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Submitting…" : "Submit request"}
        </Button>
        <Link
          href="/orders"
          className="text-body text-neutral-dark/70 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-secondary"
        >
          Cancel
        </Link>
        <span className="text-caption text-neutral-dark/55">
          Submission date and your name are recorded automatically.
        </span>
      </div>

      {showSupplierPrompt && (
        <Dialog
          title="Fewer than 3 suppliers"
          body={SHORT_SUPPLIER_LIST_PROMPT}
          detail={`You have provided ${supplierCount} of 3.`}
          confirmLabel="Yes, confirmed"
          reasonLabel="Why fewer than 3?"
          reasonRequired
          reasonPlaceholder="e.g. sole supplier for this material, or urgent trial"
          reasonValue={shortListReason}
          onReasonChange={setShortListReason}
          onConfirm={() => confirmAndSubmit(setAcknowledgedShortList)}
          onCancel={() => setShowSupplierPrompt(false)}
        />
      )}

      {showAttestation && (
        <Dialog
          title="Director approval"
          body={DIRECTOR_ATTESTATION}
          confirmLabel="I confirm"
          onConfirm={() => confirmAndSubmit(setAttested)}
          onCancel={() => setShowAttestation(false)}
        />
      )}
    </form>
  );
}

function Dialog({
  title,
  body,
  detail,
  confirmLabel,
  reasonLabel,
  reasonPlaceholder,
  reasonValue,
  reasonRequired,
  onReasonChange,
  onConfirm,
  onCancel,
}: {
  title: string;
  body: string;
  detail?: string;
  confirmLabel: string;
  // Optional: only the supplier prompt asks for an explanation. Left optional rather than
  // required because the acknowledgement is the gate — this is the context procurement
  // would otherwise have to chase by email.
  reasonLabel?: string;
  reasonPlaceholder?: string;
  reasonValue?: string;
  // Confirming is blocked until it's filled in — procurement acts on this, so an empty
  // one would just move the question to an email.
  reasonRequired?: boolean;
  onReasonChange?: (value: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const blockedOnReason = Boolean(reasonRequired) && (reasonValue ?? "").trim() === "";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-dark/40 p-4"
    >
      <div className="w-full max-w-md rounded-lg border border-neutral-dark/10 bg-white p-5 shadow-elevated">
        <h3 className="text-section-header text-neutral-dark">{title}</h3>
        <p className="text-body mt-2 text-neutral-dark/80">{body}</p>
        {detail && <p className="text-caption mt-1 text-neutral-dark/55">{detail}</p>}
        {reasonLabel && onReasonChange && (
          <div className="mt-3">
            <FormField label={reasonLabel} htmlFor="shortListReason">
              <Textarea
                id="shortListReason"
                rows={2}
                autoFocus
                value={reasonValue ?? ""}
                placeholder={reasonPlaceholder}
                onChange={(e) => onReasonChange(e.target.value)}
              />
            </FormField>
          </div>
        )}
        {blockedOnReason && (
          <p className="text-caption mt-1 text-neutral-dark/55">
            A reason is needed before this can be submitted.
          </p>
        )}
        <div className="mt-4 flex flex-wrap justify-end gap-3">
          <Button type="button" variant="secondary" onClick={onCancel}>
            Go back
          </Button>
          <Button type="button" onClick={onConfirm} disabled={blockedOnReason}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
