"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import type { NotificationKind, OverdueNotification } from "@/lib/notifications";

// Grouped by what's late, in the order the work happens: a piece on the shelf floor, then
// the supplier paperwork, then the review that follows it.
const GROUPS: { kind: NotificationKind; label: string }[] = [
  { kind: "CHECKOUT", label: "Checkouts" },
  { kind: "DOCUMENTS", label: "Supplier documents" },
  { kind: "CSS_REVIEW", label: "CSS reviews" },
];

export function NotificationBell({
  items,
  tone = "light",
}: {
  items: OverdueNotification[];
  // "dark" for the charcoal mobile header, "light" for the cream desktop top bar.
  tone?: "light" | "dark";
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const count = items.length;

  useEffect(() => {
    if (!open) return;
    function onPointer(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const label = count === 0 ? "Notifications, nothing overdue" : `Notifications, ${count} overdue`;

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={label}
        title={label}
        aria-expanded={open}
        aria-haspopup="dialog"
        className={cn(
          "relative flex h-10 w-10 items-center justify-center rounded-full transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 active:scale-95",
          tone === "dark"
            ? "text-neutral-light hover:bg-neutral-light/10 focus-visible:ring-neutral-light/40"
            : cn(
                "text-neutral-dark/70 hover:bg-neutral-dark/[0.06] hover:text-neutral-dark focus-visible:ring-neutral-dark/30",
                open && "bg-neutral-dark/[0.06] text-neutral-dark"
              )
        )}
      >
        <svg
          className="h-5 w-5"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M6 16.5V11a6 6 0 1 1 12 0v5.5l1.5 2H4.5Z" />
          <path d="M10 21a2.2 2.2 0 0 0 4 0" />
        </svg>
        {count > 0 && (
          // The ring matches whichever bar the bell sits on, so the dot reads as cut out
          // of the bell rather than pasted over it.
          <span
            aria-hidden="true"
            className={cn(
              "absolute right-2 top-2 h-2.5 w-2.5 rounded-full bg-danger ring-2",
              tone === "dark" ? "ring-neutral-dark" : "ring-neutral-light"
            )}
          />
        )}
      </button>

      <div
        role="dialog"
        aria-label="Overdue items"
        className={cn(
          "absolute right-0 top-12 z-50 w-[min(24rem,calc(100vw-2rem))] origin-top-right overflow-hidden rounded-xl bg-white text-neutral-dark shadow-floating ring-1 ring-neutral-dark/[0.06]",
          "transition-[opacity,transform] duration-200 ease-[cubic-bezier(0.34,1.56,0.64,1)] motion-reduce:transition-none",
          open ? "scale-100 opacity-100" : "pointer-events-none scale-95 opacity-0"
        )}
        // Hidden from the tab order and screen readers while it's only faded out.
        inert={!open}
      >
        <div className="flex items-baseline justify-between gap-3 border-b border-neutral-dark/[0.08] px-5 py-4">
          <h2 className="font-display text-body font-semibold tracking-tight">Overdue</h2>
          <span className="text-caption text-neutral-dark/55">
            {count === 0 ? "All on time" : `${count} past due`}
          </span>
        </div>

        {count === 0 ? (
          <div className="flex items-center gap-3 px-5 py-6">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-success/15 text-brand-secondary">
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="m5 12.5 4.5 4.5L19 7.5" />
              </svg>
            </span>
            <p className="text-body text-neutral-dark/70">Nothing is past its due date.</p>
          </div>
        ) : (
          <div className="max-h-[min(28rem,70vh)] overflow-y-auto pb-2">
            {GROUPS.map(({ kind, label: groupLabel }) => {
              const rows = items.filter((item) => item.kind === kind);
              if (rows.length === 0) return null;
              return (
                <section key={kind} className="pt-3">
                  <h3 className="px-5 pb-1.5 text-caption font-semibold uppercase tracking-wider text-neutral-dark/45">
                    {groupLabel} · {rows.length}
                  </h3>
                  <ul>
                    {rows.map((item) => (
                      <li key={item.id}>
                        <Link
                          href={item.href}
                          onClick={() => setOpen(false)}
                          className="group flex items-start gap-3 px-5 py-2.5 transition-colors duration-150 hover:bg-danger/[0.05] focus-visible:bg-danger/[0.05] focus-visible:outline-none active:bg-danger/10"
                        >
                          {/* Same red left rule the owning screens use on an overdue row. */}
                          <span aria-hidden="true" className="mt-1 h-8 w-[3px] shrink-0 rounded-full bg-danger" />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-body font-medium">{item.title}</span>
                            <span className="block truncate text-caption text-neutral-dark/55">{item.detail}</span>
                          </span>
                          <span className="shrink-0 pt-0.5 text-caption font-semibold text-danger">
                            {item.overdueBy}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
