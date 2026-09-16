"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { FormField, Input, Select } from "@/components/ui/input";

// Filters live in the URL so a filtered report is shareable — the same reason the Library
// table keeps its state there.
export function ReportFilters({
  basePath,
  from,
  to,
  splitYear,
  category,
  categories,
  rangeLabel,
}: {
  basePath: string;
  from: string;
  to: string;
  // Only the expiry report splits into cohorts.
  splitYear?: number;
  // Only the deep-dive picks a category.
  category?: string;
  categories?: readonly string[];
  rangeLabel: string;
}) {
  const router = useRouter();
  const [fromValue, setFromValue] = useState(from);
  const [toValue, setToValue] = useState(to);
  const [splitValue, setSplitValue] = useState(splitYear ? String(splitYear) : "");
  const [categoryValue, setCategoryValue] = useState(category ?? "");

  function apply() {
    const params = new URLSearchParams();
    if (fromValue) params.set("from", fromValue);
    if (toValue) params.set("to", toValue);
    if (splitYear !== undefined && splitValue) params.set("split", splitValue);
    if (categories && categoryValue) params.set("c", categoryValue);
    router.push(params.toString() ? `${basePath}?${params}` : basePath);
  }

  function clear() {
    setFromValue("");
    setToValue("");
    // The category is what the deep-dive is *about*, so clearing the range leaves it alone.
    const params = new URLSearchParams();
    if (categories && categoryValue) params.set("c", categoryValue);
    if (splitYear !== undefined && splitValue) params.set("split", splitValue);
    router.push(params.toString() ? `${basePath}?${params}` : basePath);
  }

  return (
    <section className="rounded-lg border border-neutral-dark/10 bg-white p-4 shadow-elevated">
      <div className="flex flex-wrap items-end gap-4">
        {categories && (
          <FormField label="Category" htmlFor="report-category">
            <Select
              id="report-category"
              value={categoryValue}
              onChange={(e) => setCategoryValue(e.target.value)}
            >
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </FormField>
        )}

        <FormField label={`${rangeLabel} — from`} htmlFor="report-from">
          <Input
            id="report-from"
            type="date"
            value={fromValue}
            onChange={(e) => setFromValue(e.target.value)}
          />
        </FormField>
        <FormField label="to" htmlFor="report-to">
          <Input
            id="report-to"
            type="date"
            value={toValue}
            onChange={(e) => setToValue(e.target.value)}
          />
        </FormField>

        {splitYear !== undefined && (
          <FormField label="Cohort split year" htmlFor="report-split">
            <Input
              id="report-split"
              type="number"
              min="1900"
              max="2200"
              value={splitValue}
              onChange={(e) => setSplitValue(e.target.value)}
            />
          </FormField>
        )}

        <div className="flex gap-2 pb-1">
          <Button type="button" onClick={apply}>
            Apply
          </Button>
          <Button type="button" variant="secondary" onClick={clear}>
            Clear dates
          </Button>
        </div>
      </div>
      <p className="text-caption mt-2 text-neutral-dark/50">
        Leave the dates empty to report on the whole library.
      </p>
    </section>
  );
}
