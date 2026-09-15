"use client";

import Link from "next/link";
import { useActionState, useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormField, Input, Select } from "@/components/ui/input";
import { cn } from "@/lib/cn";
import {
  MANUAL_PIECE_LIMIT,
  centsToGrams,
  distributeCents,
  sumCents,
  toCents,
  type PieceMode,
} from "@/lib/pieces";
import {
  DOCUMENT_AVAILABILITY,
  FRAGRANCE_ORIENTATIONS,
  HAZARD_CLASSES,
  SAMPLE_CATEGORIES,
  SAMPLE_SOURCES,
  SHELF_LETTERS,
  SHELF_LEVELS,
  SHELF_SUBLEVELS,
  assignSublevel,
  colorKeyFor,
  shelfAddress,
  shelfCellKey,
  shelfKey,
} from "@/lib/categories";
import type { ShelfCellColors, ShelfDefault, ShelfOccupancy } from "@/lib/shelf";

type Ingredient = { id: string; inciName: string; chemicalFamily: string | null };

// Visual order of the fields, so "the first invalid one" means the first the user would
// reach scrolling down — not whichever key the validator happened to report first.
const FIELD_ORDER = [
  "sampleCode",
  "rmName",
  "category",
  "fragranceOrientation",
  "function",
  "physicalForm",
  "source",
  "supplier",
  "projectName",
  "hazardClass",
  "batchLot",
  "documentAvailability",
  "receptionDate",
  "expiryDate",
  "receivedQtyG",
  "receivedQtyPcs",
  "netWeightG",
  "pieceMode",
  "pieceWeights",
  "shelfLetter",
  "shelfLevel",
  "shelfSublevel",
  "ingredientIds",
];

// Errors whose field name isn't the id of anything focusable.
const FOCUS_TARGET: Record<string, string> = {
  ingredientIds: "ingredientSearch",
  pieceWeights: "piece-1",
};

export type SampleFormState =
  | { fieldErrors?: Record<string, string>; formError?: string }
  | undefined;

export type SampleFormInitial = {
  id: string;
  sampleCode: string;
  rmName: string;
  category: string;
  fragranceOrientation: string;
  function: string;
  physicalForm: string;
  source: string;
  supplier: string;
  projectName: string;
  hazardClass: string;
  receptionDate: string; // yyyy-mm-dd
  expiryDate: string; // yyyy-mm-dd
  receivedQtyG: string;
  receivedQtyPcs: string;
  netWeightG: string;
  batchLot: string;
  documentAvailability: string;
  shelfLetter: string;
  shelfLevel: string;
  shelfSublevel: string;
  ingredientIds: string[];
};

// Shared by Add and Edit so the two can't drift. The only differences are the initial
// values, the submit label, and the quantity helper text.
export function SampleForm({
  action,
  ingredients,
  shelfDefaults,
  shelfOccupancy,
  shelfCellColors,
  functions,
  physicalForms,
  suppliers,
  projects,
  initial,
  submitLabel,
  cancelHref,
}: {
  action: (prev: SampleFormState, fd: FormData) => Promise<SampleFormState>;
  ingredients: Ingredient[];
  shelfDefaults: Record<string, ShelfDefault>;
  shelfOccupancy: ShelfOccupancy;
  shelfCellColors: ShelfCellColors;
  functions: string[];
  physicalForms: string[];
  suppliers: string[];
  projects: string[];
  initial?: SampleFormInitial;
  submitLabel: string;
  cancelHref: string;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);

  // React resets an uncontrolled <form> once a Server Action returns, which blanked every
  // defaultValue field on a failed submission and forced the whole form to be re-entered.
  // Holding the values in state instead means a rejected save only ever needs the one bad
  // field corrected, and it covers every failure path — schema errors, a duplicate sample
  // code, a stale reference list — without the action having to echo values back.
  const [values, setValues] = useState<Record<string, string>>(() => ({
    sampleCode: initial?.sampleCode ?? "",
    rmName: initial?.rmName ?? "",
    function: initial?.function ?? "",
    physicalForm: initial?.physicalForm ?? "",
    supplier: initial?.supplier ?? "",
    projectName: initial?.projectName ?? "",
    hazardClass: initial?.hazardClass ?? "",
    batchLot: initial?.batchLot ?? "",
    documentAvailability: initial?.documentAvailability ?? "",
    receptionDate: initial?.receptionDate ?? "",
    expiryDate: initial?.expiryDate ?? "",
    netWeightG: initial?.netWeightG ?? "",
  }));

  function setField(name: string, value: string) {
    setValues((prev) => ({ ...prev, [name]: value }));
  }

  const [source, setSource] = useState(initial?.source ?? "");
  const [category, setCategory] = useState(initial?.category ?? "");
  const [orientation, setOrientation] = useState(initial?.fragranceOrientation ?? "");
  const [shelfLetter, setShelfLetter] = useState(initial?.shelfLetter ?? "");
  const [shelfLevel, setShelfLevel] = useState(initial?.shelfLevel ?? "");
  const [shelfSublevel, setShelfSublevel] = useState(initial?.shelfSublevel ?? "");
  const [search, setSearch] = useState("");
  const [checkedIds, setCheckedIds] = useState<Set<string>>(
    new Set(initial?.ingredientIds ?? [])
  );

  // Controlled so the piece-weight block can react as soon as both are filled in.
  const [qtyG, setQtyG] = useState(initial?.receivedQtyG ?? "");
  const [qtyPcs, setQtyPcs] = useState(initial?.receivedQtyPcs ?? "");
  const [pieceMode, setPieceMode] = useState<PieceMode>("AUTO");
  const [manualWeights, setManualWeights] = useState<string[]>([]);

  const totalG = Number(qtyG);
  const pieceCount = Number.parseInt(qtyPcs, 10);
  const piecesReady =
    qtyG.trim() !== "" && Number.isFinite(totalG) && totalG > 0 && pieceCount > 0;

  // Resize the manual inputs when the piece count changes, keeping whatever has already
  // been typed rather than clearing the lot.
  useEffect(() => {
    const size = piecesReady ? pieceCount : 0;
    setManualWeights((prev) =>
      prev.length === size ? prev : Array.from({ length: size }, (_, i) => prev[i] ?? "")
    );
  }, [pieceCount, piecesReady]);

  // Shelf placement is decided by Source first — Natural and Organic each claim a zone
  // whatever the sample is — and only falls through to Category, and for fragrances to
  // the Orientation (SLT-19).
  const shelfDefault = source ? shelfDefaults[shelfKey(source, category, orientation)] : undefined;
  // What claimed the zone, for the hint text: the Source for Natural and Organic, the
  // Orientation for a fragrance, the Category otherwise — the same key the swatch uses.
  const zoneLabel = colorKeyFor(source, category, orientation);
  const errors = state?.fieldErrors ?? {};
  const isEdit = Boolean(initial);

  // Sublevel stays None unless the cell already holds another sample, in which case a
  // letter is taken so the two don't share an address. Worked out here so the Admin sees
  // what the sample will be stored as — the action decides it again server-side, which is
  // what actually counts.
  // The swatch shows the shelf plan's colour for the cell actually selected, so it keeps
  // up when the Admin overrides the computed row or level. Before a level is picked it
  // falls back to the zone's colour — the Chemicals and Natural bands are a single colour
  // across every cell anyway.
  const shelfColor =
    (shelfLetter && shelfLevel
      ? shelfCellColors[shelfCellKey(shelfLetter, shelfLevel)]
      : undefined) ??
    shelfDefault?.colorHex ??
    null;

  const autoSublevel =
    shelfLetter && shelfLevel
      ? assignSublevel(shelfOccupancy[shelfCellKey(shelfLetter, shelfLevel)])
      : null;
  const cellIsFull = autoSublevel?.kind === "full";

  // Changing any of the three re-defaults the shelf row, its level and its swatch. This
  // only fires on an actual change, so opening an existing sample keeps its saved
  // location rather than silently snapping back to the computed default.
  function applyShelfDefault(
    nextSource: string,
    nextCategory: string,
    nextOrientation: string
  ) {
    const next = shelfDefaults[shelfKey(nextSource, nextCategory, nextOrientation)];
    setShelfLetter(next?.letter ?? "");
    // Blank on the Chemicals and Natural bands, where the plan reserves whole columns
    // and genuinely doesn't say which level a sample belongs on.
    setShelfLevel(next?.level != null ? String(next.level) : "");
    // Back to Auto: the sublevel that was right for the old cell isn't right for a new one.
    setShelfSublevel("");
  }

  function handleSourceChange(next: string) {
    setSource(next);
    applyShelfDefault(next, category, orientation);
  }

  function handleCategoryChange(next: string) {
    setCategory(next);
    // Only fragrances carry an orientation, so drop a stale one rather than leaving it
    // visible on a category that has no use for it.
    const nextOrientation = next === "Fragrance" ? orientation : "";
    setOrientation(nextOrientation);
    applyShelfDefault(source, next, nextOrientation);
  }

  function handleOrientationChange(next: string) {
    setOrientation(next);
    applyShelfDefault(source, category, next);
  }

  // Every <select> on the form, by element id, paired with the state that owns it.
  const selectValues: Record<string, string> = {
    category,
    fragranceOrientation: orientation,
    function: values.function,
    physicalForm: values.physicalForm,
    source,
    supplier: values.supplier,
    projectName: values.projectName,
    hazardClass: values.hazardClass,
    documentAvailability: values.documentAvailability,
    shelfLetter,
    shelfLevel,
    shelfSublevel,
  };

  // Controlled state alone doesn't survive React's post-action form reset for <select>.
  // For an <input> React re-applies the value on the next render, but for a <select> its
  // record of the value is unchanged by the reset, so it issues no DOM update and the
  // blanked selection sticks. Re-applying it here is the smallest fix that doesn't
  // remount the fields (which would throw away the focus set just below).
  useEffect(() => {
    if (!state) return;
    for (const [id, value] of Object.entries(selectValues)) {
      const el = document.getElementById(id);
      if (el instanceof HTMLSelectElement && el.value !== value) el.value = value;
    }
    // Deliberately keyed on the submission only: re-running whenever a value changes
    // would fight the user mid-edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  // ~20 fields means a rejected save can leave the offending one well off-screen, so the
  // first invalid field is scrolled to and focused. useActionState returns a fresh object
  // per submission, so this re-fires even when the same field fails twice in a row.
  useEffect(() => {
    const failed = state?.fieldErrors;
    if (!failed) return;

    const firstInvalid = FIELD_ORDER.find((field) => failed[field]);
    if (!firstInvalid) return;

    const el = document.getElementById(FOCUS_TARGET[firstInvalid] ?? firstInvalid);
    if (!el) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ block: "center", behavior: reduced ? "auto" : "smooth" });
    // preventScroll stops focus() from doing its own instant jump and cancelling the
    // smooth scroll above.
    el.focus({ preventScroll: true });
  }, [state]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return ingredients;
    return ingredients.filter(
      (i) =>
        i.inciName.toLowerCase().includes(q) ||
        (i.chemicalFamily ?? "").toLowerCase().includes(q)
    );
  }, [ingredients, search]);

  function toggleIngredient(id: string) {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <form action={formAction} className="space-y-6">
      {initial && <input type="hidden" name="id" value={initial.id} />}

      {/* Checked ingredients are submitted from state, not from the visible checkboxes.
          Filtering the list unmounts non-matching rows, so relying on DOM checkbox state
          would silently drop selections made under a previous search term. */}
      {[...checkedIds].map((id) => (
        <input key={id} type="hidden" name="ingredientIds" value={id} />
      ))}

      <section className="rounded-lg border border-neutral-dark/10 bg-white p-5 shadow-elevated">
        <h2 className="text-section-header mb-4 text-neutral-dark">Identification</h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <FormField label="Sample Code" htmlFor="sampleCode" error={errors.sampleCode}>
            <Input
              id="sampleCode"
              name="sampleCode"
              value={values.sampleCode}
              onChange={(e) => setField("sampleCode", e.target.value)}
              placeholder="e.g. S-2608"
              invalid={Boolean(errors.sampleCode)}
            />
          </FormField>

          <FormField label="RM Name" htmlFor="rmName" error={errors.rmName}>
            <Input
              id="rmName"
              name="rmName"
              value={values.rmName}
              onChange={(e) => setField("rmName", e.target.value)}
              invalid={Boolean(errors.rmName)}
            />
          </FormField>

          <FormField label="Category" htmlFor="category" error={errors.category}>
            <Select
              id="category"
              name="category"
              value={category}
              invalid={Boolean(errors.category)}
              onChange={(e) => handleCategoryChange(e.target.value)}
            >
              <option value="">Select a category…</option>
              {SAMPLE_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </FormField>

          <FormField
            label="Fragrance Orientation"
            htmlFor="fragranceOrientation"
            error={errors.fragranceOrientation}
          >
            <Select
              id="fragranceOrientation"
              name="fragranceOrientation"
              value={orientation}
              invalid={Boolean(errors.fragranceOrientation)}
              onChange={(e) => handleOrientationChange(e.target.value)}
            >
              <option value="">Select an orientation…</option>
              {FRAGRANCE_ORIENTATIONS.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </Select>
            {category === "Fragrance" && (
              <p className="text-caption mt-1 text-neutral-dark/60">
                Sets the shelf row for fragrance samples.
              </p>
            )}
          </FormField>

          <LookupField
            label="Function"
            name="function"
            options={functions}
            error={errors.function}
            initialValue={initial?.function}
            value={values.function}
            onValueChange={(v) => setField("function", v)}
          />
          <LookupField
            label="Physical Form"
            name="physicalForm"
            options={physicalForms}
            error={errors.physicalForm}
            initialValue={initial?.physicalForm}
            value={values.physicalForm}
            onValueChange={(v) => setField("physicalForm", v)}
          />

          <FixedSelectField
            label="Source"
            name="source"
            options={[...SAMPLE_SOURCES]}
            initialValue={initial?.source}
            error={errors.source}
            value={source}
            onValueChange={handleSourceChange}
            hint={
              source === "Natural" || source === "Organic"
                ? `${source} samples are filed in their own zone, whatever the category.`
                : undefined
            }
          />

          <LookupField
            label="Supplier"
            name="supplier"
            options={suppliers}
            error={errors.supplier}
            initialValue={initial?.supplier}
            value={values.supplier}
            onValueChange={(v) => setField("supplier", v)}
          />

          <LookupField
            label="Project Name"
            name="projectName"
            options={projects}
            error={errors.projectName}
            initialValue={initial?.projectName}
            value={values.projectName}
            onValueChange={(v) => setField("projectName", v)}
          />

          <FixedSelectField
            label="Hazard Class"
            name="hazardClass"
            options={[...HAZARD_CLASSES]}
            initialValue={initial?.hazardClass}
            error={errors.hazardClass}
            value={values.hazardClass}
            onValueChange={(v) => setField("hazardClass", v)}
          />

          <FormField label="Batch / Lot" htmlFor="batchLot" error={errors.batchLot}>
            <Input
              id="batchLot"
              name="batchLot"
              value={values.batchLot}
              onChange={(e) => setField("batchLot", e.target.value)}
            />
          </FormField>

          <FormField
            label="Document Availability"
            htmlFor="documentAvailability"
            error={errors.documentAvailability}
          >
            <Select
              id="documentAvailability"
              name="documentAvailability"
              value={values.documentAvailability}
              onChange={(e) => setField("documentAvailability", e.target.value)}
            >
              <option value="">Not recorded</option>
              {DOCUMENT_AVAILABILITY.map((d) => (
                <option key={d} value={d}>
                  {d === "YES" ? "Yes" : "No"}
                </option>
              ))}
            </Select>
          </FormField>
        </div>
      </section>

      <section className="rounded-lg border border-neutral-dark/10 bg-white p-5 shadow-elevated">
        <h2 className="text-section-header mb-4 text-neutral-dark">Receipt</h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <FormField label="Reception Date" htmlFor="receptionDate" error={errors.receptionDate}>
            <Input
              id="receptionDate"
              name="receptionDate"
              type="date"
              value={values.receptionDate}
              onChange={(e) => setField("receptionDate", e.target.value)}
              invalid={Boolean(errors.receptionDate)}
            />
          </FormField>

          <FormField label="Expiry Date" htmlFor="expiryDate" error={errors.expiryDate}>
            <Input
              id="expiryDate"
              name="expiryDate"
              type="date"
              value={values.expiryDate}
              onChange={(e) => setField("expiryDate", e.target.value)}
              invalid={Boolean(errors.expiryDate)}
            />
          </FormField>

          <FormField
            label="Received Quantity (g)"
            htmlFor="receivedQtyG"
            error={errors.receivedQtyG}
          >
            <Input
              id="receivedQtyG"
              name="receivedQtyG"
              type="number"
              min="0"
              step="0.01"
              value={qtyG}
              onChange={(e) => setQtyG(e.target.value)}
              invalid={Boolean(errors.receivedQtyG)}
            />
          </FormField>

          <FormField
            label="Received Quantity (pcs)"
            htmlFor="receivedQtyPcs"
            error={errors.receivedQtyPcs}
          >
            <Input
              id="receivedQtyPcs"
              name="receivedQtyPcs"
              type="number"
              min="0"
              step="1"
              value={qtyPcs}
              onChange={(e) => setQtyPcs(e.target.value)}
              invalid={Boolean(errors.receivedQtyPcs)}
            />
          </FormField>

          <FormField label="Net Weight (g)" htmlFor="netWeightG" error={errors.netWeightG}>
            <Input
              id="netWeightG"
              name="netWeightG"
              type="number"
              min="0"
              step="0.01"
              value={values.netWeightG}
              onChange={(e) => setField("netWeightG", e.target.value)}
              invalid={Boolean(errors.netWeightG)}
            />
          </FormField>
        </div>
        <p className="text-caption mt-2 text-neutral-dark/60">
          {isEdit
            ? "Changing the received total adjusts the remaining quantity by the same amount, so anything already used stays accounted for."
            : "Received quantity sets both the total and remaining quantity for this sample."}
        </p>
      </section>

      {/* Piece tracking is part of sample creation (SLT-13). Editing an existing sample
          leaves its saved pieces alone, so the block isn't shown there. */}
      {!isEdit && (
        <PieceWeights
          ready={piecesReady}
          totalG={totalG}
          pieceCount={pieceCount}
          mode={pieceMode}
          onModeChange={setPieceMode}
          weights={manualWeights}
          onWeightChange={(index, value) =>
            setManualWeights((prev) => prev.map((w, i) => (i === index ? value : w)))
          }
          error={errors.pieceWeights ?? errors.pieceMode}
        />
      )}

      <section className="rounded-lg border border-neutral-dark/10 bg-white p-5 shadow-elevated">
        <h2 className="text-section-header mb-1 text-neutral-dark">Shelf location</h2>
        <p className="text-caption mb-4 text-neutral-dark/60">
          The row and level are suggested from the source, then the category. Correct them
          here if the physical location differs.
        </p>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <FormField label="Shelf Row (Letter)" htmlFor="shelfLetter" error={errors.shelfLetter}>
            <div className="flex items-center gap-2">
              <Select
                id="shelfLetter"
                name="shelfLetter"
                value={shelfLetter}
                invalid={Boolean(errors.shelfLetter)}
                onChange={(e) => setShelfLetter(e.target.value)}
              >
                <option value="">Select a row…</option>
                {SHELF_LETTERS.map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </Select>
              {shelfColor && (
                <span
                  className="h-8 w-8 shrink-0 rounded-md border border-neutral-dark/10"
                  style={{ backgroundColor: shelfColor }}
                  title={
                    shelfLetter && shelfLevel
                      ? `Shelf colour for ${shelfAddress(shelfLetter, Number(shelfLevel))}`
                      : "Shelf colour"
                  }
                  aria-label={
                    shelfLetter && shelfLevel
                      ? `Shelf colour for ${shelfAddress(shelfLetter, Number(shelfLevel))}`
                      : "Shelf colour"
                  }
                />
              )}
            </div>
            {shelfDefault && shelfDefault.zoneLetters.length > 1 && (
              <p className="text-caption mt-1 text-neutral-dark/60">
                {zoneLabel} occupies rows{" "}
                {shelfDefault.zoneLetters[0]}–
                {shelfDefault.zoneLetters[shelfDefault.zoneLetters.length - 1]} rather than
                one fixed row, and the level is yours to choose. Defaulted to{" "}
                {shelfDefault.letter}.
              </p>
            )}
          </FormField>

          <div className="grid grid-cols-2 gap-4">
            <FormField label="Shelf Level" htmlFor="shelfLevel" error={errors.shelfLevel}>
              <Select
                id="shelfLevel"
                name="shelfLevel"
                value={shelfLevel}
                invalid={Boolean(errors.shelfLevel)}
                onChange={(e) => {
                  setShelfLevel(e.target.value);
                  setShelfSublevel("");
                }}
              >
                <option value="">Select a level…</option>
                {SHELF_LEVELS.map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </Select>
              {shelfDefault && shelfDefault.zoneLevels.length > 1 && !shelfDefault.isManualLevel && (
                <p className="text-caption mt-1 text-neutral-dark/60">
                  {zoneLabel} spans{" "}
                  {shelfDefault.zoneLevels
                    .map((l) => `${shelfDefault.zoneLetters[0]}${l}`)
                    .join(" and ")}
                  . Either level is correct.
                </p>
              )}
            </FormField>

            <FormField label="Sublevel" htmlFor="shelfSublevel" error={errors.shelfSublevel}>
              <Select
                id="shelfSublevel"
                name="shelfSublevel"
                value={shelfSublevel}
                invalid={Boolean(errors.shelfSublevel) || cellIsFull}
                onChange={(e) => setShelfSublevel(e.target.value)}
              >
                {/* None is the default. The server only substitutes a letter when the
                    cell already holds a sample, so two can't share an address. */}
                <option value="">None</option>
                {SHELF_SUBLEVELS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </Select>
              {cellIsFull && (
                <p className="text-caption mt-1 text-danger">
                  {shelfAddress(shelfLetter, Number(shelfLevel))} is full — it holds a sample
                  plus sublevels a–e. Pick another level or row.
                </p>
              )}
              {shelfSublevel === "" && autoSublevel?.kind === "letter" && (
                <p className="text-caption mt-1 text-neutral-dark/60">
                  {shelfAddress(shelfLetter, Number(shelfLevel))} already holds a sample, so
                  this one will be saved as{" "}
                  {shelfAddress(shelfLetter, Number(shelfLevel), autoSublevel.sublevel)}.
                </p>
              )}
            </FormField>
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-neutral-dark/10 bg-white p-5 shadow-elevated">
        <div className="mb-1 flex items-baseline justify-between gap-4">
          <h2 className="text-section-header text-neutral-dark">INCI ingredients</h2>
          <span className="text-caption text-neutral-dark/60">{checkedIds.size} selected</span>
        </div>

        <FormField
          label="Search ingredients"
          htmlFor="ingredientSearch"
          error={errors.ingredientIds}
        >
          <Input
            id="ingredientSearch"
            type="search"
            value={search}
            placeholder="Filter by INCI name or chemical family"
            onChange={(e) => setSearch(e.target.value)}
            invalid={Boolean(errors.ingredientIds)}
          />
        </FormField>

        <div className="mt-3 max-h-72 overflow-y-auto rounded-lg border border-neutral-dark/10">
          {ingredients.length === 0 ? (
            <p className="text-body px-4 py-8 text-center text-neutral-dark/50">
              No ingredients in the master list yet. Ingredients must exist before a sample
              can reference them.
            </p>
          ) : filtered.length === 0 ? (
            <p className="text-body px-4 py-8 text-center text-neutral-dark/50">
              No ingredients match “{search}”. Selections you already made are kept.
            </p>
          ) : (
            <ul className="divide-y divide-neutral-dark/8">
              {filtered.map((ing) => (
                <li key={ing.id}>
                  <label className="flex cursor-pointer items-center gap-3 px-4 py-2.5 transition-colors hover:bg-neutral-dark/[0.02]">
                    <input
                      type="checkbox"
                      checked={checkedIds.has(ing.id)}
                      onChange={() => toggleIngredient(ing.id)}
                      className="h-4 w-4 shrink-0 rounded border-neutral-dark/30"
                    />
                    <span className="text-body text-neutral-dark">{ing.inciName}</span>
                    {ing.chemicalFamily && (
                      <span className="text-caption ml-auto text-neutral-dark/50">
                        {ing.chemicalFamily}
                      </span>
                    )}
                  </label>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {state?.formError && <p className="text-body text-danger">{state.formError}</p>}

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : submitLabel}
        </Button>
        <Link
          href={cancelHref}
          className="text-body font-medium text-neutral-dark/60 hover:underline"
        >
          Cancel
        </Link>
      </div>
    </form>
  );
}

// Every sample is tracked piece by piece, for every physical form — liquids, gels and
// powders included. Auto splits the received total across the pieces (remainder on the
// last one); manual takes each actual weight and must reconcile to the total exactly.
function PieceWeights({
  ready,
  totalG,
  pieceCount,
  mode,
  onModeChange,
  weights,
  onWeightChange,
  error,
}: {
  ready: boolean;
  totalG: number;
  pieceCount: number;
  mode: PieceMode;
  onModeChange: (mode: PieceMode) => void;
  weights: string[];
  onWeightChange: (index: number, value: string) => void;
  error?: string;
}) {
  const expectedCents = ready ? toCents(totalG) : 0;
  const autoSplit = ready ? distributeCents(expectedCents, pieceCount) : [];
  const lastAuto = autoSplit[autoSplit.length - 1];
  const dividesEvenly = autoSplit.length > 0 && autoSplit[0] === lastAuto;

  // One input per piece, so an implausible count would freeze the browser. Auto has no
  // such limit, and falling back to it beats refusing to save at all.
  const manualAllowed = pieceCount <= MANUAL_PIECE_LIMIT;
  const effectiveMode: PieceMode = manualAllowed ? mode : "AUTO";

  // The exact-sum rule is a hard block on submit, so the running total is shown while
  // typing rather than only surfacing after a rejected save.
  const entered = weights.map((w) => {
    if (w.trim() === "") return null;
    const cents = toCents(Number(w));
    return Number.isFinite(cents) ? cents : null;
  });
  const allEntered = entered.length > 0 && entered.every((c) => c !== null);
  const runningCents = sumCents(entered.filter((c): c is number => c !== null));
  const matches = allEntered && runningCents === expectedCents;

  return (
    <section className="rounded-lg border border-neutral-dark/10 bg-white p-5 shadow-elevated">
      <h2 className="text-section-header mb-1 text-neutral-dark">Piece weights</h2>
      <p className="text-caption mb-4 text-neutral-dark/60">
        Recorded for every sample, whatever its physical form.
      </p>

      {!ready ? (
        <>
          <p className="text-body text-neutral-dark/50">
            Enter the received quantity in grams and in pieces above to set piece weights.
          </p>
          {/* Keeps the field present before the choice is offered, so a submission that
              fails on the quantities doesn't also report a missing mode. */}
          <input type="hidden" name="pieceMode" value="AUTO" />
        </>
      ) : (
        <>
          <div
            role="radiogroup"
            aria-label="How piece weights are set"
            className="inline-flex rounded-lg border border-neutral-dark/15 p-0.5"
          >
            <ModeOption
              value="AUTO"
              label="Auto-Calculate"
              current={effectiveMode}
              onChange={onModeChange}
            />
            <ModeOption
              value="MANUAL"
              label="Manual-Calculate"
              current={effectiveMode}
              onChange={onModeChange}
              disabled={!manualAllowed}
            />
          </div>

          {!manualAllowed && (
            <p className="text-caption mt-2 text-neutral-dark/60">
              Manual entry is available up to {MANUAL_PIECE_LIMIT} pieces. Above that, weights
              are split automatically.
            </p>
          )}

          {effectiveMode === "AUTO" ? (
            <div className="mt-4 rounded-lg bg-neutral-dark/[0.03] px-4 py-3">
              <p className="text-body text-neutral-dark">
                {dividesEvenly
                  ? `Each of the ${pieceCount} piece${pieceCount === 1 ? "" : "s"} weighs ${centsToGrams(autoSplit[0])} g.`
                  : `${pieceCount - 1} piece${pieceCount - 1 === 1 ? "" : "s"} at ${centsToGrams(autoSplit[0])} g, and the last piece takes ${centsToGrams(lastAuto)} g.`}
              </p>
              <p className="text-caption mt-1 text-neutral-dark/60">
                {dividesEvenly
                  ? `Totals ${centsToGrams(expectedCents)} g.`
                  : `The remainder goes on the last piece so the pieces total exactly ${centsToGrams(expectedCents)} g.`}
              </p>
            </div>
          ) : (
            <div className="mt-4">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
                {weights.map((weight, i) => (
                  <div key={i}>
                    <label
                      htmlFor={`piece-${i + 1}`}
                      className="text-caption mb-1 block font-medium text-neutral-dark/70"
                    >
                      Piece {i + 1}
                    </label>
                    <Input
                      id={`piece-${i + 1}`}
                      name="pieceWeights"
                      type="number"
                      min="0"
                      step="0.01"
                      value={weight}
                      onChange={(e) => onWeightChange(i, e.target.value)}
                      invalid={Boolean(error)}
                    />
                  </div>
                ))}
              </div>

              <div className="mt-3 flex items-center gap-2">
                {allEntered ? (
                  <Badge variant={matches ? "success" : "danger"}>
                    {`Sum ${centsToGrams(runningCents)} g of ${centsToGrams(expectedCents)} g`}
                  </Badge>
                ) : (
                  <span className="text-caption text-neutral-dark/60">
                    {`Sum so far ${centsToGrams(runningCents)} g of ${centsToGrams(expectedCents)} g — ${entered.filter((c) => c === null).length} piece(s) left to enter.`}
                  </span>
                )}
              </div>
            </div>
          )}
        </>
      )}

      {error && <p className="text-caption mt-3 text-danger">{error}</p>}
    </section>
  );
}

// Segmented control built on real radios, so arrow keys and screen readers work without
// re-implementing radio semantics.
function ModeOption({
  value,
  label,
  current,
  onChange,
  disabled,
}: {
  value: PieceMode;
  label: string;
  current: PieceMode;
  onChange: (mode: PieceMode) => void;
  disabled?: boolean;
}) {
  const checked = current === value;
  return (
    <label className={cn("relative", disabled ? "cursor-not-allowed" : "cursor-pointer")}>
      <input
        // The AUTO radio carries the plain field id so a pieceMode error can focus it.
        id={value === "AUTO" ? "pieceMode" : undefined}
        type="radio"
        name="pieceMode"
        value={value}
        checked={checked}
        disabled={disabled}
        onChange={() => onChange(value)}
        className="peer sr-only"
      />
      <span
        className={cn(
          "text-body block rounded-md px-4 py-2 font-medium transition-colors duration-150",
          "peer-focus-visible:ring-2 peer-focus-visible:ring-brand-secondary peer-focus-visible:ring-offset-1",
          checked
            ? "bg-brand-primary text-on-primary"
            : disabled
              ? "text-neutral-dark/35"
              : "text-neutral-dark/70 hover:bg-neutral-dark/5"
        )}
      >
        {label}
      </span>
    </label>
  );
}

// A dropdown over a fixed code-defined list (Source, Hazard Class). A pre-existing value
// outside the list stays selectable so editing an older sample can't silently rewrite it.
// Pass value + onValueChange to drive it from the parent — Source does, because changing
// it re-defaults the shelf location.
function FixedSelectField({
  label,
  name,
  options,
  initialValue,
  error,
  value,
  onValueChange,
  hint,
}: {
  label: string;
  name: string;
  options: string[];
  initialValue?: string;
  error?: string;
  value?: string;
  onValueChange?: (next: string) => void;
  hint?: string;
}) {
  const all =
    initialValue && initialValue.length > 0 && !options.includes(initialValue)
      ? [...options, initialValue]
      : options;

  const controlled = value !== undefined && onValueChange !== undefined;

  return (
    <FormField label={label} htmlFor={name} error={error}>
      <Select
        id={name}
        name={name}
        invalid={Boolean(error)}
        {...(controlled
          ? { value, onChange: (e) => onValueChange(e.target.value) }
          : { defaultValue: initialValue ?? "" })}
      >
        <option value="">Select a {label.toLowerCase()}…</option>
        {all.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </Select>
      {hint && <p className="text-caption mt-1 text-neutral-dark/60">{hint}</p>}
    </FormField>
  );
}

// Backed by an admin-managed reference list. An empty list would otherwise render a
// dropdown with nothing in it and no explanation, so it says what's missing and where
// to fix it instead.
function LookupField({
  label,
  name,
  options,
  error,
  initialValue,
  value,
  onValueChange,
}: {
  label: string;
  name: string;
  options: string[];
  error?: string;
  initialValue?: string;
  // Controlled so a failed submission doesn't blank the selection.
  value?: string;
  onValueChange?: (next: string) => void;
}) {
  // An existing sample may reference a value that has since been removed from the list.
  // Keep it selectable so editing an unrelated field doesn't silently rewrite it.
  const allOptions =
    initialValue && initialValue.length > 0 && !options.includes(initialValue)
      ? [...options, initialValue]
      : options;

  if (allOptions.length === 0) {
    return (
      <div>
        <label htmlFor={name} className="text-body mb-1 block font-medium text-neutral-dark">
          {label}
        </label>
        <Select id={name} name={name} disabled invalid={Boolean(error)}>
          <option value="">No {label.toLowerCase()} values defined</option>
        </Select>
        <p className="text-caption mt-1 text-neutral-dark/60">
          Add {label.toLowerCase()} values in{" "}
          <Link href="/settings/lists" className="underline">
            Reference Lists
          </Link>{" "}
          before creating a sample.
        </p>
        {error && <p className="text-caption mt-1 text-danger">{error}</p>}
      </div>
    );
  }

  const controlled = value !== undefined && onValueChange !== undefined;

  return (
    <FormField label={label} htmlFor={name} error={error}>
      <Select
        id={name}
        name={name}
        invalid={Boolean(error)}
        {...(controlled
          ? { value, onChange: (e) => onValueChange(e.target.value) }
          : { defaultValue: initialValue ?? "" })}
      >
        <option value="">Select a {label.toLowerCase()}…</option>
        {allOptions.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </Select>
    </FormField>
  );
}
