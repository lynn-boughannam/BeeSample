import Link from "next/link";
import { formatDay as day } from "@/lib/dates";
import { loadAdminDashboard, type ActivityKind, type CategoryBar } from "@/lib/dashboard";
import { CheckoutSince, checkoutRowClass } from "@/components/checkout-since";

// SLT-59. Five sections, all fed from loadAdminDashboard() so the page itself holds no
// query logic and the numbers are verifiable without rendering.


// KPI destinations. Library filters are US-8.2's job; where a filter doesn't exist yet the
// tile still leads somewhere useful rather than nowhere.
type Kpi = { label: string; value: number; href: string; tone?: "warning" | "danger" };

const ACTIVITY_ICON: Record<ActivityKind, string> = {
  RECEIPT: "↓",
  CHECKOUT: "→",
  RETURN_USAGE: "←",
  DISCARD: "×",
  MOVE: "⇄",
  REQUEST: "?",
  ORDER: "+",
  PR: "#",
  FEEDBACK: "★",
};

const ACTIVITY_TONE: Record<ActivityKind, string> = {
  RECEIPT: "bg-success/15 text-on-success",
  CHECKOUT: "bg-warning/20 text-neutral-dark",
  RETURN_USAGE: "bg-info/15 text-neutral-dark",
  DISCARD: "bg-danger/10 text-danger",
  MOVE: "bg-neutral-dark/8 text-neutral-dark",
  REQUEST: "bg-brand-soft/40 text-neutral-dark",
  ORDER: "bg-brand-primary/25 text-neutral-dark",
  PR: "bg-neutral-dark/8 text-neutral-dark",
  FEEDBACK: "bg-brand-soft/40 text-neutral-dark",
};

export async function AdminDashboard() {
  const { kpis, stockHealth, byCategory, checkedOut, activity } = await loadAdminDashboard();

  const tiles: Kpi[] = [
    { label: "Total Samples", value: kpis.totalSamples, href: "/library" },
    { label: "Zero Stock", value: kpis.zeroStock, href: "/library?stock=ZERO", tone: "danger" },
    { label: "Discarded Samples", value: kpis.discardedSamples, href: "/library?discarded=1" },
    { label: "Sample Requests", value: kpis.pendingRequests, href: "/requests" },
    { label: "Checked Out", value: kpis.checkedOut, href: "/checked-out" },
    { label: "New Orders", value: kpis.newOrders, href: "/orders" },
    { label: "Orders in Progress", value: kpis.ordersInProgress, href: "/orders" },
    { label: "Feedback Due", value: kpis.feedbackDue, href: "/pending-feedback" },
  ];

  return (
    <div className="space-y-6">
      <h1 className="text-page-title text-neutral-dark">Dashboard</h1>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {tiles.map((tile) => (
          <Link
            key={tile.label}
            href={tile.href}
            className="rounded-lg border border-neutral-dark/10 bg-white p-4 shadow-elevated transition-transform duration-150 hover:-translate-y-0.5 focus-visible:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-primary"
          >
            <p className="text-caption font-medium text-neutral-dark/60">{tile.label}</p>
            <p
              className={`text-page-title mt-1 ${
                tile.tone === "danger" && tile.value > 0
                  ? "text-danger"
                  : tile.tone === "warning" && tile.value > 0
                    ? "text-warning"
                    : "text-neutral-dark"
              }`}
            >
              {tile.value}
            </p>
          </Link>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card title="Stock health">
          {stockHealth.total === 0 ? (
            <Empty>No samples in the library yet.</Empty>
          ) : (
            <>
              {/* One strip, proportional. Zero-width segments are skipped so a 0 count
                  never shows as a sliver of colour. */}
              <div className="flex h-3 w-full overflow-hidden rounded-full bg-neutral-dark/8">
                {(
                  [
                    ["healthy", stockHealth.healthy, "var(--color-success)"],
                    ["zero", stockHealth.zero, "var(--color-danger)"],
                  ] as const
                )
                  .filter(([, count]) => count > 0)
                  .map(([key, count, color]) => (
                    <span
                      key={key}
                      style={{
                        width: `${(count / stockHealth.total) * 100}%`,
                        backgroundColor: color,
                      }}
                    />
                  ))}
              </div>
              <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-2">
                {(
                  [
                    ["Healthy", stockHealth.healthy, "var(--color-success)"],
                    ["Zero", stockHealth.zero, "var(--color-danger)"],
                  ] as const
                ).map(([label, count, color]) => (
                  <li key={label} className="flex items-center gap-2">
                    <span
                      aria-hidden
                      className="h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: color }}
                    />
                    <span className="text-caption text-neutral-dark/70">
                      {label} · <span className="font-semibold text-neutral-dark">{count}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>

        <Card title="Samples by category">
          {byCategory.length === 0 ? (
            <Empty>No samples to chart yet.</Empty>
          ) : (
            <CategoryChart bars={byCategory} />
          )}
        </Card>
      </div>

      <Card title="Who has what — currently checked out">
        {checkedOut.length === 0 ? (
          <Empty>Nothing is checked out right now.</Empty>
        ) : (
          <ul className="space-y-4">
            {checkedOut.map((group) => (
              <li key={group.formulatorName}>
                <p className="text-body mb-1.5 font-semibold text-neutral-dark">
                  {group.formulatorName}
                  <span className="text-caption ml-2 font-normal text-neutral-dark/50">
                    {group.pieces.length} piece{group.pieces.length === 1 ? "" : "s"}
                  </span>
                </p>
                <ul className="divide-y divide-neutral-dark/8 rounded-md border border-neutral-dark/10">
                  {group.pieces.map((piece) => (
                    <li key={piece.pieceId}>
                      <Link
                        href={`/library/${piece.sampleId}`}
                        className={`flex flex-wrap items-baseline gap-x-3 gap-y-1 px-3 py-2 transition-colors duration-150 hover:bg-neutral-dark/[0.03] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-primary ${checkoutRowClass(piece.since)}`}
                      >
                        <span className="text-body font-medium text-neutral-dark">
                          {piece.sampleCode}
                        </span>
                        <span className="text-body text-neutral-dark/80">{piece.rmName}</span>
                        <span className="text-caption text-neutral-dark/50">
                          piece #{piece.pieceIndex}
                        </span>
                        <span className="text-caption ml-auto text-neutral-dark/70">
                          {piece.remainingWeightG} g
                        </span>
                        <CheckoutSince checkedOutAt={piece.since} />
                      </Link>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Recent activity">
        {activity.length === 0 ? (
          <Empty>Nothing has happened yet.</Empty>
        ) : (
          <ul className="divide-y divide-neutral-dark/8">
            {activity.map((entry) => (
              <li key={entry.id} className="flex items-baseline gap-3 py-2">
                <span
                  aria-hidden
                  className={`text-caption flex h-6 w-6 shrink-0 items-center justify-center rounded-full font-semibold ${ACTIVITY_TONE[entry.kind]}`}
                >
                  {ACTIVITY_ICON[entry.kind]}
                </span>
                <span className="text-body min-w-0 flex-1 text-neutral-dark/85">
                  {entry.href ? (
                    <Link
                      href={entry.href}
                      className="hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-primary"
                    >
                      {entry.description}
                    </Link>
                  ) : (
                    entry.description
                  )}
                </span>
                <span className="text-caption shrink-0 text-neutral-dark/50">{day(entry.at)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function CategoryChart({ bars }: { bars: CategoryBar[] }) {
  // Bars are scaled against the largest count, so the biggest category fills the track and
  // the rest stay readable relative to it.
  const max = Math.max(...bars.map((b) => b.count));

  return (
    <ul className="space-y-2">
      {bars.map((bar) => (
        <li key={bar.category} className="flex items-center gap-3">
          <span className="text-caption w-28 shrink-0 truncate text-neutral-dark/70">
            {bar.category}
          </span>
          <span className="h-4 flex-1 overflow-hidden rounded-sm bg-neutral-dark/6">
            <span
              className="block h-full rounded-sm"
              style={{
                width: `${Math.max((bar.count / max) * 100, 4)}%`,
                backgroundColor: bar.colorHex,
              }}
            />
          </span>
          <span className="text-caption w-6 shrink-0 text-right font-semibold text-neutral-dark">
            {bar.count}
          </span>
        </li>
      ))}
    </ul>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-neutral-dark/10 bg-white p-5 shadow-elevated">
      <h2 className="text-section-header mb-3 text-neutral-dark">{title}</h2>
      {children}
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-body text-neutral-dark/50">{children}</p>;
}
