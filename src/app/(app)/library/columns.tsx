import type { Prisma } from "@prisma/client";
import { shelfAddress, shelfCellKey } from "@/lib/categories";
import type { ShelfCellColors } from "@/lib/shelf";
import { EMPTY_STOCK, stockLevel, type SampleStock } from "@/lib/stock";
import { Badge, SwatchChip } from "@/components/ui/badge";

export type LibrarySample = Prisma.SampleGetPayload<{
  include: { createdBy: true; _count: { select: { ingredients: true } } };
}>;

const day = (d: Date) => d.toISOString().slice(0, 10);

// Everything a column needs that isn't on the sample row itself: the shelf plan's colour
// per cell, and the stock computed from each sample's pieces (SLT-29).
export type RenderContext = {
  shelfColors: ShelfCellColors;
  stock: Record<string, SampleStock>;
};

export const stockOf = (s: LibrarySample, ctx: RenderContext): SampleStock =>
  ctx.stock[s.id] ?? EMPTY_STOCK;

export type ColumnDef = {
  key: string;
  label: string;
  // Prisma orderBy fragment for this column. Omitted when the column isn't sortable.
  orderBy?: (dir: "asc" | "desc") => Prisma.SampleOrderByWithRelationInput;
  render: (s: LibrarySample, ctx: RenderContext) => React.ReactNode;
  // Set instead of orderBy on columns whose value is computed rather than stored, so they
  // can't be ordered in SQL. The page sorts those in memory.
  sortValue?: (s: LibrarySample, ctx: RenderContext) => number | string;
  numeric?: boolean;
};

// Every field on a sample that's meaningful in a list view. `defaultColumnKeys` below
// decides which are on out of the box; the rest are opt-in via the column picker.
export const COLUMNS: ColumnDef[] = [
  {
    key: "code",
    label: "Code",
    orderBy: (dir) => ({ sampleCode: dir }),
    render: (s) => s.sampleCode,
  },
  {
    key: "rmName",
    label: "RM Name",
    orderBy: (dir) => ({ rmName: dir }),
    render: (s) => s.rmName,
  },
  {
    key: "category",
    label: "Category",
    orderBy: (dir) => ({ category: dir }),
    render: (s) => s.category,
  },
  {
    key: "fragranceOrientation",
    label: "Orientation",
    orderBy: (dir) => ({ fragranceOrientation: dir }),
    render: (s) => s.fragranceOrientation ?? "—",
  },
  {
    key: "function",
    label: "Function",
    orderBy: (dir) => ({ function: dir }),
    render: (s) => s.function || "—",
  },
  {
    key: "physicalForm",
    label: "Physical Form",
    orderBy: (dir) => ({ physicalForm: dir }),
    render: (s) => s.physicalForm || "—",
  },
  {
    key: "source",
    label: "Source",
    orderBy: (dir) => ({ source: dir }),
    render: (s) => s.source,
  },
  {
    key: "supplier",
    label: "Supplier",
    orderBy: (dir) => ({ supplier: dir }),
    render: (s) => s.supplier,
  },
  {
    key: "shelf",
    label: "Shelf",
    // Sorting by the letter alone would scatter levels within a row, so the level is the
    // tiebreaker — B2 sorts before B10's row-mate rather than by string chance.
    orderBy: (dir) => ({ shelfLetter: dir }),
    // The swatch is the shelf plan's own colour for this cell, so the chip matches the
    // physical shelf you'd walk to. Cells the plan leaves blank fall back to grey.
    render: (s, ctx) => (
      <SwatchChip
        colorHex={ctx.shelfColors[shelfCellKey(s.shelfLetter, s.shelfLevel)] ?? "#CCCCCC"}
        label={shelfAddress(s.shelfLetter, s.shelfLevel, s.shelfSublevel)}
      />
    ),
  },
  // Computed from the sample's pieces, never stored — so it's sorted in memory rather
  // than in SQL (SLT-29).
  {
    key: "remaining",
    label: "Remaining (g)",
    render: (s, ctx) => stockOf(s, ctx).remainingQtyG,
    sortValue: (s, ctx) => Number(stockOf(s, ctx).remainingQtyG),
    numeric: true,
  },
  // SLT-26. Two mutually exclusive flags, and a healthy sample shows nothing at all — a
  // column of "OK" badges would be noise that hides the rows that matter. Discarded wins
  // over Zero Stock so a discarded sample isn't flagged twice for the same fact.
  {
    key: "flags",
    label: "Flags",
    render: (s, ctx) => {
      if (s.isDiscarded) return <Badge variant="neutral">DISCARDED</Badge>;
      if (stockLevel(stockOf(s, ctx)) === "ZERO") return <Badge variant="danger">ZERO</Badge>;
      return <span className="text-neutral-dark/30">—</span>;
    },
    // Flagged rows sort to the top, which is the only ordering anyone wants here.
    sortValue: (s, ctx) => {
      if (s.isDiscarded) return 1;
      return stockLevel(stockOf(s, ctx)) === "ZERO" ? 0 : 2;
    },
  },
  {
    key: "remainingPcs",
    label: "Remaining (pcs)",
    render: (s, ctx) => stockOf(s, ctx).remainingQtyPcs,
    sortValue: (s, ctx) => stockOf(s, ctx).remainingQtyPcs,
    numeric: true,
  },
  {
    key: "total",
    label: "Total (g)",
    orderBy: (dir) => ({ totalQtyG: dir }),
    render: (s) => s.totalQtyG.toString(),
    numeric: true,
  },
  {
    key: "pcs",
    label: "Received (pcs)",
    orderBy: (dir) => ({ receivedQtyPcs: dir }),
    render: (s) => s.receivedQtyPcs ?? "—",
    numeric: true,
  },
  {
    key: "netWeight",
    label: "Net Weight (g)",
    orderBy: (dir) => ({ netWeightG: dir }),
    render: (s) => (s.netWeightG != null ? s.netWeightG.toString() : "—"),
    numeric: true,
  },
  {
    key: "hazardClass",
    label: "Hazard Class",
    orderBy: (dir) => ({ hazardClass: dir }),
    render: (s) =>
      s.hazardClass ? (
        <Badge variant={s.hazardClass === "Hazardous" ? "danger" : "success"}>
          {s.hazardClass}
        </Badge>
      ) : (
        "—"
      ),
  },
  {
    key: "projectName",
    label: "Project",
    orderBy: (dir) => ({ projectName: dir }),
    render: (s) => s.projectName ?? "—",
  },
  {
    key: "batchLot",
    label: "Batch / Lot",
    orderBy: (dir) => ({ batchLot: dir }),
    render: (s) => s.batchLot ?? "—",
  },
  {
    key: "documentAvailability",
    label: "Documents",
    orderBy: (dir) => ({ documentAvailability: dir }),
    render: (s) =>
      s.documentAvailability ? (s.documentAvailability === "YES" ? "Yes" : "No") : "—",
  },
  {
    key: "inci",
    label: "INCI",
    orderBy: (dir) => ({ ingredients: { _count: dir } }),
    render: (s) => s._count.ingredients,
    numeric: true,
  },
  {
    key: "reception",
    label: "Received",
    orderBy: (dir) => ({ receptionDate: dir }),
    render: (s) => day(s.receptionDate),
  },
  {
    key: "expiry",
    label: "Expires",
    orderBy: (dir) => ({ expiryDate: dir }),
    render: (s) => day(s.expiryDate),
  },
  {
    key: "createdBy",
    label: "Created By",
    orderBy: (dir) => ({ createdBy: { name: dir } }),
    render: (s) => s.createdBy.name,
  },
  {
    key: "createdAt",
    label: "Created",
    orderBy: (dir) => ({ createdAt: dir }),
    render: (s) => day(s.createdAt),
  },
];

export const DEFAULT_COLUMN_KEYS = [
  "code",
  "rmName",
  "category",
  "shelf",
  "remaining",
  "flags",
  "supplier",
  "expiry",
];

export function resolveColumns(colsParam: string | undefined): ColumnDef[] {
  if (!colsParam) return COLUMNS.filter((c) => DEFAULT_COLUMN_KEYS.includes(c.key));

  // Preserve the registry's order rather than the order keys happen to appear in the URL,
  // so the table layout stays stable however the picker was clicked.
  const wanted = new Set(colsParam.split(",").filter(Boolean));
  const picked = COLUMNS.filter((c) => wanted.has(c.key));
  return picked.length > 0 ? picked : COLUMNS.filter((c) => DEFAULT_COLUMN_KEYS.includes(c.key));
}
