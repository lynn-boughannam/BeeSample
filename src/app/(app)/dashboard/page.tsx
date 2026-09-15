import Link from "next/link";
import { verifySession } from "@/lib/dal";
import { prisma } from "@/lib/prisma";
import { AdminDashboard } from "./admin-dashboard";
import { CheckoutSince, checkoutRowClass } from "@/components/checkout-since";
import { orderLabel } from "@/lib/orders";

async function FormulatorDashboard({ userId }: { userId: string }) {
  const [myRequests, myOrders, feedbackDue, myPieces] = await Promise.all([
    prisma.sampleRequest.findMany({
      where: { requestedById: userId },
      include: { sample: true },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
    prisma.sampleOrder.findMany({
      where: { orderedById: userId },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
    prisma.sampleRequest.findMany({
      where: { requestedById: userId, status: "APPROVED", feedback: null },
      include: { sample: true },
    }),
    // SLT-40. Pieces an Admin currently has checked out to this user — read-only, same
    // as everywhere else a Formulator sees their custody.
    prisma.samplePiece.findMany({
      where: { status: "CHECKED_OUT", checkedOutToUserId: userId },
      include: { sample: { select: { id: true, sampleCode: true, rmName: true } } },
      orderBy: { checkedOutAt: "desc" },
    }),
  ]);

  return (
    <div className="space-y-8">
      <h1 className="text-page-title text-neutral-dark">Dashboard</h1>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="Currently With You" value={myPieces.length} />
        <StatCard label="My Requests" value={myRequests.length} />
        <StatCard label="My Orders" value={myOrders.length} />
        <StatCard label="Feedback Due" value={feedbackDue.length} />
      </div>

      <Section title="Samples Currently With You">
        {myPieces.length === 0 ? (
          <Empty />
        ) : (
          <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white">
            <ul className="divide-y divide-neutral-dark/8">
              {myPieces.map((piece) => (
                <li key={piece.id}>
                  <Link
                    href={`/library/${piece.sample.id}`}
                    className={`flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-3 transition-colors duration-150 hover:bg-neutral-dark/[0.03] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-primary ${checkoutRowClass(piece.checkedOutAt)}`}
                  >
                    <span className="text-body font-medium text-neutral-dark">
                      {piece.sample.sampleCode}
                    </span>
                    <span className="text-body text-neutral-dark/80">{piece.sample.rmName}</span>
                    <span className="text-caption text-neutral-dark/50">
                      piece #{piece.pieceIndex}
                    </span>
                    <span className="text-body ml-auto font-medium text-neutral-dark">
                      {Number(piece.remainingWeightG).toFixed(2)} g
                    </span>
                    {/* Identical component to both other screens, so the colour matches. */}
                    <CheckoutSince checkedOutAt={piece.checkedOutAt} />
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Section>

      <Section title="Feedback Due">
        {feedbackDue.length === 0 ? (
          <Empty />
        ) : (
          <Table
            rows={feedbackDue.map((r) => [r.sample.rmName, `${r.amountG}g`, r.purpose])}
            headers={["Sample", "Amount", "Purpose"]}
          />
        )}
      </Section>

      <Section title="My Requests">
        {myRequests.length === 0 ? (
          <Empty />
        ) : (
          <Table
            rows={myRequests.map((r) => [r.sample.rmName, `${r.amountG}g`, r.status])}
            headers={["Sample", "Amount", "Status"]}
          />
        )}
      </Section>

      <Section title="My Orders">
        {myOrders.length === 0 ? (
          <Empty />
        ) : (
          <Table
            rows={myOrders.map((o) => [orderLabel(o), o.supplierName ?? o.supplier1 ?? "—", o.status])}
            headers={["RM", "Supplier", "Status"]}
          />
        )}
      </Section>
    </div>
  );
}

export default async function DashboardPage() {
  const session = await verifySession();

  return session.user.role === "ADMIN" ? (
    <AdminDashboard />
  ) : (
    <FormulatorDashboard userId={session.user.id} />
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-neutral-dark/10 bg-white p-4 shadow-elevated">
      <p className="text-caption font-medium text-neutral-dark/60">{label}</p>
      <p className="text-page-title mt-1 text-neutral-dark">{value}</p>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold text-neutral-900">{title}</h2>
      {children}
    </section>
  );
}

function Empty() {
  return <p className="text-sm text-neutral-400">Nothing here right now.</p>;
}

function Table({ headers, rows }: { headers: string[]; rows: (string | number)[][] }) {
  return (
    <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white">
      <table className="w-full text-left text-sm">
        <thead className="bg-neutral-50 text-xs font-medium text-neutral-500">
          <tr>
            {headers.map((h) => (
              <th key={h} className="px-4 py-2">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-100">
          {rows.map((row, i) => (
            <tr key={i}>
              {row.map((cell, j) => (
                <td key={j} className="px-4 py-2 text-neutral-700">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
