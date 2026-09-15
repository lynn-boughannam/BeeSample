import Link from "next/link";
import { verifySession } from "@/lib/dal";
import { prisma } from "@/lib/prisma";
import { shelfAddress } from "@/lib/categories";
import { PIECE_STATUS_LABELS, type PieceStatus } from "@/lib/stock";
import { Badge } from "@/components/ui/badge";

// SLT-57. Read-only by design: a Formulator never requests, checks out, or logs anything
// here. Everything on this page is a reflection of what an Admin already recorded through
// checkout (SLT-56) and usage logging (SLT-29), so there are no actions anywhere on it.

const day = (d: Date) => d.toISOString().slice(0, 10);

export default async function MyCheckoutsPage() {
  const session = await verifySession();
  const userId = session.user.id;

  const [current, history] = await Promise.all([
    prisma.samplePiece.findMany({
      where: { status: "CHECKED_OUT", checkedOutToUserId: userId },
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
      },
      orderBy: { checkedOutAt: "desc" },
    }),
    // Usage the Admin logged against a piece this user was holding. subjectUserId is what
    // makes this answerable — custody itself is cleared from the piece when usage is
    // logged, so the piece no longer knows who had it.
    prisma.transaction.findMany({
      where: { type: "RETURN_USAGE", subjectUserId: userId },
      include: {
        sample: { select: { id: true, sampleCode: true, rmName: true } },
        performedBy: { select: { name: true } },
        piece: { select: { pieceIndex: true, status: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const nothingEver = current.length === 0 && history.length === 0;

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="text-page-title text-neutral-dark">My checkouts</h1>
        <p className="text-body mt-1 text-neutral-dark/60">
          What the library currently has recorded against your name. This page is
          read-only — an Admin records checkouts and usage.
        </p>
      </div>

      {nothingEver ? (
        <section className="rounded-lg border border-neutral-dark/10 bg-white p-8 text-center shadow-elevated">
          <p className="text-body text-neutral-dark/60">
            Nothing has been checked out to you yet.
          </p>
          <p className="text-caption mt-1 text-neutral-dark/45">
            When an Admin checks a piece out to you, it will appear here.
          </p>
        </section>
      ) : (
        <>
          <section className="rounded-lg border border-neutral-dark/10 bg-white p-5 shadow-elevated">
            <h2 className="text-section-header mb-3 text-neutral-dark">
              Currently with me{" "}
              <span className="text-caption font-normal text-neutral-dark/50">
                ({current.length})
              </span>
            </h2>

            {current.length === 0 ? (
              <p className="text-body text-neutral-dark/50">
                You don&apos;t have anything checked out right now.
              </p>
            ) : (
              <ul className="divide-y divide-neutral-dark/8 rounded-md border border-neutral-dark/10">
                {current.map((piece) => (
                  <li key={piece.id}>
                    <Link
                      href={`/library/${piece.sample.id}`}
                      className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-3 transition-colors duration-150 hover:bg-neutral-dark/[0.03] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-primary"
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
                      <span className="text-caption text-neutral-dark/55">
                        since {piece.checkedOutAt ? day(piece.checkedOutAt) : "—"}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-lg border border-neutral-dark/10 bg-white p-5 shadow-elevated">
            <h2 className="text-section-header mb-3 text-neutral-dark">
              History{" "}
              <span className="text-caption font-normal text-neutral-dark/50">
                ({history.length})
              </span>
            </h2>

            {history.length === 0 ? (
              <p className="text-body text-neutral-dark/50">
                No usage has been logged against you yet.
              </p>
            ) : (
              <ul className="divide-y divide-neutral-dark/8 rounded-md border border-neutral-dark/10">
                {history.map((entry) => (
                  <li key={entry.id}>
                    <Link
                      href={`/library/${entry.sample.id}`}
                      className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-3 transition-colors duration-150 hover:bg-neutral-dark/[0.03] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-primary"
                    >
                      <span className="text-body font-medium text-neutral-dark">
                        {entry.sample.sampleCode}
                      </span>
                      <span className="text-body text-neutral-dark/80">
                        {entry.sample.rmName}
                      </span>
                      {entry.piece && (
                        <span className="text-caption text-neutral-dark/50">
                          piece #{entry.piece.pieceIndex}
                        </span>
                      )}
                      {/* Where the piece ended up after the usage was logged. */}
                      {entry.piece && (
                        <Badge
                          variant={entry.piece.status === "DEPLETED" ? "neutral" : "success"}
                        >
                          {PIECE_STATUS_LABELS[entry.piece.status as PieceStatus] ??
                            entry.piece.status}
                        </Badge>
                      )}
                      <span className="text-body ml-auto font-medium text-neutral-dark">
                        {Number(entry.quantityG ?? 0).toFixed(2)} g used
                      </span>
                      <span className="text-caption text-neutral-dark/55">
                        {day(entry.createdAt)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
