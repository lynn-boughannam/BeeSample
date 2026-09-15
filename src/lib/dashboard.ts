import "server-only";
import { prisma } from "@/lib/prisma";
import { loadSampleStock } from "@/lib/stock-queries";
import { loadCategoryColors } from "@/lib/shelf";
import { stockLevel, EMPTY_STOCK, type StockLevel, type SampleStock } from "@/lib/stock";

// Everything the Admin dashboard shows, assembled in one place so the page stays a
// rendering concern and the numbers can be verified without a browser (SLT-59).

export type DashboardKpis = {
  totalSamples: number;
  zeroStock: number;
  discardedSamples: number;
  pendingRequests: number;
  checkedOut: number;
  newOrders: number;
  ordersInProgress: number;
  feedbackDue: number;
};

export type CategoryBar = { category: string; count: number; colorHex: string };

export type CheckedOutPiece = {
  pieceId: string;
  sampleId: string;
  sampleCode: string;
  rmName: string;
  pieceIndex: number;
  remainingWeightG: string;
  since: Date | null;
};

export type CheckedOutGroup = { formulatorName: string; pieces: CheckedOutPiece[] };

export type ActivityKind =
  | "RECEIPT"
  | "CHECKOUT"
  | "RETURN_USAGE"
  | "DISCARD"
  | "MOVE"
  | "REQUEST"
  | "ORDER"
  | "PR"
  | "FEEDBACK";

export type ActivityEntry = {
  id: string;
  kind: ActivityKind;
  description: string;
  at: Date;
  href: string | null;
};

export type AdminDashboard = {
  kpis: DashboardKpis;
  stockHealth: { healthy: number; zero: number; total: number };
  byCategory: CategoryBar[];
  checkedOut: CheckedOutGroup[];
  activity: ActivityEntry[];
};

// Each feed source is capped before merging, so the query cost doesn't grow with history.
const PER_SOURCE = 25;
const FEED_SIZE = 15;

const g = (value: unknown) => Number(value).toFixed(2);

// Transaction.type is a plain string column; the five it can hold are all activity kinds
// in their own right, so an unrecognised value falls back rather than breaking the feed.
const TRANSACTION_KINDS = new Set(["RECEIPT", "CHECKOUT", "RETURN_USAGE", "DISCARD", "MOVE"]);
const activityKindOf = (type: string): ActivityKind =>
  TRANSACTION_KINDS.has(type) ? (type as ActivityKind) : "RECEIPT";

export async function loadAdminDashboard(): Promise<AdminDashboard> {
  // Discarded samples are excluded from every stock figure: they're out of the library, and
  // SLT-26 gives them their own flag rather than counting them as zero stock. Keeping them
  // out here is also what makes healthy + low + zero add up to Total Samples.
  const samples = await prisma.sample.findMany({
    where: { isDiscarded: false },
    select: { id: true, category: true, totalQtyG: true },
  });

  const [
    stock,
    categoryColors,
    checkedOutPieces,
    pendingRequests,
    feedbackDue,
    newOrders,
    ordersInProgress,
    discardedSamples,
  ] = await Promise.all([
    loadSampleStock(samples.map((s) => s.id)),
    loadCategoryColors(),
    prisma.samplePiece.findMany({
      where: { status: "CHECKED_OUT" },
      include: {
        sample: { select: { id: true, sampleCode: true, rmName: true } },
        checkedOutToUser: { select: { id: true, name: true } },
      },
      orderBy: { checkedOutAt: "desc" },
    }),
    prisma.sampleRequest.count({ where: { status: "PENDING" } }),
    // Approved but never reported on — the same definition the Formulator dashboard uses.
    prisma.sampleRequest.count({ where: { status: "APPROVED", feedback: null } }),
    prisma.sampleOrder.count({ where: { status: "PENDING" } }),
    // Past approval, not yet received. ORDER_STATUSES has no separate "ordered" state, so
    // an approved order that's been raised as a PR is still APPROVED here.
    prisma.sampleOrder.count({ where: { status: "APPROVED" } }),
    // Counts samples, not pieces, so the tile agrees with the list it links to
    // (/library?discarded=1 shows discarded samples).
    prisma.sample.count({ where: { isDiscarded: true } }),
  ]);

  let healthy = 0;
  let zero = 0;
  const categoryCounts = new Map<string, number>();

  for (const sample of samples) {
    const sampleStock: SampleStock = stock[sample.id] ?? EMPTY_STOCK;
    const level: StockLevel = stockLevel(sampleStock);
    if (level === "ZERO") zero++;
    else healthy++;

    categoryCounts.set(sample.category, (categoryCounts.get(sample.category) ?? 0) + 1);
  }

  // Only categories actually present in the library get a bar, biggest first.
  const byCategory: CategoryBar[] = [...categoryCounts.entries()]
    .map(([category, count]) => ({
      category,
      count,
      colorHex: categoryColors[category] ?? "#9CA3AF",
    }))
    .sort((a, b) => b.count - a.count || a.category.localeCompare(b.category));

  // Grouped by who holds them, so the card answers "who has what" rather than "what's out".
  const groups = new Map<string, CheckedOutGroup>();
  for (const piece of checkedOutPieces) {
    const name = piece.checkedOutToUser?.name ?? "Unassigned";
    const group = groups.get(name) ?? { formulatorName: name, pieces: [] };
    group.pieces.push({
      pieceId: piece.id,
      sampleId: piece.sample.id,
      sampleCode: piece.sample.sampleCode,
      rmName: piece.sample.rmName,
      pieceIndex: piece.pieceIndex,
      remainingWeightG: g(piece.remainingWeightG),
      since: piece.checkedOutAt,
    });
    groups.set(name, group);
  }
  const checkedOut = [...groups.values()].sort((a, b) =>
    a.formulatorName.localeCompare(b.formulatorName)
  );

  return {
    kpis: {
      totalSamples: samples.length,
      zeroStock: zero,
      discardedSamples,
      pendingRequests,
      checkedOut: checkedOutPieces.length,
      newOrders,
      ordersInProgress,
      feedbackDue,
    },
    stockHealth: { healthy, zero, total: samples.length },
    byCategory,
    checkedOut,
    activity: await loadActivity(),
  };
}

// A merged feed across every source that records something happening. Each source is read
// separately because they're unrelated tables with their own timestamps; they're sorted
// into one stream here.
export async function loadActivity(): Promise<ActivityEntry[]> {
  const [transactions, requests, orders, feedback] = await Promise.all([
    prisma.transaction.findMany({
      include: {
        sample: { select: { id: true, sampleCode: true } },
        performedBy: { select: { name: true } },
      },
      orderBy: { createdAt: "desc" },
      take: PER_SOURCE,
    }),
    prisma.sampleRequest.findMany({
      include: {
        sample: { select: { id: true, sampleCode: true } },
        requestedBy: { select: { name: true } },
        approvedBy: { select: { name: true } },
      },
      orderBy: { createdAt: "desc" },
      take: PER_SOURCE,
    }),
    prisma.sampleOrder.findMany({
      include: {
        existingSample: { select: { id: true, sampleCode: true } },
        orderedBy: { select: { name: true } },
        approvedBy: { select: { name: true } },
      },
      orderBy: { createdAt: "desc" },
      take: PER_SOURCE,
    }),
    prisma.feedback.findMany({
      include: {
        sample: { select: { id: true, sampleCode: true } },
        submittedBy: { select: { name: true } },
      },
      orderBy: { createdAt: "desc" },
      take: PER_SOURCE,
    }),
  ]);

  const entries: ActivityEntry[] = [];

  for (const t of transactions) {
    const amount = t.quantityG != null ? ` (${g(t.quantityG)} g)` : "";
    entries.push({
      id: `tx-${t.id}`,
      kind: activityKindOf(t.type),
      description: `${t.sample.sampleCode} — ${t.note ?? t.type}${amount} · ${t.performedBy.name}`,
      at: t.createdAt,
      href: `/library/${t.sample.id}`,
    });
  }

  for (const r of requests) {
    entries.push({
      id: `req-${r.id}`,
      kind: "REQUEST",
      description: `${r.requestedBy.name} requested ${g(r.amountG)} g of ${r.sample.sampleCode} — ${r.purpose}`,
      at: r.createdAt,
      href: `/library/${r.sample.id}`,
    });
    // A decision is its own event, at its own time.
    if (r.decidedAt && r.status !== "PENDING") {
      entries.push({
        id: `req-${r.id}-decided`,
        kind: "REQUEST",
        description: `Request for ${r.sample.sampleCode} ${r.status.toLowerCase()}${
          r.approvedBy ? ` by ${r.approvedBy.name}` : ""
        }`,
        at: r.decidedAt,
        href: `/library/${r.sample.id}`,
      });
    }
  }

  for (const o of orders) {
    const what = o.existingSample?.sampleCode ?? o.newRmName ?? "new raw material";
    const href = o.existingSample ? `/library/${o.existingSample.id}` : null;

    entries.push({
      id: `ord-${o.id}`,
      kind: "ORDER",
      description: `${o.orderedBy.name} ordered ${what} from ${o.supplier}`,
      at: o.createdAt,
      href,
    });
    if (o.decidedAt && o.status !== "PENDING") {
      entries.push({
        id: `ord-${o.id}-decided`,
        kind: "ORDER",
        description: `Order for ${what} ${o.status.toLowerCase()}${
          o.approvedBy ? ` by ${o.approvedBy.name}` : ""
        }`,
        at: o.decidedAt,
        href,
      });
    }
    // A PR number has no timestamp of its own, so it's dated to the decision that
    // preceded it — the closest thing the schema records.
    if (o.prNumber) {
      entries.push({
        id: `ord-${o.id}-pr`,
        kind: "PR",
        description: `PR ${o.prNumber} raised for ${what} (${o.supplier})`,
        at: o.decidedAt ?? o.createdAt,
        href,
      });
    }
    if (o.receivedAt) {
      entries.push({
        id: `ord-${o.id}-received`,
        kind: "ORDER",
        description: `Order received: ${what} from ${o.supplier}`,
        at: o.receivedAt,
        href,
      });
    }
  }

  for (const f of feedback) {
    entries.push({
      id: `fb-${f.id}`,
      kind: "FEEDBACK",
      description: `${f.submittedBy.name} submitted feedback on ${f.sample.sampleCode}`,
      at: f.createdAt,
      href: `/library/${f.sample.id}`,
    });
  }

  return entries.sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, FEED_SIZE);
}
