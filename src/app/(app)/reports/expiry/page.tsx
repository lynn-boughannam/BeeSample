import { requireAdmin } from "@/lib/dal";
import { loadExpiryReport, type DateRange } from "@/lib/reports";
import {
  BarChart,
  Card,
  Finding,
  Findings,
  Kpi,
  KpiRow,
  ReportHeading,
  ReportTabs,
  StackedCohortChart,
} from "../report-ui";
import { ReportFilters } from "../report-filters";

// Deck slide 4, expiry half only.
//
// The disposal half of that slide — "recommended for disposal" vs "recommended to remain",
// and the seven-reason taxonomy behind it — is deliberately absent. None of it exists in
// the data model, and it is a classification feature rather than a report: inventing the
// rules here would produce confident numbers with nothing behind them. Scoped separately
// (decided 2026-09-16).

const DEFAULT_SPLIT_YEAR = 2019;

function parseDate(value: string | undefined): Date | null {
  if (!value) return null;
  const [y, m, d] = value.split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

export default async function ExpiryReport({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; split?: string }>;
}) {
  await requireAdmin();
  const params = await searchParams;

  const range: DateRange = { from: parseDate(params.from), to: parseDate(params.to) };
  const parsedSplit = Number(params.split);
  const splitYear =
    Number.isInteger(parsedSplit) && parsedSplit > 1900 && parsedSplit < 2200
      ? parsedSplit
      : DEFAULT_SPLIT_YEAR;

  const report = await loadExpiryReport(range, splitYear);

  return (
    <div className="space-y-6">
      <ReportHeading
        title="Expired samples"
        subtitle="What has passed its expiry date, where it sits, and how an older intake compares with a recent one."
        generatedAt={report.meta.generatedAt}
      />
      <ReportTabs active="expiry" />

      <ReportFilters
        basePath="/reports/expiry"
        from={params.from ?? ""}
        to={params.to ?? ""}
        splitYear={splitYear}
        rangeLabel="Filter by reception date"
      />

      <KpiRow>
        <Kpi
          value={String(report.total)}
          label="Samples in scope"
          detail={report.meta.range.from || report.meta.range.to ? "Within the selected range" : "Whole library"}
        />
        <Kpi
          value={`${report.expired.percent.toFixed(1)}%`}
          label={`Expired (${report.expired.count})`}
          detail="Past its expiry date today"
          tone={report.expired.count > 0 ? "danger" : undefined}
        />
        <Kpi
          value={String(report.expiringSoon.count)}
          label="Expiring within 90 days"
          detail={`${report.expiringSoon.percent.toFixed(1)}% of the samples in scope`}
          tone={report.expiringSoon.count > 0 ? "warning" : undefined}
        />
        <Kpi
          value={`${report.olderTotal} / ${report.recentTotal}`}
          label={`Received before ${splitYear} / from ${splitYear}`}
          detail="Cohort split, configurable above"
        />
      </KpiRow>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card
          title="Expired by location category"
          hint="Where the expired stock physically sits, so it can be cleared shelf by shelf."
        >
          <BarChart slices={report.expiredByLocation} colorHex="var(--color-danger)" />
        </Card>
        <Card title="Expired by category">
          <BarChart slices={report.expiredByCategory} colorHex="var(--color-danger)" />
        </Card>
        <Card
          title="Expired by hazard class"
          hint="Hazard class is recorded per sample, so hazardous stock can be routed first."
        >
          <BarChart slices={report.expiredByHazard} colorHex="var(--color-warning)" />
        </Card>
        <Card
          title="Category mix by reception period"
          hint={`Samples received before ${splitYear} against those received from ${splitYear} onward.`}
        >
          <StackedCohortChart
            rows={report.cohorts}
            olderLabel={`Before ${splitYear} (${report.olderTotal})`}
            recentLabel={`${splitYear} onward (${report.recentTotal})`}
          />
        </Card>
      </div>

      <Findings>
        <Finding label="Expiry">
          {report.expired.count} of {report.total} samples in scope have passed their expiry date (
          {report.expired.percent.toFixed(1)}%)
          {report.expiringSoon.count > 0 && (
            <>, with a further {report.expiringSoon.count} due within 90 days</>
          )}
          .
        </Finding>
        {report.expiredByHazard.length > 0 && (
          <Finding label="Routing">
            Clear hazardous stock first:{" "}
            {report.expiredByHazard
              .map((h) => `${h.label} ${h.count}`)
              .join(", ")}
            . Hazard class is per sample, so the split is exact rather than estimated.
          </Finding>
        )}
        {report.expiredByLocation.length > 0 && (
          <Finding label="Where to start">
            {report.expiredByLocation[0].label} holds the most expired stock (
            {report.expiredByLocation[0].count} samples,{" "}
            {report.expiredByLocation[0].percent.toFixed(1)}% of what has expired).
          </Finding>
        )}
        <Finding label="Not shown">
          Disposal recommendations — the dispose-versus-remain split and its reason codes —
          are not in this report. Nothing in the data model records them yet, so any number
          here would be invented rather than measured.
        </Finding>
      </Findings>
    </div>
  );
}
