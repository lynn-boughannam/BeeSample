"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { FormField, Input, Select, Textarea } from "@/components/ui/input";
import { CasNumberInput } from "./cas-input";
import {
  BIODEGRADABILITY,
  BIODEGRADABILITY_LABELS,
  RATINGS,
  TRISTATE,
  TRISTATE_LABELS,
  fromBool,
  type Biodegradability,
  type Tristate,
} from "@/lib/ingredients";

export type IngredientFormState =
  | { fieldErrors?: Record<string, string>; formError?: string }
  | undefined;

export type IngredientInitial = {
  id: string;
  uid: string | null;
  inciName: string;
  molecularFormula: string | null;
  molecularWeight: string | null;
  chemicalFamily: string | null;
  casNumbers: string[];
  regulatoryFunction: string | null;
  euRegulation: boolean | null;
  euAnnex: string | null;
  restriction: string | null;
  euOpinion: string | null;
  chinaListed: boolean | null;
  endocrineDisruptor: string | null;
  cmr: string | null;
  dermalAbsorption: string | null;
  noael: string | null;
  biodegradability: string | null;
  pbt: boolean | null;
  aquaticToxicity: boolean | null;
  aquaticHazardStatements: string | null;
  yukaRating: number | null;
  inciBeautyRating: number | null;
  beeslineRating: number | null;
  comments: string | null;
};

export function IngredientForm({
  action,
  chemicalFamilies,
  regulatoryFunctions,
  initial,
  submitLabel,
}: {
  action: (prev: IngredientFormState, fd: FormData) => Promise<IngredientFormState>;
  chemicalFamilies: string[];
  regulatoryFunctions: string[];
  initial?: IngredientInitial;
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);
  const errors = state?.fieldErrors ?? {};
  const v = initial;

  return (
    <form action={formAction} className="space-y-6">
      {v && <input type="hidden" name="id" value={v.id} />}

      <Section title="Identification">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <FormField label="INCI Name" htmlFor="inciName" error={errors.inciName}>
            <Input
              id="inciName"
              name="inciName"
              defaultValue={v?.inciName ?? ""}
              invalid={Boolean(errors.inciName)}
            />
          </FormField>

          <CasNumberInput initial={v?.casNumbers ?? []} />

          <FormField label="Molecular Formula" htmlFor="molecularFormula" error={errors.molecularFormula}>
            <Input
              id="molecularFormula"
              name="molecularFormula"
              placeholder="e.g. C10H16"
              defaultValue={v?.molecularFormula ?? ""}
            />
          </FormField>

          <FormField label="Molecular Weight" htmlFor="molecularWeight" error={errors.molecularWeight}>
            <Input
              id="molecularWeight"
              name="molecularWeight"
              placeholder="e.g. 358.56 g/mol"
              defaultValue={v?.molecularWeight ?? ""}
            />
          </FormField>

          <ListField
            label="Chemical Family"
            name="chemicalFamily"
            options={chemicalFamilies}
            initialValue={v?.chemicalFamily}
            error={errors.chemicalFamily}
          />

          <ListField
            label="Regulatory Function"
            name="regulatoryFunction"
            options={regulatoryFunctions}
            initialValue={v?.regulatoryFunction}
            error={errors.regulatoryFunction}
          />
        </div>
      </Section>

      <Section title="Regulatory status">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <YesNoField
            label="EU Regulation"
            name="euRegulation"
            initialValue={fromBool(v?.euRegulation)}
            error={errors.euRegulation}
          />
          <YesNoField
            label="China Listed"
            name="chinaListed"
            initialValue={fromBool(v?.chinaListed)}
            error={errors.chinaListed}
          />

          <FormField label="EU Annex" htmlFor="euAnnex" error={errors.euAnnex}>
            <Input
              id="euAnnex"
              name="euAnnex"
              placeholder='"No", or the annex reference'
              defaultValue={v?.euAnnex ?? ""}
            />
          </FormField>

          <FormField label="Restriction" htmlFor="restriction" error={errors.restriction}>
            <Input
              id="restriction"
              name="restriction"
              placeholder='"No", or the restriction'
              defaultValue={v?.restriction ?? ""}
            />
          </FormField>

          <FormField label="EU Opinion" htmlFor="euOpinion" error={errors.euOpinion}>
            <Input
              id="euOpinion"
              name="euOpinion"
              placeholder="Yes / No / reference"
              defaultValue={v?.euOpinion ?? ""}
            />
          </FormField>
        </div>
      </Section>

      <Section title="Toxicology">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <TristateField
            label="Endocrine Disruptor"
            name="endocrineDisruptor"
            initialValue={v?.endocrineDisruptor}
            error={errors.endocrineDisruptor}
          />
          <TristateField label="CMR" name="cmr" initialValue={v?.cmr} error={errors.cmr} />

          <FormField
            label="Dermal Absorption (DAP)"
            htmlFor="dermalAbsorption"
            error={errors.dermalAbsorption}
          >
            <Input
              id="dermalAbsorption"
              name="dermalAbsorption"
              defaultValue={v?.dermalAbsorption ?? ""}
            />
          </FormField>

          <FormField label="NOAEL (mg/kg bw/day)" htmlFor="noael" error={errors.noael}>
            <Input id="noael" name="noael" defaultValue={v?.noael ?? ""} />
          </FormField>
        </div>
      </Section>

      <Section title="Environmental">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <FormField label="Biodegradability" htmlFor="biodegradability" error={errors.biodegradability}>
            <Select
              id="biodegradability"
              name="biodegradability"
              defaultValue={v?.biodegradability ?? ""}
            >
              <option value="">Not recorded</option>
              {BIODEGRADABILITY.map((b) => (
                <option key={b} value={b}>
                  {BIODEGRADABILITY_LABELS[b as Biodegradability]}
                </option>
              ))}
            </Select>
          </FormField>

          <YesNoField label="PBT" name="pbt" initialValue={fromBool(v?.pbt)} error={errors.pbt} />

          <YesNoField
            label="Aquatic Toxicity"
            name="aquaticToxicity"
            initialValue={fromBool(v?.aquaticToxicity)}
            error={errors.aquaticToxicity}
          />

          <FormField
            label="Aquatic Toxicity — Hazard Statements"
            htmlFor="aquaticHazardStatements"
            error={errors.aquaticHazardStatements}
          >
            <Input
              id="aquaticHazardStatements"
              name="aquaticHazardStatements"
              placeholder="e.g. H411"
              defaultValue={v?.aquaticHazardStatements ?? ""}
            />
          </FormField>
        </div>
      </Section>

      <Section title="Ratings">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <RatingField label="YUKA Rating" name="yukaRating" initialValue={v?.yukaRating} error={errors.yukaRating} />
          <RatingField
            label="INCI Beauty Rating"
            name="inciBeautyRating"
            initialValue={v?.inciBeautyRating}
            error={errors.inciBeautyRating}
          />
          <RatingField
            label="Beesline Rating"
            name="beeslineRating"
            initialValue={v?.beeslineRating}
            error={errors.beeslineRating}
          />
        </div>
      </Section>

      <Section title="Comments">
        <FormField label="Comments" htmlFor="comments" error={errors.comments}>
          <Textarea id="comments" name="comments" rows={4} defaultValue={v?.comments ?? ""} />
        </FormField>
      </Section>

      {state?.formError && <p className="text-body text-danger">{state.formError}</p>}

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : submitLabel}
        </Button>
        <Link href="/ingredients" className="text-body font-medium text-neutral-dark/60 hover:underline">
          Cancel
        </Link>
        {!v && (
          <span className="text-caption text-neutral-dark/60">
            A UID is assigned automatically on save.
          </span>
        )}
      </div>
    </form>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-neutral-dark/10 bg-white p-5 shadow-elevated">
      <h2 className="text-section-header mb-4 text-neutral-dark">{title}</h2>
      {children}
    </section>
  );
}

function YesNoField({
  label,
  name,
  initialValue,
  error,
}: {
  label: string;
  name: string;
  initialValue: string;
  error?: string;
}) {
  return (
    <FormField label={label} htmlFor={name} error={error}>
      <Select id={name} name={name} defaultValue={initialValue} invalid={Boolean(error)}>
        <option value="">Not recorded</option>
        <option value="YES">Yes</option>
        <option value="NO">No</option>
      </Select>
    </FormField>
  );
}

function TristateField({
  label,
  name,
  initialValue,
  error,
}: {
  label: string;
  name: string;
  initialValue?: string | null;
  error?: string;
}) {
  return (
    <FormField label={label} htmlFor={name} error={error}>
      <Select id={name} name={name} defaultValue={initialValue ?? ""} invalid={Boolean(error)}>
        <option value="">Not recorded</option>
        {TRISTATE.map((t) => (
          <option key={t} value={t}>
            {TRISTATE_LABELS[t as Tristate]}
          </option>
        ))}
      </Select>
    </FormField>
  );
}

function RatingField({
  label,
  name,
  initialValue,
  error,
}: {
  label: string;
  name: string;
  initialValue?: number | null;
  error?: string;
}) {
  return (
    <FormField label={label} htmlFor={name} error={error}>
      <Select
        id={name}
        name={name}
        defaultValue={initialValue != null ? String(initialValue) : ""}
        invalid={Boolean(error)}
      >
        <option value="">Not rated</option>
        {RATINGS.map((r) => (
          <option key={r} value={r}>
            {r} / 5
          </option>
        ))}
      </Select>
    </FormField>
  );
}

// Backed by an admin-managed reference list, with any pre-existing value kept selectable
// so editing an unrelated field can't silently rewrite it.
function ListField({
  label,
  name,
  options,
  initialValue,
  error,
}: {
  label: string;
  name: string;
  options: string[];
  initialValue?: string | null;
  error?: string;
}) {
  const all =
    initialValue && !options.includes(initialValue) ? [...options, initialValue] : options;

  return (
    <FormField label={label} htmlFor={name} error={error}>
      <Select id={name} name={name} defaultValue={initialValue ?? ""} invalid={Boolean(error)}>
        <option value="">Not recorded</option>
        {all.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </Select>
      {options.length === 0 && (
        <p className="text-caption mt-1 text-neutral-dark/60">
          No values defined yet — add them in{" "}
          <Link href="/settings/lists" className="underline">
            Reference Lists
          </Link>
          .
        </p>
      )}
    </FormField>
  );
}
