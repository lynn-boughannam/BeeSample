"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { cn } from "@/lib/cn";
import { clearTableView, saveTableView } from "@/app/(app)/table-view-actions";

type Option = { key: string; label: string };

function sameSelection(a: string[], b: string[] | null) {
  if (!b || a.length !== b.length) return false;
  const other = new Set(b);
  return a.every((key) => other.has(key));
}

// Current search params are passed in from the server rather than read with
// useSearchParams, so this component doesn't force a Suspense boundary on the page.
export function ColumnPicker({
  options,
  visibleKeys,
  defaultKeys,
  params,
  basePath,
  tableKey,
  savedKeys,
}: {
  options: Option[];
  visibleKeys: string[];
  defaultKeys: string[];
  params: Record<string, string | undefined>;
  // Which table this picker drives — the same component serves the sample library and
  // the ingredient list.
  basePath: string;
  tableKey: string;
  // The layout this user has saved for this table, or null if they haven't saved one.
  savedKeys: string[] | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>(visibleKeys);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => setSelected(visibleKeys), [visibleKeys]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function apply(next: string[]) {
    setSelected(next);
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v) sp.set(k, v);
    }
    // An empty selection would render a table with no columns, so it falls back to the
    // defaults instead of an unusable view.
    if (next.length === 0) sp.delete("cols");
    else sp.set("cols", next.join(","));
    router.push(`${basePath}?${sp.toString()}`);
  }

  function toggle(key: string) {
    apply(selected.includes(key) ? selected.filter((k) => k !== key) : [...selected, key]);
  }

  const matchesSaved = sameSelection(selected, savedKeys);

  function save() {
    setError(null);
    startTransition(async () => {
      const result = await saveTableView(tableKey, selected.join(","));
      if (!result.ok) setError(result.error);
      // Refreshes the server component so savedKeys reflects what was just written.
      else router.refresh();
    });
  }

  function clear() {
    setError(null);
    startTransition(async () => {
      const result = await clearTableView(tableKey);
      if (!result.ok) setError(result.error);
      else router.refresh();
    });
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="text-body inline-flex items-center gap-2 rounded-lg border border-neutral-dark/20 px-3 py-2 font-medium text-neutral-dark transition-colors hover:bg-neutral-dark/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-secondary"
      >
        Columns
        <span className="text-caption text-neutral-dark/50">
          {selected.length}/{options.length}
        </span>
      </button>

      {open && (
        <div className="absolute right-0 z-20 mt-1 w-72 rounded-lg border border-neutral-dark/10 bg-white p-2 shadow-floating">
          <ul className="max-h-80 overflow-y-auto">
            {options.map((o) => (
              <li key={o.key}>
                <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-neutral-dark/[0.04]">
                  <input
                    type="checkbox"
                    checked={selected.includes(o.key)}
                    onChange={() => toggle(o.key)}
                    className="h-4 w-4 rounded border-neutral-dark/30"
                  />
                  <span className="text-body text-neutral-dark">{o.label}</span>
                </label>
              </li>
            ))}
          </ul>

          <div className="mt-1 flex items-center justify-between border-t border-neutral-dark/10 px-2 pt-2">
            <button
              type="button"
              onClick={() => apply(defaultKeys)}
              className="text-caption font-medium text-neutral-dark/60 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-secondary"
            >
              Reset to default
            </button>
            <button
              type="button"
              onClick={() => apply(options.map((o) => o.key))}
              className="text-caption font-medium text-neutral-dark/60 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-secondary"
            >
              Show all
            </button>
          </div>

          <div className="mt-2 space-y-1.5 border-t border-neutral-dark/10 px-2 pt-2">
            <button
              type="button"
              onClick={save}
              disabled={pending || matchesSaved || selected.length === 0}
              className={cn(
                "text-body w-full rounded-lg px-3 py-2 font-medium transition-[transform,opacity] duration-150",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-secondary focus-visible:ring-offset-1",
                matchesSaved || selected.length === 0
                  ? "cursor-not-allowed bg-neutral-dark/[0.06] text-neutral-dark/55"
                  : "bg-brand-primary text-on-primary hover:brightness-95 active:scale-[0.98] disabled:opacity-60"
              )}
            >
              {pending
                ? "Saving…"
                : matchesSaved
                  ? "Saved as your default"
                  : savedKeys
                    ? "Update my default"
                    : "Save as my default"}
            </button>

            {/* The explainer only earns its place before anything is saved. Once a layout
                exists the button itself says so, and repeating it is just noise. */}
            {error ? (
              <p className="text-caption text-danger">{error}</p>
            ) : savedKeys ? null : (
              <p className="text-caption text-neutral-dark/50">
                Loads automatically next time you open this table.
              </p>
            )}

            {savedKeys && (
              <button
                type="button"
                onClick={clear}
                disabled={pending}
                className="text-caption font-medium text-neutral-dark/60 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-secondary disabled:opacity-50"
              >
                Clear saved layout
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
