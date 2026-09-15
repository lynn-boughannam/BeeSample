import Link from "next/link";
import { verifySession } from "@/lib/dal";
import { prisma } from "@/lib/prisma";
import { SHELF_LETTERS, SHELF_LEVELS, shelfAddress, shelfCellKey } from "@/lib/categories";
import { loadShelfCellColors, loadShelfCellMeanings, shelfLegendFrom } from "@/lib/shelf";
import { loadSampleStock } from "@/lib/stock-queries";
import { stockLevel, EMPTY_STOCK, type SampleStock } from "@/lib/stock";
import { Badge } from "@/components/ui/badge";

// SLT-24. One unified rack: 10 lettered columns × 5 tiers = 50 drawers. Everything here
// renders on the server — a drawer is a link to ?shelf=<cell>, so the drill-down needs no
// client state.

type RackSample = {
  id: string;
  sampleCode: string;
  rmName: string;
  category: string;
  shelfSublevel: number | null;
  isDiscarded: boolean;
  stock: SampleStock;
  health: "HEALTHY" | "ZERO" | "DISCARDED";
};

const HEALTH_LABEL: Record<RackSample["health"], string> = {
  HEALTHY: "Healthy",
  ZERO: "Zero stock",
  DISCARDED: "Discarded",
};

// A jar dot per sample. Zero stock is a dashed outline rather than a fill so it reads as
// "nothing in it" at a glance, which a solid red dot doesn't.
const HEALTH_DOT: Record<RackSample["health"], string> = {
  HEALTHY: "bg-success border-success",
  ZERO: "border-dashed border-danger bg-transparent",
  DISCARDED: "bg-neutral-dark/25 border-neutral-dark/25",
};

export default async function LocationsPage({
  searchParams,
}: {
  searchParams: Promise<{ shelf?: string }>;
}) {
  await verifySession();
  const { shelf: selectedCell } = await searchParams;

  const [rows, colors, meanings] = await Promise.all([
    prisma.sample.findMany({
      select: {
        id: true,
        sampleCode: true,
        rmName: true,
        category: true,
        shelfLetter: true,
        shelfLevel: true,
        shelfSublevel: true,
        isDiscarded: true,
      },
      orderBy: [{ shelfLetter: "asc" }, { shelfLevel: "asc" }, { shelfSublevel: "asc" }],
    }),
    loadShelfCellColors(),
    loadShelfCellMeanings(),
  ]);

  // Current stock is computed from pieces (SLT-29), so the rack's health dots come from
  // the same source as every other quantity in the app.
  const stock = await loadSampleStock(rows.map((r) => r.id));
  const legend = shelfLegendFrom(meanings);

  // Samples grouped by the cell they physically sit in — the stored address, not the zone
  // their category would compute to, since an Admin can override placement.
  const byCell = new Map<string, RackSample[]>();
  for (const row of rows) {
    const key = shelfCellKey(row.shelfLetter, row.shelfLevel);
    const sampleStock = stock[row.id] ?? EMPTY_STOCK;
    const health = row.isDiscarded
      ? "DISCARDED"
      : stockLevel(sampleStock);

    const list = byCell.get(key) ?? [];
    list.push({
      id: row.id,
      sampleCode: row.sampleCode,
      rmName: row.rmName,
      category: row.category,
      shelfSublevel: row.shelfSublevel,
      isDiscarded: row.isDiscarded,
      stock: sampleStock,
      health,
    });
    byCell.set(key, list);
  }

  if (selectedCell) {
    return (
      <ShelfDetail
        cell={selectedCell}
        samples={byCell.get(selectedCell) ?? []}
        meaning={meanings[selectedCell]?.label ?? null}
        colorHex={colors[selectedCell] ?? null}
      />
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-page-title text-neutral-dark">Locations &amp; Stock</h1>
        <p className="text-body mt-1 text-neutral-dark/60">
          Every shelf slot in the library. Click a drawer to see what&apos;s on it.
        </p>
      </div>

      <section className="rounded-lg border border-neutral-dark/10 bg-white p-5 shadow-elevated">
        <h2 className="text-section-header mb-3 text-neutral-dark">Category legend</h2>
        <ul className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
          {legend.map((row) => (
            <li key={row.letter} className="flex items-baseline gap-3">
              <span className="text-body w-4 shrink-0 font-semibold text-neutral-dark">
                {row.letter}
              </span>
              {row.entries.length === 0 ? (
                <span className="text-caption text-neutral-dark/40">Not in the plan</span>
              ) : (
                <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  {row.entries.map((entry) => (
                    <span
                      key={`${entry.label}-${entry.levels.join()}`}
                      className="inline-flex items-center gap-1.5"
                    >
                      <span
                        aria-hidden
                        className="h-3 w-3 shrink-0 rounded-sm border border-neutral-dark/20"
                        style={{ backgroundColor: entry.colorHex }}
                      />
                      <span className="text-caption text-neutral-dark/80">
                        {entry.label}
                        {/* Levels only matter when the letter is split between meanings. */}
                        {row.entries.length > 1 && (
                          <span className="text-neutral-dark/45">
                            {" "}
                            ({entry.levels.join(", ")})
                          </span>
                        )}
                      </span>
                    </span>
                  ))}
                </span>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section
        className="rounded-lg border border-[#7a5330]/40 p-4 shadow-elevated sm:p-5"
        // Wood-toned frame: warm banding rather than a flat brown, so the drawers read as
        // sitting in a rack instead of floating on a card.
        style={{
          background:
            "linear-gradient(160deg, #b98552 0%, #a06f42 38%, #8a5c35 68%, #a3724a 100%)",
        }}
      >
        <div className="overflow-x-auto">
          <div className="min-w-[52rem]">
            <div className="grid grid-cols-[2rem_repeat(10,minmax(0,1fr))] gap-1.5">
              <span aria-hidden />
              {SHELF_LETTERS.map((letter) => (
                <span
                  key={letter}
                  className="text-caption pb-1 text-center font-semibold text-white/90"
                >
                  {letter}
                </span>
              ))}

              {SHELF_LEVELS.map((level) => (
                <Row key={level} level={level} colors={colors} byCell={byCell} />
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-neutral-dark/10 bg-white p-4 shadow-elevated">
        <h2 className="text-section-header mb-2 text-neutral-dark">Stock health</h2>
        <ul className="flex flex-wrap gap-x-5 gap-y-2">
          {(["HEALTHY", "ZERO", "DISCARDED"] as const).map((h) => (
            <li key={h} className="flex items-center gap-2">
              <span aria-hidden className={`h-3 w-3 rounded-full border-2 ${HEALTH_DOT[h]}`} />
              <span className="text-caption text-neutral-dark/70">{HEALTH_LABEL[h]}</span>
            </li>
          ))}
          <li className="flex items-center gap-2">
            <span aria-hidden className="h-3 w-3 rounded-sm bg-danger" />
            <span className="text-caption text-neutral-dark/70">
              Drawer tag turns red when any sample on it is out of stock
            </span>
          </li>
        </ul>
      </section>
    </div>
  );
}

function Row({
  level,
  colors,
  byCell,
}: {
  level: number;
  colors: Record<string, string>;
  byCell: Map<string, RackSample[]>;
}) {
  return (
    <>
      <span className="text-caption flex items-center justify-center font-semibold text-white/90">
        {level}
      </span>
      {SHELF_LETTERS.map((letter) => {
        const key = shelfCellKey(letter, level);
        return (
          <Drawer
            key={key}
            cell={key}
            samples={byCell.get(key) ?? []}
            colorHex={colors[key] ?? null}
          />
        );
      })}
    </>
  );
}

function Drawer({
  cell,
  samples,
  colorHex,
}: {
  cell: string;
  samples: RackSample[];
  colorHex: string | null;
}) {
  // Discarded samples are excluded from the red override: the sample is gone and its
  // space is free, so it gets its own grey dot rather than flagging the whole drawer
  // (SLT-26 — no double-flagging).
  const hasZeroStock = samples.some((s) => s.health === "ZERO");
  const isEmpty = samples.length === 0;

  // A cell outside the plan (F4, F5, J5) has no colour of its own.
  const tagColor = hasZeroStock ? "#c1292e" : colorHex;

  const body = (
    <>
      <span
        aria-hidden
        className="block h-1.5 w-full rounded-t-[3px]"
        style={{ backgroundColor: tagColor ?? "transparent" }}
      />
      <span className="flex flex-1 flex-col gap-1 p-1.5">
        <span className="text-caption font-semibold text-neutral-dark/80">{cell}</span>
        {isEmpty ? (
          <span className="text-[0.65rem] leading-tight text-neutral-dark/35">Empty</span>
        ) : (
          <>
            <span className="flex flex-wrap gap-1">
              {samples.map((s) => (
                <span
                  key={s.id}
                  title={`${s.sampleCode} — ${HEALTH_LABEL[s.health]}`}
                  className={`h-2.5 w-2.5 rounded-full border-2 ${HEALTH_DOT[s.health]}`}
                />
              ))}
            </span>
            <span className="text-[0.65rem] leading-tight text-neutral-dark/55">
              {samples.length} sample{samples.length === 1 ? "" : "s"}
            </span>
          </>
        )}
      </span>
    </>
  );

  const shared =
    "flex min-h-[4.5rem] flex-col overflow-hidden rounded-[4px] border border-black/15 bg-neutral-light shadow-[0_1px_2px_rgba(0,0,0,0.35)]";

  // An empty drawer isn't a link — there's nothing to drill into.
  if (isEmpty) {
    return <span className={`${shared} opacity-70`}>{body}</span>;
  }

  return (
    <Link
      href={`/locations?shelf=${cell}`}
      aria-label={`Shelf ${cell}, ${samples.length} samples`}
      className={`${shared} transition-transform duration-150 hover:-translate-y-0.5 focus-visible:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-primary`}
    >
      {body}
    </Link>
  );
}

function ShelfDetail({
  cell,
  samples,
  meaning,
  colorHex,
}: {
  cell: string;
  samples: RackSample[];
  meaning: string | null;
  colorHex: string | null;
}) {
  return (
    <div className="space-y-5">
      <Link
        href="/locations"
        className="text-caption inline-flex items-center gap-1 text-neutral-dark/60 hover:text-neutral-dark focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-primary"
      >
        &larr; Back to shelves
      </Link>

      <div className="flex flex-wrap items-center gap-3">
        {colorHex && (
          <span
            aria-hidden
            className="h-5 w-5 shrink-0 rounded-sm border border-neutral-dark/20"
            style={{ backgroundColor: colorHex }}
          />
        )}
        <h1 className="text-page-title text-neutral-dark">
          Shelf {cell}
          {meaning && (
            <span className="text-body font-normal text-neutral-dark/60"> ({meaning})</span>
          )}
        </h1>
        <span className="text-body text-neutral-dark/60">
          · {samples.length} sample{samples.length === 1 ? "" : "s"}
        </span>
      </div>

      {samples.length === 0 ? (
        <p className="text-body text-neutral-dark/50">Nothing is stored on this shelf.</p>
      ) : (
        <ul className="divide-y divide-neutral-dark/8 rounded-lg border border-neutral-dark/10 bg-white shadow-elevated">
          {samples.map((s) => (
            <li key={s.id}>
              <Link
                href={`/library/${s.id}`}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 transition-colors duration-150 hover:bg-neutral-dark/[0.03] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-primary"
              >
                <span
                  aria-hidden
                  className={`h-3 w-3 shrink-0 rounded-full border-2 ${HEALTH_DOT[s.health]}`}
                />
                <span className="text-body font-medium text-neutral-dark">{s.sampleCode}</span>
                <span className="text-body text-neutral-dark/80">{s.rmName}</span>
                <Badge variant="neutral">{s.category}</Badge>
                <span className="text-caption text-neutral-dark/55">
                  {shelfAddress(cell.slice(0, 1), Number(cell.slice(1)), s.shelfSublevel)}
                </span>
                <span className="text-caption ml-auto text-neutral-dark/70">
                  {s.stock.remainingQtyG} g · {s.stock.remainingQtyPcs} pc
                  {s.stock.remainingQtyPcs === 1 ? "" : "s"}
                </span>
                {s.health !== "HEALTHY" && (
                  <Badge variant={s.health === "DISCARDED" ? "neutral" : "danger"}>
                    {HEALTH_LABEL[s.health]}
                  </Badge>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
