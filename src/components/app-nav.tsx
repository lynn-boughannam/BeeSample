"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";
import { NavIcon } from "@/components/nav-icon";
import type { NavItem } from "@/lib/nav";

export function AppNav({ items, collapsed = false }: { items: NavItem[]; collapsed?: boolean }) {
  const pathname = usePathname();

  // Prefix matching keeps a parent item lit on its nested routes (e.g. a future
  // /library/<id>), but on /library/add both "Sample Library" and "Add Sample" would
  // match. Only the most specific (longest) matching href wins, so exactly one item is
  // ever highlighted.
  const activeHref = items
    .filter((item) => pathname === item.href || pathname.startsWith(`${item.href}/`))
    .reduce<string | null>(
      (best, item) => (best === null || item.href.length > best.length ? item.href : best),
      null
    );

  return (
    <nav className={cn("flex-1 space-y-0.5", collapsed ? "p-2" : "p-3")}>
      {items.map((item) => {
        const isActive = item.href === activeHref;
        return (
          <Link
            key={item.key}
            href={item.href}
            // Collapsed, the icon is the only cue, so the label has to reach both the
            // pointer (title) and the screen reader (aria-label).
            title={collapsed ? item.label : undefined}
            aria-label={collapsed ? item.label : undefined}
            className={cn(
              "flex items-center rounded-lg text-body font-medium transition-colors duration-150",
              collapsed ? "justify-center p-2.5" : "gap-3 px-3 py-2",
              isActive
                ? "bg-brand-primary text-on-primary"
                : "text-neutral-light/70 hover:bg-neutral-light/10 hover:text-neutral-light"
            )}
          >
            <NavIcon navKey={item.key} className="h-5 w-5 shrink-0" />
            {!collapsed && <span className="truncate">{item.label}</span>}
          </Link>
        );
      })}
    </nav>
  );
}
