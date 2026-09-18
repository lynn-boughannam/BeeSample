import type { Role } from "@/lib/types";

// RBAC drives layout, not just visibility (design.md) — the role is a first-class,
// visually distinct part of the shell, not a small gray label.
const ROLE_STYLES: Record<Role, string> = {
  ADMIN: "bg-brand-primary text-on-primary",
  FORMULATOR: "bg-brand-accent text-on-accent",
  DIRECTOR: "bg-brand-soft text-on-soft",
  // The two sample-order workflow roles. Distinct from each other and from the three
  // above, since the shell shows the role on every page.
  SUPPLY_CHAIN: "bg-info text-on-info",
  CSS: "bg-warning text-on-warning",
};

export function RoleBadge({ role }: { role: Role }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-caption font-semibold ${ROLE_STYLES[role]}`}
    >
      {role}
    </span>
  );
}
