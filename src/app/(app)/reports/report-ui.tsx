import Link from "next/link";
import type { Slice } from "@/lib/reports";

// Shared furniture for the report views. The deck's layout — KPIs, then charts, then a
// short findings block — is kept because it reads well: the numbers first, the shape of
// them second, the sentence you'd actually repeat in a meeting last.

export function ReportHeading({
  title,
  subtitle,
  generatedAt,
}: {
  title: string;
  subtitle: string;
  generatedAt: Date;
}) {
  return (
    <div>
      <h1 className="text-page-title text-neutral-dark">{title}</h1>
      <p className="text-body mt-1 text-neutral-dark/60">{subtitle}</p>
      {/* A report is a snapshot of a library that keeps moving; without a timestamp these
          numbers end up in a deck six months later looking current. */}
      <p className="text-caption mt-1 text-neutral-dark/45">
        Generated {generatedAt.toISOString().slice(0, 16).replace("T", " ")}
      </p>
    </div>
  );
}

export function KpiRow({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{children}</div>;
}

export function Kpi({
  value,
  label,
  detail,
  tone,
}: {
  value: string;
  label: string;
  detail?: string;
  tone?: "danger" | "warning";
}) {
  return (
    <div className="rounded-lg border border-neutral-dark/10 bg-white p-4 shadow-elevated">
      <p
        className={`text-page-title ${
          tone === "danger" ? "text-danger" : tone === "warning" ? "text-warning" : "text-neutral-dark"
        }`}
      >
        {value}
      </p>
      <p className="text-caption mt-1 font-medium text-neutral-dark/70">{label}</p>
      {detail && <p className="text-caption mt-0.5 text-neutral-dark/45">{detail}</p>}
    </div>
  );
}

export function Card({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-neutral-dark/10 bg-white p-5 shadow-elevated">
      <h2 className="text-section-header text-neutral-dark">{title}</h2>
      {hint && <p className="text-caption mt-0.5 mb-3 text-neutral-dark/55">{hint}</p>}
      <div className={hint ? "" : "mt-3"}>{children}</div>
    </section>
  );
}

// Horizontal bars rather than a pie: a category split with a long tail is far easier to
// read down a list than around a circle, and the labels have room to be legible.
export function BarChart({
  slices,
  colorHex = "var(--color-brand-secondary)",
  valueSuffix = "",
}: {
  slices: Slice[];
  colorHex?: string;
  valueSuffix?: string;
}) {
  if (slices.length === 0) return <Empty>Nothing to chart yet.</Empty>;
  const max = Math.max(...slices.map((s) => s.count), 1);

  return (
    <ul className="space-y-2">
      {slices.map((slice) => (
        <li key={slice.label} className="grid grid-cols-[10rem_1fr_auto] items-center gap-3">
          <span className="text-caption truncate text-neutral-dark/70" title={slice.label}>
            {slice.label}
          </span>
          <span className="h-4 overflow-hidden rounded-sm bg-neutral-dark/8">
            <span
              className="block h-full rounded-sm"
              style={{ width: `${(slice.count / max) * 100}%`, backgroundColor: colorHex }}
            />
          </span>
          <span className="text-caption tabular-nums text-neutral-dark">
            {slice.count}
            {valueSuffix}{" "}
            <span className="text-neutral-dark/45">({slice.percent.toFixed(1)}%)</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

// Two bars per row, sharing one scale, so the pair can be read across.
export function PairedBarChart({
  rows,
  leftLabel,
  rightLabel,
}: {
  rows: Array<{ label: string; leftValue: number; rightValue: number; rightPercent: number }>;
  leftLabel: string;
  rightLabel: string;
}) {
  if (rows.length === 0) return <Empty>Nothing to chart yet.</Empty>;
  const maxLeft = Math.max(...rows.map((r) => r.leftValue), 1);

  return (
    <div>
      <div className="text-caption mb-2 grid grid-cols-[8rem_1fr_1fr] gap-3 text-neutral-dark/50">
        <span />
        <span>{leftLabel}</span>
        <span>{rightLabel}</span>
      </div>
      <ul className="space-y-2">
        {rows.map((row) => (
          <li key={row.label} className="grid grid-cols-[8rem_1fr_1fr] items-center gap-3">
            <span className="text-caption truncate text-neutral-dark/70" title={row.label}>
              {row.label}
            </span>
            <span className="flex items-center gap-2">
              <span className="h-4 flex-1 overflow-hidden rounded-sm bg-neutral-dark/8">
                <span
                  className="block h-full rounded-sm bg-brand-secondary"
                  style={{ width: `${(row.leftValue / maxLeft) * 100}%` }}
                />
              </span>
              <span className="text-caption w-8 tabular-nums text-neutral-dark">
                {row.leftValue}
              </span>
            </span>
            <span className="flex items-center gap-2">
              {/* Percentages share a fixed 0-100 scale, so a tall bar always means a high
                  rate rather than "highest among these". */}
              <span className="h-4 flex-1 overflow-hidden rounded-sm bg-neutral-dark/8">
                <span
                  className="block h-full rounded-sm bg-brand-primary"
                  style={{ width: `${row.rightPercent}%` }}
                />
              </span>
              <span className="text-caption w-12 tabular-nums text-neutral-dark">
                {row.rightPercent.toFixed(1)}%
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// Two cohorts per category, stacked, so the shape of an older intake can be compared with
// a recent one.
export function StackedCohortChart({
  rows,
  olderLabel,
  recentLabel,
}: {
  rows: Array<{ category: string; olderCount: number; recentCount: number }>;
  olderLabel: string;
  recentLabel: string;
}) {
  if (rows.length === 0) return <Empty>Nothing to chart yet.</Empty>;
  const max = Math.max(...rows.map((r) => r.olderCount + r.recentCount), 1);

  return (
    <div>
      <ul className="space-y-2">
        {rows.map((row) => {
          return (
            <li key={row.category} className="grid grid-cols-[8rem_1fr_auto] items-center gap-3">
              <span className="text-caption truncate text-neutral-dark/70">{row.category}</span>
              <span className="flex h-4 overflow-hidden rounded-sm bg-neutral-dark/8">
                <span
                  className="block h-full bg-danger"
                  style={{ width: `${(row.olderCount / max) * 100}%` }}
                />
                <span
                  className="block h-full bg-info"
                  style={{ width: `${(row.recentCount / max) * 100}%` }}
                />
              </span>
              <span className="text-caption tabular-nums text-neutral-dark/70">
                {row.olderCount} / {row.recentCount}
              </span>
            </li>
          );
        })}
      </ul>
      <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-2">
        {[
          [olderLabel, "bg-danger"],
          [recentLabel, "bg-info"],
        ].map(([label, cls]) => (
          <li key={label} className="flex items-center gap-2">
            <span aria-hidden className={`h-2.5 w-2.5 rounded-full ${cls}`} />
            <span className="text-caption text-neutral-dark/70">{label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Findings({ children }: { children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-brand-soft bg-brand-soft/25 p-5">
      <h2 className="text-section-header mb-2 text-neutral-dark">Key findings</h2>
      <ul className="space-y-2">{children}</ul>
    </section>
  );
}

export function Finding({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <li className="text-body text-neutral-dark/85">
      <span className="font-semibold text-neutral-dark">{label}:</span> {children}
    </li>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-body text-neutral-dark/50">{children}</p>;
}

export function ReportTabs({ active }: { active: string }) {
  const tabs = [
    { key: "library", label: "Library status", href: "/reports/library" },
    { key: "expiry", label: "Expiry", href: "/reports/expiry" },
    { key: "category", label: "Category deep-dive", href: "/reports/category" },
  ];

  return (
    <nav className="flex flex-wrap gap-2 border-b border-neutral-dark/10 pb-px">
      {tabs.map((tab) => (
        <Link
          key={tab.key}
          href={tab.href}
          aria-current={active === tab.key ? "page" : undefined}
          className={`text-body rounded-t-md px-4 py-2 transition-colors duration-150 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-primary ${
            active === tab.key
              ? "border-b-2 border-brand-secondary font-semibold text-neutral-dark"
              : "text-neutral-dark/60 hover:bg-neutral-dark/[0.03]"
          }`}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
