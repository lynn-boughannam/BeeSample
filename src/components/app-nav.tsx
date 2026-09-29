"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { cn } from "@/lib/cn";
import { NavIcon } from "@/components/nav-icon";
import type { NavItem } from "@/lib/nav";

const ROW = "flex items-center rounded-lg text-body font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-light/40";
const IDLE = "text-neutral-light/70 hover:bg-neutral-light/10 hover:text-neutral-light";

function NavLink({
  item,
  isActive,
  collapsed,
  nested = false,
}: {
  item: NavItem;
  isActive: boolean;
  collapsed: boolean;
  nested?: boolean;
}) {
  return (
    <Link
      href={item.href}
      // Collapsed, the icon is the only cue, so the label has to reach both the
      // pointer (title) and the screen reader (aria-label).
      // The dot is decorative, so what it means is said here instead — a colour alone
      // reaches neither a screen reader nor anyone who can't tell red from grey.
      title={
        item.badge
          ? `${item.label} — ${item.badge} waiting on you`
          : collapsed
            ? item.label
            : undefined
      }
      aria-label={
        item.badge
          ? `${item.label}, ${item.badge} waiting on you`
          : collapsed
            ? item.label
            : undefined
      }
      className={cn(
        ROW,
        collapsed ? "justify-center p-2.5" : "gap-3 px-3 py-2",
        nested && !collapsed && "py-1.5",
        isActive ? "bg-brand-primary text-on-primary" : IDLE
      )}
    >
      <span className="relative shrink-0">
        <NavIcon navKey={item.key} className={cn(nested ? "h-4 w-4" : "h-5 w-5")} />
        {/* Collapsed, the icon is all there is, so the dot rides on it. */}
        {collapsed && item.badge ? (
          <span
            aria-hidden="true"
            className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-danger ring-2 ring-neutral-dark"
          />
        ) : null}
      </span>
      {!collapsed && <span className="truncate">{item.label}</span>}
      {!collapsed && item.badge ? (
        <span
          aria-hidden="true"
          className="ml-auto h-2 w-2 shrink-0 rounded-full bg-danger"
        />
      ) : null}
    </Link>
  );
}

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

  const mainItems = items.filter((item) => !item.group);
  const settingsItems = items.filter((item) => item.group === "settings");
  const settingsActive = settingsItems.some((item) => item.href === activeHref);

  // Starts open when the current page lives inside it, so the highlighted row is visible.
  const [settingsOpen, setSettingsOpen] = useState(settingsActive);

  return (
    <nav className={cn("flex flex-1 flex-col overflow-y-auto", collapsed ? "p-2" : "p-3")}>
      <div className="space-y-0.5">
        {mainItems.map((item) => (
          <NavLink key={item.key} item={item} isActive={item.href === activeHref} collapsed={collapsed} />
        ))}
      </div>

      {settingsItems.length > 0 && (
        <div className="mt-3 border-t border-neutral-light/10 pt-3">
          <button
            type="button"
            // MobileNav closes its drawer on any click inside the nav; opening the group
            // shouldn't count as navigating.
            onClick={(event) => {
              event.stopPropagation();
              setSettingsOpen((open) => !open);
            }}
            aria-expanded={settingsOpen}
            title={collapsed ? "System Settings" : undefined}
            aria-label={collapsed ? "System Settings" : undefined}
            className={cn(
              ROW,
              "w-full active:scale-[0.98]",
              collapsed ? "justify-center p-2.5" : "gap-3 px-3 py-2",
              // Folded away over the active page, the group itself carries the highlight.
              settingsActive && !settingsOpen ? "bg-neutral-light/10 text-neutral-light" : IDLE
            )}
          >
            <NavIcon navKey="settings" className="h-5 w-5 shrink-0" />
            {!collapsed && (
              <>
                <span className="flex-1 truncate text-left">System Settings</span>
                <svg
                  className={cn("h-4 w-4 shrink-0 transition-transform duration-200", settingsOpen && "rotate-180")}
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="m6 9 6 6 6-6" />
                </svg>
              </>
            )}
          </button>

          {settingsOpen && (
            <div
              className={cn(
                "mt-0.5 space-y-0.5",
                collapsed ? "rounded-lg bg-neutral-light/5 p-0.5" : "ml-5 border-l border-neutral-light/10 pl-2"
              )}
            >
              {settingsItems.map((item) => (
                <NavLink
                  key={item.key}
                  item={item}
                  isActive={item.href === activeHref}
                  collapsed={collapsed}
                  nested
                />
              ))}
            </div>
          )}
        </div>
      )}
    </nav>
  );
}
