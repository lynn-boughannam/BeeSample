import { requireAdmin } from "@/lib/dal";
import { prisma } from "@/lib/prisma";
import { CreateUserForm } from "./create-user-form";
import { UserRow } from "./user-row";

export default async function UserSettingsPage() {
  const session = await requireAdmin();
  const [users, roles] = await Promise.all([
    prisma.user.findMany({ orderBy: { name: "asc" }, include: { role: true } }),
    prisma.role.findMany({ orderBy: { name: "asc" } }),
  ]);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-neutral-900">User Settings</h1>

      <CreateUserForm roles={roles} />

      <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-neutral-50 text-xs font-medium text-neutral-500">
            <tr>
              <th className="px-4 py-2">Name</th>
              <th className="px-4 py-2">AD Username</th>
              <th className="px-4 py-2">Role</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <UserRow key={user.id} user={user} isSelf={user.id === session.user.id} roles={roles} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
