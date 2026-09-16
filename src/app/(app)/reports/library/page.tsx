import { requireAdmin } from "@/lib/dal";
import { loadLibraryStatusReport } from "@/lib/reports";
import {
  BarChart,
  Card,
  Finding,
  Findings,
  Kpi,
  KpiRow,
  ReportHeading,
  ReportTabs,
} from "../report-ui";

// Deck slide 3. A snapshot rather than a range: "current status" means now, so there's no
// date filter here — the time-based reports are the other two.
export default async function LibraryStatusReport() {
  await requireAdmin();
  const report = await loadLibraryStatusReport();
  const { findings } = report;

  return (
    <div className="space-y-6">
      <ReportHeading
        title="RM Sample Library — current status"
        subtitle="Total inventory, availability, and where samples concentrate across category, supplier, and location."
        generatedAt={report.meta.generatedAt}
      />
      <ReportTabs active="library" />

      <KpiRow>
        <Kpi value={String(report.total)} label="Total samples in library" detail="Excludes discarded" />
        <Kpi
          value={String(report.available.count)}
          label="Available"
          detail={`${report.available.percent.toFixed(1)}% of the library`}
        />
        <Kpi
          value={`${report.empty.percent.toFixed(1)}%`}
          label={`Empty (${report.empty.count} samples)`}
          detail="Nothing left to dispense"
          tone={report.empty.count > 0 ? "danger" : undefined}
        />
        <Kpi
          value={`${report.usedByFormulators.percent.toFixed(1)}%`}
          label={`Used by formulators (${report.usedByFormulators.count})`}
          detail="Has at least one logged usage"
        />
      </KpiRow>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card title="Samples by category">
          <BarChart slices={report.byCategory} />
        </Card>
        <Card title="Top suppliers by sample count">
          <BarChart slices={report.topSuppliers} colorHex="var(--color-warning)" />
        </Card>
        <Card
          title="Top location categories"
          hint="The shelf zone a sample sits in — Source for Natural and Organic, orientation for a fragrance, category otherwise."
        >
          <BarChart slices={report.topLocationCategories} colorHex="var(--color-brand-secondary)" />
        </Card>
        <Card title="Availability">
          <BarChart
            slices={[
              { label: "Available", count: report.available.count, percent: report.available.percent },
              { label: "Empty", count: report.empty.count, percent: report.empty.percent },
            ]}
            colorHex="var(--color-info)"
          />
        </Card>
      </div>

      <Findings>
        {findings.topCategory && (
          <Finding label="Library composition">
            {findings.topCategory.label} dominates the portfolio (
            {findings.topCategory.percent.toFixed(1)}%, {findings.topCategory.count} samples)
            {findings.topSupplier && (
              <>
                ; {findings.topSupplier.label} is the top single supplier (
                {findings.topSupplier.percent.toFixed(1)}%)
              </>
            )}
            .
          </Finding>
        )}
        <Finding label="Formulator use">
          Only {report.usedByFormulators.percent.toFixed(1)}% of the library shows evidence of
          formulator use ({report.usedByFormulators.count} of {report.total}).
        </Finding>
        {findings.topLocationCategory && (
          <Finding label="Location">
            {findings.topLocationCategory.label} holds the most stock (
            {findings.topLocationCategory.count} samples,{" "}
            {findings.topLocationCategory.percent.toFixed(1)}%).
          </Finding>
        )}
        {findings.topFunction && (
          <Finding label="Function">
            {findings.topFunction.label} is the most common function (
            {findings.topFunction.percent.toFixed(1)}%).
          </Finding>
        )}
      </Findings>
    </div>
  );
}
