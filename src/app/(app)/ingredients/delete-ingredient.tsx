"use client";

import { ConfirmSubmitButton } from "@/components/confirm-submit-button";

export function DeleteIngredient({
  id,
  name,
  linkedSamples,
  action,
}: {
  id: string;
  name: string;
  linkedSamples: number;
  action: (id: string) => Promise<void>;
}) {
  // Blocked in the action too — this explains why rather than failing silently.
  if (linkedSamples > 0) {
    return (
      <span
        className="text-body cursor-not-allowed text-neutral-dark/30"
        title={`Used by ${linkedSamples} sample${linkedSamples === 1 ? "" : "s"}. Unlink it from those samples before deleting.`}
      >
        Delete
      </span>
    );
  }

  return (
    <form action={action.bind(null, id)}>
      <ConfirmSubmitButton
        confirmMessage={`Delete "${name}"? This cannot be undone.`}
        className="text-body font-medium text-danger hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger/40"
      >
        Delete
      </ConfirmSubmitButton>
    </form>
  );
}
