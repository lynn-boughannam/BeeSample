import Link from "next/link";
import { formatDay as day } from "@/lib/dates";
import { verifySession } from "@/lib/dal";
import { prisma } from "@/lib/prisma";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@/components/ui/table";
import {
  PIECE_REQUEST_STATUS_LABELS,
  PIECE_REQUEST_STATUS_VARIANT,
  canDecidePieceRequest,
  type PieceRequestStatus,
} from "@/lib/piece-requests";
import { DecideButtons } from "./decide-buttons";
import { CancelRequestButton } from "./cancel-button";
import { cancelPieceRequest, givePiece, rejectPieceRequest } from "./actions";

// Both halves of the story on one page, because it is one queue seen from two sides: the
// Admin answers requests, the requester watches their own. Which you get follows your role
// rather than a tab, since nobody is both.

export const dynamic = "force-dynamic";

const selectRequest = {
  id: true,
  status: true,
  createdAt: true,
  decidedAt: true,
  rejectionReason: true,
  purpose: true,
  requestedById: true,
  requestedBy: { select: { name: true } },
  decidedBy: { select: { name: true } },
  sample: { select: { id: true, sampleCode: true, rmName: true } },
  piece: {
    select: { pieceIndex: true, remainingWeightG: true, status: true },
  },
} as const;

export default async function RequestsPage() {
  const session = await verifySession();
  const decides = canDecidePieceRequest(session.user.role);

  // Oldest first for the Admin (AC B1): a queue is worked in the order it arrived, and the
  // longest wait is the one that matters. Their own requests read newest first, because
  // there the interesting one is what you just asked for.
  const [pending, history] = await Promise.all([
    prisma.sampleRequest.findMany({
      where: {
        status: "PENDING",
        ...(decides ? {} : { requestedById: session.user.id }),
      },
      select: selectRequest,
      orderBy: { createdAt: "asc" },
    }),
    prisma.sampleRequest.findMany({
      where: {
        status: { not: "PENDING" },
        ...(decides ? {} : { requestedById: session.user.id }),
      },
      select: selectRequest,
      orderBy: { decidedAt: "desc" },
      take: 50,
    }),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-page-title text-neutral-dark">Sample requests</h1>
        <p className="text-body mt-1 text-neutral-dark/60">
          {decides
            ? "Formulators asking for a specific piece. Oldest first — give it to them, or say why not."
            : "Pieces you have asked for. An Admin hands them over."}
        </p>
      </div>

      <section>
        <h2 className="text-section-header mb-2 text-neutral-dark">
          {decides ? "Waiting on you" : "Waiting on an Admin"}
          {pending.length > 0 ? ` · ${pending.length}` : ""}
        </h2>
        <Table>
          <TableHead>
            <TableRow>
              <TableHeaderCell>Asked</TableHeaderCell>
              {decides && <TableHeaderCell>Formulator</TableHeaderCell>}
              <TableHeaderCell>Sample</TableHeaderCell>
              <TableHeaderCell>Piece</TableHeaderCell>
              <TableHeaderCell>Purpose</TableHeaderCell>
              <TableHeaderCell>{decides ? "Hand over" : ""}</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {pending.length === 0 ? (
              <TableEmpty
                colSpan={decides ? 6 : 5}
                message={
                  decides
                    ? "Nothing is waiting on you."
                    : "You haven't asked for any pieces. Open a sample and pick one."
                }
              />
            ) : (
              pending.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>{day(r.createdAt)}</TableCell>
                  {decides && <TableCell>{r.requestedBy.name}</TableCell>}
                  <TableCell>
                    <Link
                      href={`/library/${r.sample.id}`}
                      className="font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-secondary"
                    >
                      {r.sample.sampleCode}
                    </Link>
                    <span className="text-caption block text-neutral-dark/50">
                      {r.sample.rmName}
                    </span>
                  </TableCell>
                  <TableCell>
                    {r.piece ? (
                      <>
                        #{r.piece.pieceIndex}
                        <span className="text-caption block text-neutral-dark/50">
                          {r.piece.remainingWeightG.toString()} g left
                        </span>
                      </>
                    ) : (
                      <span className="text-neutral-dark/35">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {r.purpose || <span className="text-neutral-dark/35">—</span>}
                  </TableCell>
                  <TableCell>
                    {decides ? (
                      <DecideButtons
                        requestId={r.id}
                        formulatorName={r.requestedBy.name}
                        pieceLabel={
                          r.piece
                            ? `piece #${r.piece.pieceIndex} of ${r.sample.sampleCode}`
                            : r.sample.sampleCode
                        }
                        giveAction={givePiece}
                        rejectAction={rejectPieceRequest}
                      />
                    ) : (
                      <CancelRequestButton requestId={r.id} action={cancelPieceRequest} />
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </section>

      <section>
        <h2 className="text-section-header mb-2 text-neutral-dark">Answered</h2>
        <Table>
          <TableHead>
            <TableRow>
              <TableHeaderCell>Answered</TableHeaderCell>
              {decides && <TableHeaderCell>Formulator</TableHeaderCell>}
              <TableHeaderCell>Sample</TableHeaderCell>
              <TableHeaderCell>Piece</TableHeaderCell>
              <TableHeaderCell>Outcome</TableHeaderCell>
              <TableHeaderCell>By</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {history.length === 0 ? (
              <TableEmpty colSpan={decides ? 6 : 5} message="Nothing answered yet." />
            ) : (
              history.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>{r.decidedAt ? day(r.decidedAt) : "—"}</TableCell>
                  {decides && <TableCell>{r.requestedBy.name}</TableCell>}
                  <TableCell>
                    <Link
                      href={`/library/${r.sample.id}`}
                      className="font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-secondary"
                    >
                      {r.sample.sampleCode}
                    </Link>
                  </TableCell>
                  <TableCell>
                    {r.piece ? `#${r.piece.pieceIndex}` : <span className="text-neutral-dark/35">—</span>}
                  </TableCell>
                  <TableCell>
                    <span className="flex flex-col items-start gap-1">
                      <Badge
                        variant={
                          PIECE_REQUEST_STATUS_VARIANT[r.status as PieceRequestStatus] ?? "neutral"
                        }
                      >
                        {PIECE_REQUEST_STATUS_LABELS[r.status as PieceRequestStatus] ?? r.status}
                      </Badge>
                      {/* AC B3 — the requester reads the reason, so it travels with the row
                          rather than living only in an Admin's memory. */}
                      {r.rejectionReason && (
                        <span className="text-caption text-neutral-dark/70">
                          {r.rejectionReason}
                        </span>
                      )}
                    </span>
                  </TableCell>
                  <TableCell>
                    {r.decidedBy?.name ?? <span className="text-neutral-dark/35">—</span>}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </section>
    </div>
  );
}
