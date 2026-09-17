"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { FormField, Input, Select } from "@/components/ui/input";
import { ORDER_STATUSES } from "@/lib/types";
import { ORDER_REQUEST_TYPES, ORDER_REQUEST_TYPE_LABELS } from "@/lib/orders";

// Filters live in the URL, so a filtered view is shareable and survives a refresh — the
// same reason the Library table keeps its state there.
export function OrderFilters({
  q,
  type,
  status,
}: {
  q: string;
  type: string;
  status: string;
}) {
  const router = useRouter();
  const [search, setSearch] = useState(q);

  function go(next: { q?: string; type?: string; status?: string }) {
    const params = new URLSearchParams();
    const merged = { q: search, type, status, ...next };
    if (merged.q?.trim()) params.set("q", merged.q.trim());
    if (merged.type) params.set("type", merged.type);
    if (merged.status) params.set("status", merged.status);
    router.push(params.toString() ? `/orders?${params}` : "/orders");
  }

  const isFiltered = Boolean(q || type || status);

  return (
    <section className="rounded-lg border border-neutral-dark/10 bg-white p-4 shadow-elevated">
      <form
        className="flex flex-wrap items-end gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          go({});
        }}
      >
        <div className="min-w-[16rem] flex-1">
          <FormField label="Search" htmlFor="orderSearch">
            <Input
              id="orderSearch"
              type="search"
              value={search}
              placeholder="INCI, sample, supplier, project, requester…"
              onChange={(e) => setSearch(e.target.value)}
            />
          </FormField>
        </div>

        {/* Changing a dropdown applies immediately; the search box waits for Enter or the
            button, so typing doesn't fire a query per keystroke. */}
        <FormField label="Type" htmlFor="orderType">
          <Select
            id="orderType"
            value={type}
            onChange={(e) => go({ type: e.target.value })}
          >
            <option value="">All types</option>
            {ORDER_REQUEST_TYPES.map((t) => (
              <option key={t} value={t}>
                {ORDER_REQUEST_TYPE_LABELS[t]}
              </option>
            ))}
          </Select>
        </FormField>

        <FormField label="Status" htmlFor="orderStatus">
          <Select
            id="orderStatus"
            value={status}
            onChange={(e) => go({ status: e.target.value })}
          >
            <option value="">All statuses</option>
            {ORDER_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
        </FormField>

        <div className="flex gap-2 pb-1">
          <Button type="submit">Search</Button>
          {isFiltered && (
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setSearch("");
                router.push("/orders");
              }}
            >
              Clear
            </Button>
          )}
        </div>
      </form>
    </section>
  );
}
