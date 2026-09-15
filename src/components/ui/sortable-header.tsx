import Link from "next/link";
import { cn } from "@/lib/cn";

// Header sort control, shared by the sample library and ingredient list so both tables
// behave identically. Rendered as a link, so sorting survives back/forward and can be
// bookmarked — no client JS needed.
export function SortableHeader({
  label,
  href,
  active,
  dir,
}: {
  label: string;
  href: string;
  active: boolean;
  dir: "asc" | "desc";
}) {
  return (
    <Link
      href={href}
      className={cn(
        "inline-flex items-center gap-1 rounded transition-colors hover:text-neutral-dark",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-secondary",
        active && "text-neutral-dark"
      )}
      title={`Sort ${label} ${active && dir === "asc" ? "Z→A" : "A→Z"}`}
    >
      {label}
      <span aria-hidden className={active ? "" : "opacity-25"}>
        {active ? (dir === "asc" ? "▲" : "▼") : "▲"}
      </span>
    </Link>
  );
}
