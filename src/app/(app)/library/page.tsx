import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { verifySession } from "@/lib/dal";
import { prisma } from "@/lib/prisma";
import {
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@/components/ui/table";
import { COLUMNS, DEFAULT_COLUMN_KEYS, resolveColumns } from "./columns";
import { loadShelfCellColors } from "@/lib/shelf";
import { loadSampleStock } from "@/lib/stock-queries";
import { stockLevel, EMPTY_STOCK } from "@/lib/stock";
import { Badge } from "@/components/ui/badge";
import { ColumnPicker } from "@/components/column-picker";
import { SortableHeader } from "@/components/ui/sortable-header";

type SearchParams = {
  q?: string;
  discarded?: string;
  // SLT-26: "ZERO" narrows to samples with nothing left, which is where the dashboard's
  // Zero Stock KPI lands.
  stock?: string;
  sort?: string;
  dir?: string;
  cols?: string;
};

// Search, sorting and column selection all live in the URL, so a configured view is
// shareable and bookmarkable, and the work happens in SQL rather than over a page of rows.
export default async function LibraryPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const showDiscarded = params.discarded === "1";
  const zeroOnly = params.stock === "ZERO";
  const query = (params.q ?? "").trim();
  const session = await verifySession();

  // A ?cols= override always wins, so a link someone shares still shows the columns they
  // meant. With no override, the viewer's own saved layout applies, then the defaults.
  const savedView = await prisma.savedTableView.findUnique({
    where: { userId_tableKey: { userId: session.user.id, tableKey: "library" } },
  });
  const savedKeys = savedView ? savedView.columns.split(",").filter(Boolean) : null;

  const visibleColumns = resolveColumns(params.cols ?? savedView?.columns);

  const sortKey = params.sort ?? "createdAt";
  const dir: "asc" | "desc" = params.dir === "asc" ? "asc" : "desc";
  const sortColumn = COLUMNS.find((c) => c.key === sortKey && (c.orderBy || c.sortValue));

  // Shelf sorts by row then level; every other column falls back to code so ties have a
  // stable order. The tiebreaker is omitted when sorting by code itself — SQL Server
  // rejects an ORDER BY that names the same column twice.
  let orderBy: Prisma.SampleOrderByWithRelationInput[];
  if (!sortColumn?.orderBy) {
    // Covers both "no such column" and the computed columns, which have no SQL ordering
    // and are sorted in memory below.
    orderBy = [{ createdAt: "desc" }];
  } else if (sortColumn.key === "shelf") {
    orderBy = [{ shelfLetter: dir }, { shelfLevel: dir }];
  } else if (sortColumn.key === "code") {
    orderBy = [{ sampleCode: dir }];
  } else {
    orderBy = [sortColumn.orderBy(dir), { sampleCode: "asc" }];
  }

  // One box across the fields someone would actually recognise a sample by, including the
  // INCI names it's made of — "which samples contain Limonene" is a routine question here,
  // and the ingredient isn't otherwise visible in the table.
  //
  // No `mode: "insensitive"`: the sqlserver connector doesn't support it. Matching is
  // case-insensitive because the database collation is, which is the same thing the
  // Ingredient List search relies on.
  const where: Prisma.SampleWhereInput = {
    isDiscarded: showDiscarded,
    ...(query
      ? {
          OR: [
            { sampleCode: { contains: query } },
            { rmName: { contains: query } },
            { supplier: { contains: query } },
            { function: { contains: query } },
            { physicalForm: { contains: query } },
            { category: { contains: query } },
            { fragranceOrientation: { contains: query } },
            { source: { contains: query } },
            { projectName: { contains: query } },
            { batchLot: { contains: query } },
            { ingredients: { some: { ingredient: { inciName: { contains: query } } } } },
          ],
        }
      : {}),
  };

  const [rows, discardedCount, shelfColors] = await Promise.all([
    prisma.sample.findMany({
      where,
      orderBy,
      include: { createdBy: true, _count: { select: { ingredients: true } } },
    }),
    prisma.sample.count({ where: { isDiscarded: true } }),
    // The shelf plan's colour per cell, so the Shelf column's swatch matches the physical
    // shelf rather than being derived from the sample's category.
    loadShelfCellColors(),
  ]);

  // Current stock per sample, computed from pieces in one grouped query (SLT-29).
  const stock = await loadSampleStock(rows.map((s) => s.id));
  const renderContext = { shelfColors, stock };

  // Stock is computed from pieces, so it can't be a WHERE clause — the filter runs here,
  // over the whole result set (the table isn't paginated).
  const samples = zeroOnly
    ? rows.filter((s) => stockLevel(stock[s.id] ?? EMPTY_STOCK) === "ZERO")
    : rows;

  // Columns whose value is computed can't be ordered by SQL, so they're sorted here. The
  // whole result set is already in memory — the table isn't paginated — so this sorts
  // everything the user can see, not just a page of it.
  if (sortColumn?.sortValue) {
    const value = sortColumn.sortValue;
    const direction = dir === "asc" ? 1 : -1;
    samples.sort((a, b) => {
      const av = value(a, renderContext);
      const bv = value(b, renderContext);
      if (av === bv) return a.sampleCode.localeCompare(b.sampleCode);
      return (av < bv ? -1 : 1) * direction;
    });
  }

  // Only offer the reset when the view actually differs from the default — otherwise the
  // control is permanent noise that does nothing. Staying in the discarded view is
  // deliberate: switching back to active samples has its own link.
  const isCustomised = Boolean(params.sort || params.dir || params.cols);

  // Preserved when building header sort links so toggling a sort doesn't drop the search
  // term, the current column selection or the discarded filter.
  const carried: Record<string, string | undefined> = {
    q: query || undefined,
    discarded: showDiscarded ? "1" : undefined,
    stock: zeroOnly ? "ZERO" : undefined,
    cols: params.cols,
  };

  // Resetting the view clears sorting and columns but keeps what you were looking at —
  // the search term and the discarded filter are the question, not the formatting.
  const resetParams = new URLSearchParams();
  if (query) resetParams.set("q", query);
  if (showDiscarded) resetParams.set("discarded", "1");
  if (zeroOnly) resetParams.set("stock", "ZERO");
  const resetHref = resetParams.toString() ? `/library?${resetParams}` : "/library";

  function sortHref(key: string) {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(carried)) if (v) sp.set(k, v);
    sp.set("sort", key);
    // Clicking the active column flips direction; a new column starts ascending (A→Z).
    sp.set("dir", sortKey === key && dir === "asc" ? "desc" : "asc");
    return `/library?${sp.toString()}`;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-baseline gap-3">
          <h1 className="text-page-title text-neutral-dark">Sample Library</h1>
          <Link
            href={showDiscarded ? "/library" : "/library?discarded=1"}
            className="text-caption text-neutral-dark/60 hover:underline"
          >
            {showDiscarded ? "← Back to active samples" : `View discarded (${discardedCount})`}
          </Link>
          {/* Arriving from the dashboard KPI lands on a filtered list; say so, and give a
              way back. Without this the Library just looks mysteriously short. */}
          {zeroOnly && (
            <span className="text-caption flex items-center gap-2">
              <Badge variant="danger">ZERO STOCK ONLY</Badge>
              <Link
                href={showDiscarded ? "/library?discarded=1" : "/library"}
                className="text-neutral-dark/60 hover:underline"
              >
                Clear filter
              </Link>
            </span>
          )}
        </div>

        <div className="flex items-center gap-3">
          {isCustomised && (
            <Link
              href={resetHref}
              title={
                savedKeys
                  ? "Clear sorting and go back to your saved columns"
                  : "Clear sorting and restore the default columns"
              }
              className="text-body font-medium text-neutral-dark/60 underline-offset-2 hover:text-neutral-dark hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-secondary"
            >
              Reset view
            </Link>
          )}
          <ColumnPicker
            basePath="/library"
            tableKey="library"
            savedKeys={savedKeys}
            options={COLUMNS.map((c) => ({ key: c.key, label: c.label }))}
            visibleKeys={visibleColumns.map((c) => c.key)}
            defaultKeys={DEFAULT_COLUMN_KEYS}
            params={{
              q: query || undefined,
              discarded: showDiscarded ? "1" : undefined,
              stock: zeroOnly ? "ZERO" : undefined,
              sort: params.sort,
              dir: params.dir,
            }}
          />
          {session.user.role === "ADMIN" && !showDiscarded && (
            <Link
              href="/library/add"
              className="text-body inline-flex items-center rounded-lg bg-brand-primary px-4 py-2 font-medium text-on-primary transition-[transform,opacity] duration-150 hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-secondary focus-visible:ring-offset-2 active:scale-[0.98]"
            >
              Add sample
            </Link>
          )}
        </div>
      </div>

      {/* A plain GET form keeps the term in the URL, so a filtered library is shareable and
          survives a refresh. Sort, columns and the discarded filter ride along as hidden
          fields so searching doesn't silently reset the view. */}
      <form method="get" className="flex flex-wrap items-center gap-2">
        {showDiscarded && <input type="hidden" name="discarded" value="1" />}
        {params.sort && <input type="hidden" name="sort" value={params.sort} />}
        {params.dir && <input type="hidden" name="dir" value={params.dir} />}
        {params.cols && <input type="hidden" name="cols" value={params.cols} />}
        <input
          type="search"
          name="q"
          defaultValue={query}
          aria-label="Search samples"
          placeholder="Search by code, RM name, supplier, project, batch or INCI ingredient"
          className="w-full max-w-lg rounded-lg border border-neutral-dark/20 bg-neutral-light px-3 py-2 text-body text-neutral-dark outline-none transition-colors placeholder:text-neutral-dark/40 focus-visible:border-brand-secondary focus-visible:ring-2 focus-visible:ring-brand-secondary/30"
        />
        <button
          type="submit"
          className="text-body rounded-lg border border-neutral-dark/20 px-3 py-2 font-medium text-neutral-dark transition-colors hover:bg-neutral-dark/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-secondary"
        >
          Search
        </button>
        {query && (
          <Link
            href={showDiscarded ? "/library?discarded=1" : "/library"}
            className="text-body text-neutral-dark/60 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-secondary"
          >
            Clear
          </Link>
        )}
      </form>

      <Table>
        <TableHead>
          <TableRow>
            {visibleColumns.map((col) => (
              <TableHeaderCell key={col.key} className={col.numeric ? "text-right" : undefined}>
                {col.orderBy ? (
                  <SortableHeader
                    label={col.label}
                    href={sortHref(col.key)}
                    active={sortKey === col.key}
                    dir={dir}
                  />
                ) : (
                  col.label
                )}
              </TableHeaderCell>
            ))}
          </TableRow>
        </TableHead>

        <TableBody>
          {samples.length === 0 ? (
            <TableEmpty
              colSpan={visibleColumns.length}
              message={
                query
                  ? `No ${showDiscarded ? "discarded " : ""}samples match “${query}”.`
                  : showDiscarded
                    ? "No discarded samples."
                    : "No samples yet. Add the first one to start the library."
              }
            />
          ) : (
            samples.map((s) => (
              <TableRow key={s.id}>
                {visibleColumns.map((col, i) => (
                  <TableCell key={col.key} className={col.numeric ? "text-right" : undefined}>
                    {/* The first visible column carries the link through to the sample,
                        whichever column that happens to be. */}
                    {i === 0 ? (
                      <Link href={`/library/${s.id}`} className="font-medium hover:underline">
                        {col.render(s, renderContext)}
                      </Link>
                    ) : (
                      col.render(s, renderContext)
                    )}
                  </TableCell>
                ))}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>

      <p className="text-caption text-neutral-dark/50">
        {samples.length} sample{samples.length === 1 ? "" : "s"}
        {query ? ` matching “${query}”` : ""} · sorted by{" "}
        {sortColumn?.label ?? "Created"} ({dir === "asc" ? "A→Z" : "Z→A"}) · this view is in
        the URL and can be shared
        {savedKeys && !params.cols ? " · showing your saved columns" : ""}.
      </p>
    </div>
  );
}
