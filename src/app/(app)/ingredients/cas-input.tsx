"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";

// One INCI name can map to several CAS numbers, so they're entered as labels rather than
// a single text field. Values are submitted as repeated hidden inputs, which keeps the
// committed list independent of whatever is still sitting in the draft box.
export function CasNumberInput({ initial }: { initial: string[] }) {
  const [values, setValues] = useState<string[]>(initial);
  const [draft, setDraft] = useState("");

  function add() {
    const next = draft.trim();
    if (!next) return;
    // Case-insensitive guard so "50-00-0" isn't added twice in different spacing.
    if (!values.some((v) => v.toLowerCase() === next.toLowerCase())) {
      setValues([...values, next]);
    }
    setDraft("");
  }

  function remove(value: string) {
    setValues(values.filter((v) => v !== value));
  }

  return (
    <div>
      <label htmlFor="casDraft" className="text-body mb-1 block font-medium text-neutral-dark">
        CAS Numbers
      </label>

      {values.map((v) => (
        <input key={v} type="hidden" name="casNumbers" value={v} />
      ))}

      <div className="flex items-start gap-2">
        <Input
          id="casDraft"
          value={draft}
          placeholder="e.g. 5989-27-5"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            // Enter adds a label rather than submitting the whole form.
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              add();
            }
          }}
        />
        <button
          type="button"
          onClick={add}
          className="text-body shrink-0 rounded-lg border border-neutral-dark/20 px-3 py-2 font-medium text-neutral-dark transition-colors hover:bg-neutral-dark/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-secondary"
        >
          Add
        </button>
      </div>

      {values.length > 0 ? (
        <ul className="mt-2 flex flex-wrap gap-2">
          {values.map((v) => (
            <li key={v}>
              <span className="text-caption inline-flex items-center gap-1.5 rounded-full bg-brand-soft px-2.5 py-0.5 font-medium text-on-soft">
                {v}
                <button
                  type="button"
                  onClick={() => remove(v)}
                  aria-label={`Remove ${v}`}
                  className="rounded-full leading-none text-on-soft/60 transition-colors hover:text-on-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-secondary"
                >
                  ×
                </button>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-caption mt-1 text-neutral-dark/50">
          None recorded. Add one or more CAS numbers for this INCI name.
        </p>
      )}
    </div>
  );
}
