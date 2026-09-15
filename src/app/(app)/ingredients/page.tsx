import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { verifySession } from "@/lib/dal";
import { prisma } from "@/lib/prisma";
import { ColumnPicker } from "@/components/column-picker";
import { SortableHeader } from "@/components/ui/sortable-header";
import {
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@/components/ui/table";
import { DeleteIngredient } from "./delete-ingredient";
import { deleteIngredient } from "./actions";
import {
  INGREDIENT_COLUMNS,
  INGREDIENT_DEFAULT_COLUMNS,
  resolveIngredientColumns,
} from "./columns";

type SearchParams = { q?: string; sort?: string; dir?: string; cols?: string };

export default async function IngredientsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const session = await verifySession();
  const isAdmin = session.user.role === "ADMIN";
  const query = (params.q ?? "").trim();

  // A ?cols= override always wins so shared links keep their columns; otherwise the
  // viewer's own saved layout applies, then the defaults.
  const savedView = await prisma.savedTableView.findUnique({
    where: { userId_tableKey: { userId: session.user.id, tableKey: "ingredients" } },
  });
  const savedKeys = savedView ? savedView.columns.split(",").filter(Boolean) : null;

  const visibleColumns = resolveIngredientColumns(params.cols ?? savedView?.columns);

  const sortKey = params.sort ?? "inciName";
  const dir: "asc" | "desc" = params.dir === "desc" ? "desc" : "asc";
  const sortColumn = INGREDIENT_COLUMNS.find((c) => c.key === sortKey && c.orderBy);

  // INCI name is the tiebreaker for a stable order, except when it's the sort column —
  // SQL Server rejects an ORDER BY naming the same column twice.
  let orderBy: Prisma.IngredientListEntryOrderByWithRelationInput[];
  if (!sortColumn?.orderBy) {
    orderBy = [{ inciName: "asc" }];
  } else if (sortColumn.key === "inciName") {
    orderBy = [{ inciName: dir }];
  } else {
    orderBy = [sortColumn.orderBy(dir), { inciName: "asc" }];
  }

  const ingredients = await prisma.ingredientListEntry.findMany({
    where: query
      ? {
          OR: [
            { inciName: { contains: query } },
            { uid: { contains: query } },
            { casNumbers: { some: { value: { contains: query } } } },
            { chemicalFamily: { contains: query } },
            { regulatoryFunction: { contains: query } },
          ],
        }
      : undefined,
    orderBy,
    include: { casNumbers: true, _count: { select: { sampleLinks: true } } },
  });

  const isCustomised = Boolean(params.sort || params.dir || params.cols);

  // The search term rides along with sort and column links so filtering isn't lost.
  function sortHref(key: string) {
    const sp = new URLSearchParams();
    if (query) sp.set("q", query);
    if (params.cols) sp.set("cols", params.cols);
    sp.set("sort", key);
    sp.set("dir", sortKey === key && dir === "asc" ? "desc" : "asc");
    return `/ingredients?${sp.toString()}`;
  }

  const resetHref = query ? `/ingredients?q=${encodeURIComponent(query)}` : "/ingredients";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-page-title text-neutral-dark">Ingredient List</h1>
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
            basePath="/ingredients"
            tableKey="ingredients"
            savedKeys={savedKeys}
            options={INGREDIENT_COLUMNS.map((c) => ({ key: c.key, label: c.label }))}
            visibleKeys={visibleColumns.map((c) => c.key)}
            defaultKeys={INGREDIENT_DEFAULT_COLUMNS}
            params={{ q: query || undefined, sort: params.sort, dir: params.dir }}
          />
          {isAdmin && (
            <Link
              href="/ingredients/new"
              className="text-body inline-flex items-center rounded-lg bg-brand-primary px-4 py-2 font-medium text-on-primary transition-[transform,opacity] duration-150 hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-secondary focus-visible:ring-offset-2 active:scale-[0.98]"
            >
              Add ingredient
            </Link>
          )}
        </div>
      </div>

      {/* A plain GET form keeps the search term in the URL, so a filtered list is
          shareable and survives a refresh. Sort and columns ride along as hidden fields
          so searching doesn't silently reset the view. */}
      <form method="get" className="flex items-center gap-2">
        {params.sort && <input type="hidden" name="sort" value={params.sort} />}
        {params.dir && <input type="hidden" name="dir" value={params.dir} />}
        {params.cols && <input type="hidden" name="cols" value={params.cols} />}
        <input
          type="search"
          name="q"
          defaultValue={query}
          placeholder="Search by INCI name, UID, CAS number, family or function"
          className="w-full max-w-md rounded-lg border border-neutral-dark/20 bg-neutral-light px-3 py-2 text-body text-neutral-dark outline-none transition-colors placeholder:text-neutral-dark/40 focus-visible:border-brand-secondary focus-visible:ring-2 focus-visible:ring-brand-secondary/30"
        />
        <button
          type="submit"
          className="text-body rounded-lg border border-neutral-dark/20 px-3 py-2 font-medium text-neutral-dark transition-colors hover:bg-neutral-dark/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-secondary"
        >
          Search
        </button>
        {query && (
          <Link href="/ingredients" className="text-body text-neutral-dark/60 hover:underline">
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
            {isAdmin && <TableHeaderCell>Actions</TableHeaderCell>}
          </TableRow>
        </TableHead>
        <TableBody>
          {ingredients.length === 0 ? (
            <TableEmpty
              colSpan={visibleColumns.length + (isAdmin ? 1 : 0)}
              message={
                query
                  ? `No ingredients match “${query}”.`
                  : "No ingredients yet. Add the first one to start the master list."
              }
            />
          ) : (
            ingredients.map((ing) => (
              <TableRow key={ing.id}>
                {visibleColumns.map((col, i) => (
                  <TableCell key={col.key} className={col.numeric ? "text-right" : undefined}>
                    {/* Whichever column is first carries the link to the record. */}
                    {i === 0 ? (
                      <Link href={`/ingredients/${ing.id}`} className="font-medium hover:underline">
                        {col.render(ing)}
                      </Link>
                    ) : (
                      col.render(ing)
                    )}
                  </TableCell>
                ))}
                {isAdmin && (
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <Link
                        href={`/ingredients/${ing.id}/edit`}
                        className="text-body font-medium text-neutral-dark hover:underline"
                      >
                        Edit
                      </Link>
                      <DeleteIngredient
                        id={ing.id}
                        name={ing.inciName}
                        linkedSamples={ing._count.sampleLinks}
                        action={deleteIngredient}
                      />
                    </div>
                  </TableCell>
                )}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>

      <p className="text-caption text-neutral-dark/50">
        {ingredients.length} ingredient{ingredients.length === 1 ? "" : "s"}
        {query ? ` matching “${query}”` : ""} · sorted by {sortColumn?.label ?? "INCI Name"} (
        {dir === "asc" ? "A→Z" : "Z→A"}). Ingredients in use by a sample can be edited but not
        deleted.
      </p>
    </div>
  );
}
