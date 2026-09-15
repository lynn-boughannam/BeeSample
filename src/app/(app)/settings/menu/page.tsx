import { requireAdmin } from "@/lib/dal";
import { prisma } from "@/lib/prisma";
import { NAV_ITEMS } from "@/lib/nav";
import { ROLES } from "@/lib/types";
import { MenuToggle } from "./menu-toggle";

export default async function MenuSettingsPage() {
  await requireAdmin();

  const settings = await prisma.menuSetting.findMany();
  const isHidden = (navKey: string, role: string) =>
    settings.find((s) => s.navKey === navKey && s.role === role)?.isHidden ?? false;

  // Dashboard and Menu Settings are always pinned (never hideable) — not shown as rows.
  const toggleableItems = NAV_ITEMS.filter((item) => !item.pinned);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-neutral-900">Menu Settings</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Hide or unhide nav sections per role. Dashboard and Menu Settings are always visible.
        </p>
      </div>

      <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-neutral-50 text-xs font-medium text-neutral-500">
            <tr>
              <th className="px-4 py-2">Nav Item</th>
              {ROLES.map((role) => (
                <th key={role} className="px-4 py-2">
                  {role}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {toggleableItems.map((item) => (
              <tr key={item.key} className="border-t border-neutral-100">
                <td className="px-4 py-2 font-medium text-neutral-900">{item.label}</td>
                {ROLES.map((role) =>
                  item.roles.includes(role) ? (
                    <td key={role} className="px-4 py-2">
                      <MenuToggle
                        navKey={item.key}
                        role={role}
                        initiallyHidden={isHidden(item.key, role)}
                      />
                    </td>
                  ) : (
                    <td key={role} className="px-4 py-2 text-neutral-300">
                      —
                    </td>
                  )
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
