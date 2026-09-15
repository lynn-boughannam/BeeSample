import { cn } from "@/lib/cn";

export const RATING_LABELS: Record<number, string> = {
  5: "Excellent",
  4: "Good",
  3: "Fair",
  2: "Poor",
  1: "Concerning",
};

// Colour comes from the rating value itself, not from the pip's position — a 2/5 shows
// two orange pips, not one red and one orange.
const FILL_BY_VALUE: Record<number, string> = {
  5: "bg-rating-5",
  4: "bg-rating-4",
  3: "bg-rating-3",
  2: "bg-rating-2",
  1: "bg-rating-1",
};

export function RatingPips({
  value,
  className,
}: {
  value: number | null | undefined;
  className?: string;
}) {
  if (value == null) return <span className="text-neutral-dark/40">—</span>;

  const clamped = Math.min(5, Math.max(1, Math.round(value)));
  const label = RATING_LABELS[clamped] ?? "";
  const text = `${clamped}/5 — ${label}`;

  return (
    // tabIndex makes the tooltip reachable by keyboard, not hover-only; aria-label means
    // screen readers get the same sentence rather than five anonymous boxes.
    <span
      className={cn("group relative inline-flex items-center gap-2", className)}
      tabIndex={0}
      role="img"
      aria-label={text}
    >
      <span className="flex items-center gap-0.5" aria-hidden>
        {[1, 2, 3, 4, 5].map((pip) => (
          <span
            key={pip}
            className={cn(
              "h-3 w-3 rounded-[2px]",
              pip <= clamped
                ? FILL_BY_VALUE[clamped]
                : "border border-neutral-dark/25 bg-transparent"
            )}
          />
        ))}
      </span>

      <span className="text-caption tabular-nums text-neutral-dark/70" aria-hidden>
        {clamped}/5
      </span>

      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-0 z-30 mb-1 hidden whitespace-nowrap rounded-md bg-neutral-dark px-2 py-1 text-caption text-neutral-light shadow-floating group-hover:block group-focus-visible:block"
      >
        {text}
      </span>
    </span>
  );
}
