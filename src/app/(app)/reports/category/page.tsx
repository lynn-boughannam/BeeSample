import { requireAdmin } from "@/lib/dal";
import { SAMPLE_CATEGORIES } from "@/lib/categories";
import { loadCategoryReport, type DateRange } from "@/lib/reports";
import {
  Card,
  Finding,
  Findings,
  Kpi,
  KpiRow,
  PairedBarChart,
  ReportHeading,
  ReportTabs,
} from "../report-ui";
import { ReportFilters } from "../report-filters";

// Deck slide 6, generalised. The deck built this for Fragrance as a pilot; here the
// category is a parameter, so the same question can be asked of any part of the library.

function parseDate(value: string | undefined): Date | null {
  if (!value) return null;
  const [y, m, d] = value.split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

export default async function CategoryDeepDive({
  searchParams,
}: {
  searchParams: Promise<{ c?: string; from?: string; to?: string }>;
}) {
  await requireAdmin();
  const params = await searchParams;

  const category =
    params.c && SAMPLE_CATEGORIES.includes(params.c as (typeof SAMPLE_CATEGORIES)[number])
      ? params.c
      : SAMPLE_CATEGORIES[SAMPLE_CATEGORIES.length - 1];

  const range: DateRange = { from: parseDate(params.from), to: parseDate(params.to) };
  const report = await loadCategoryReport(category, range);
  const { overStocked, underStocked } = report.findings;

  const list = (items: string[]) =>
    items.length === 0 ? "none" : items.join(", ");

  return (
    <div className="space-y-6">
      <ReportHeading
        title={`${category} — deep dive`}
        subtitle="How much stock each subcategory carries, and how much of it formulators actually use."
        generatedAt={report.meta.generatedAt}
      />
      <ReportTabs active="category" />

      <ReportFilters
        basePath="/reports/category"
        from={params.from ?? ""}
        to={params.to ?? ""}
        category={category}
        categories={SAMPLE_CATEGORIES}
        rangeLabel="Receipts by reception date"
      />

      <KpiRow>
        <Kpi value={String(report.total)} label={`Total ${category} samples`} />
        <Kpi
          value={`${report.shareOfLibrary.toFixed(1)}%`}
          label="Share of the whole library"
          detail={`of ${report.libraryTotal} samples`}
        />
        <Kpi
          value={`${report.receiptsInRange.percent.toFixed(1)}%`}
          label="Share of receipts in range"
          detail={`${report.receiptsInRange.count} received`}
        />
        <Kpi
          value={`${report.used.percent.toFixed(1)}%`}
          label={`Used by formulators (${report.used.count})`}
          detail="Has at least one logged usage"
        />
      </KpiRow>

      <Card
        title="Stock against use, by subcategory"
        hint="Both bars are in the same order, so a tall left bar beside a short right one is stock that isn't converting into use."
      >
        <PairedBarChart
          rows={report.subcategories.map((s) => ({
            label: s.label,
            leftValue: s.count,
            rightValue: s.usedCount,
            rightPercent: s.usedPercent,
          }))}
          leftLabel="Samples held"
          rightLabel="% used by formulators"
        />
      </Card>

      <Findings>
        <Finding label="Scale">
          {category} accounts for {report.shareOfLibrary.toFixed(1)}% of the library (
          {report.total} of {report.libraryTotal} samples), and {report.used.percent.toFixed(1)}%
          of it shows formulator use.
        </Finding>
        {overStocked.length > 0 && underStocked.length > 0 ? (
          <Finding label="Stock versus use">
            {list(overStocked)} carry the most stock but convert the least of it into
            formulator use; {list(underStocked)} do the opposite — less stock held, more of
            it used.
          </Finding>
        ) : (
          <Finding label="Stock versus use">
            Not enough subcategories with meaningful volume to draw a comparison yet. At
            least three subcategories need five or more samples each before the ranking says
            anything.
          </Finding>
        )}
        {report.subcategories.length > 0 && (
          <Finding label="Largest holding">
            {report.subcategories[0].label} is the biggest subcategory (
            {report.subcategories[0].count} samples,{" "}
            {report.subcategories[0].usedPercent.toFixed(1)}% used).
          </Finding>
        )}
      </Findings>
    </div>
  );
}
