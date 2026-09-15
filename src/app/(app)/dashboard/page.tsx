import { verifySession } from "@/lib/dal";
import { prisma } from "@/lib/prisma";
import { AdminDashboard } from "./admin-dashboard";

async function FormulatorDashboard({ userId }: { userId: string }) {
  const [myRequests, myOrders, feedbackDue] = await Promise.all([
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
  ]);

  return (
    <div className="space-y-8">
      <h1 className="text-page-title text-neutral-dark">Dashboard</h1>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="My Requests" value={myRequests.length} />
        <StatCard label="My Orders" value={myOrders.length} />
        <StatCard label="Feedback Due" value={feedbackDue.length} />
      </div>

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
            rows={myOrders.map((o) => [o.newRmName ?? "(existing RM)", o.supplier, o.status])}
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
