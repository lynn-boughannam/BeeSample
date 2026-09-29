import type { Role } from "@/lib/types";

export type NavItem = {
  key: string;
  label: string;
  href: string;
  roles: Role[];
  // Dashboard and Menu Settings are never hideable via Menu Settings.
  pinned?: boolean;
  // How many things behind this entry are waiting on the person looking. Set per request
  // in the layout and rendered as a dot, so a section that needs them says so from the
  // sidebar rather than only once they have opened it.
  badge?: number;
  // Items tagged "settings" are folded under the System Settings disclosure in the sidebar
  // instead of sitting in the main list.
  group?: "settings";
};

export const NAV_ITEMS: NavItem[] = [
  // Every role needs somewhere to land, including the two order-workflow roles whose
  // own screens arrive in later phases.
  { key: "dashboard", label: "Dashboard", href: "/dashboard", roles: ["ADMIN", "FORMULATOR", "DIRECTOR", "SUPPLY_CHAIN", "CSS"], pinned: true },
  { key: "library", label: "Sample Library", href: "/library", roles: ["ADMIN", "FORMULATOR"] },
  { key: "add-sample", label: "Add Sample", href: "/library/add", roles: ["ADMIN"] },
  { key: "locations", label: "Locations & Stock", href: "/locations", roles: ["ADMIN", "FORMULATOR"] },
  { key: "checked-out", label: "Checked Out", href: "/checked-out", roles: ["ADMIN"] },
  { key: "my-checkouts", label: "My Checkouts", href: "/my-checkouts", roles: ["FORMULATOR"] },
  { key: "ingredients", label: "Ingredient List", href: "/ingredients", roles: ["ADMIN", "FORMULATOR"] },
  { key: "requests", label: "Sample Requests", href: "/requests", roles: ["ADMIN", "FORMULATOR"] },
  // Supply Chain and CSS both work requests, and their own queues show only the rows that
  // have reached them — they need the list itself to read anything else.
  { key: "orders", label: "New Sample Orders", href: "/orders", roles: ["ADMIN", "FORMULATOR", "SUPPLY_CHAIN", "CSS"] },
  { key: "supply-chain", label: "Supply Chain", href: "/supply-chain", roles: ["ADMIN", "SUPPLY_CHAIN"] },
  { key: "css-review", label: "Document Review", href: "/css-review", roles: ["ADMIN", "CSS"] },
  { key: "pending-feedback", label: "Pending Feedback", href: "/pending-feedback", roles: ["ADMIN"] },
  { key: "feedback", label: "Sample Feedback", href: "/feedback", roles: ["ADMIN", "FORMULATOR"] },
  { key: "reports", label: "Reports", href: "/reports", roles: ["ADMIN"] },
  { key: "lists", label: "Reference Lists", href: "/settings/lists", roles: ["ADMIN"], group: "settings" },
  { key: "users", label: "User Settings", href: "/settings/users", roles: ["ADMIN"], group: "settings" },
  { key: "menu-settings", label: "Menu Settings", href: "/settings/menu", roles: ["ADMIN"], pinned: true, group: "settings" },
];
