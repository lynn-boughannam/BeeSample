import Link from "next/link";
import { requireAdmin } from "@/lib/dal";
import { prisma } from "@/lib/prisma";
import { shelfAddress } from "@/lib/categories";
import { getCheckoutWarningLevel } from "@/lib/stock";
import { CheckoutSince, checkoutRowClass } from "@/components/checkout-since";
import { Badge } from "@/components/ui/badge";

// Where the dashboard's "Checked Out" KPI leads: every piece currently out, and who has
// it. Grouped by person rather than by sample, because the question this page answers is
// "who do I need to chase", not "where is this sample".

export default async function CheckedOutPage() {
  await requireAdmin();

  const pieces = await prisma.samplePiece.findMany({
    where: { status: "CHECKED_OUT" },
    include: {
      sample: {
        select: {
          id: true,
          sampleCode: true,
          rmName: true,
          shelfLetter: true,
          shelfLevel: true,
          shelfSublevel: true,
        },
      },
      checkedOutToUser: { select: { id: true, name: true } },
    },
    orderBy: { checkedOutAt: "asc" },
  });

  // Grouped by holder. A piece with no user attached shouldn't vanish from the list — it
  // still isn't on the shelf — so it gets its own bucket rather than being dropped.
  const groups = new Map<
    string,
    { name: string; pieces: typeof pieces; overdue: number; oldest: Date | null }
  >();

  for (const piece of pieces) {
    const key = piece.checkedOutToUser?.id ?? "__unassigned__";
    const group = groups.get(key) ?? {
      name: piece.checkedOutToUser?.name ?? "Not recorded",
      pieces: [] as typeof pieces,
      overdue: 0,
      oldest: null as Date | null,
    };
    group.pieces.push(piece);
    if (getCheckoutWarningLevel(piece.checkedOutAt) === "OVERDUE") group.overdue++;
    if (piece.checkedOutAt && (!group.oldest || piece.checkedOutAt < group.oldest)) {
      group.oldest = piece.checkedOutAt;
    }
    groups.set(key, group);
  }

  // Whoever has been holding something longest comes first — the point of the page is to
  // surface what needs chasing, not to be an alphabetical directory.
  const ordered = [...groups.values()].sort((a, b) => {
    if (a.overdue !== b.overdue) return b.overdue - a.overdue;
    return (a.oldest?.getTime() ?? 0) - (b.oldest?.getTime() ?? 0);
  });

  const totalOverdue = pieces.filter(
    (p) => getCheckoutWarningLevel(p.checkedOutAt) === "OVERDUE"
  ).length;

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="text-page-title text-neutral-dark">Checked out</h1>
        <p className="text-body mt-1 text-neutral-dark/60">
          {pieces.length === 0
            ? "Nothing is checked out right now."
            : `${pieces.length} piece${pieces.length === 1 ? "" : "s"} out to ${ordered.length} ${
                ordered.length === 1 ? "person" : "people"
              }${totalOverdue > 0 ? ` · ${totalOverdue} overdue` : ""}.`}
        </p>
      </div>

      {pieces.length === 0 ? (
        <section className="rounded-lg border border-neutral-dark/10 bg-white p-8 text-center shadow-elevated">
          <p className="text-body text-neutral-dark/60">Every piece is on the shelf.</p>
          <p className="text-caption mt-1 text-neutral-dark/45">
            Checkouts are recorded from a sample&apos;s Stock by piece section.
          </p>
        </section>
      ) : (
        <div className="space-y-5">
          {ordered.map((group) => (
            <section
              key={group.name}
              className="rounded-lg border border-neutral-dark/10 bg-white p-5 shadow-elevated"
            >
              <h2 className="text-section-header mb-3 flex flex-wrap items-baseline gap-x-3 text-neutral-dark">
                {group.name}
                <span className="text-caption font-normal text-neutral-dark/50">
                  {group.pieces.length} piece{group.pieces.length === 1 ? "" : "s"}
                </span>
                {group.overdue > 0 && (
                  <Badge variant="danger">
                    {group.overdue} overdue
                  </Badge>
                )}
              </h2>

              <ul className="divide-y divide-neutral-dark/8 overflow-hidden rounded-md border border-neutral-dark/10">
                {group.pieces.map((piece) => (
                  <li key={piece.id}>
                    <Link
                      href={`/library/${piece.sample.id}`}
                      className={`flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-3 transition-colors duration-150 hover:bg-neutral-dark/[0.03] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-primary ${checkoutRowClass(piece.checkedOutAt)}`}
                    >
                      <span className="text-body font-medium text-neutral-dark">
                        {piece.sample.sampleCode}
                      </span>
                      <span className="text-body text-neutral-dark/80">
                        {piece.sample.rmName}
                      </span>
                      <Badge variant="neutral">
                        Shelf{" "}
                        {shelfAddress(
                          piece.sample.shelfLetter,
                          piece.sample.shelfLevel,
                          piece.sample.shelfSublevel
                        )}
                      </Badge>
                      <span className="text-caption text-neutral-dark/50">
                        piece #{piece.pieceIndex}
                      </span>
                      <span className="text-body ml-auto font-medium text-neutral-dark">
                        {Number(piece.remainingWeightG).toFixed(2)} g
                      </span>
                      <CheckoutSince checkedOutAt={piece.checkedOutAt} />
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
