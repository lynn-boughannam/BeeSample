"use client";

import Image from "next/image";
import { useState } from "react";
import { AppNav } from "@/components/app-nav";
import { RoleBadge } from "@/components/role-badge";
import { cn } from "@/lib/cn";
import type { NavItem } from "@/lib/nav";
import { SIDEBAR_COOKIE } from "@/lib/sidebar";
import type { Role } from "@/lib/types";

// The collapsed state is mirrored into a cookie so the server renders the right width on
// the next request — the alternative (localStorage) would paint an expanded sidebar and
// then snap it closed on hydration.
function persist(collapsed: boolean) {
  const oneYear = 60 * 60 * 24 * 365;
  document.cookie = `${SIDEBAR_COOKIE}=${collapsed ? "collapsed" : "expanded"}; path=/; max-age=${oneYear}; samesite=lax`;
}

// SignOutButton is a Server Component (its inline server action pulls in Prisma/mssql), so
// both variants arrive already rendered rather than being imported here.
export function DesktopSidebar({
  items,
  userName,
  role,
  signOutSlot,
  signOutIconSlot,
  defaultCollapsed,
}: {
  items: NavItem[];
  userName: string;
  role: Role;
  signOutSlot: React.ReactNode;
  signOutIconSlot: React.ReactNode;
  defaultCollapsed: boolean;
}) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  function toggle() {
    setCollapsed((current) => {
      persist(!current);
      return !current;
    });
  }

  // Width changes instantly rather than transitioning: animating width reflows the whole
  // table on every frame, and design.md restricts motion to transform/opacity anyway. The
  // chevron rotation carries the state change instead.
  const toggleButton = (
    <button
      type="button"
      onClick={toggle}
      title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
      aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
      aria-expanded={!collapsed}
      className="rounded-lg p-1.5 text-neutral-light/60 transition-colors duration-150 hover:bg-neutral-light/10 hover:text-neutral-light focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-light/40 active:scale-95"
    >
      <svg
        className={cn("h-4 w-4 transition-transform duration-200", collapsed && "rotate-180")}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M13 6l-6 6 6 6" />
        <path d="M19 6l-6 6 6 6" />
      </svg>
    </button>
  );

  return (
    <aside
      className={cn(
        "hidden shrink-0 flex-col bg-neutral-dark md:flex",
        collapsed ? "w-16" : "w-64"
      )}
    >
      {collapsed ? (
        <div className="flex flex-col items-center gap-3 px-2 py-4">
          {/* logo-mark.jpg is a white mark baked onto pure black; screen blending drops
              the black so it sits on the charcoal rail with no visible tile edge. */}
          <Image
            src="/brand/logo-mark.jpg"
            alt="BeeSample"
            width={32}
            height={32}
            className="mix-blend-screen"
            priority
          />
          {toggleButton}
        </div>
      ) : (
        <div className="flex items-center justify-between gap-2 px-5 py-5">
          {/* bg-neutral-dark exactly matches logo-dark.jpg's baked-in background, so the
              raster composites seamlessly with no visible edge (see brand asset note). */}
          <Image src="/brand/logo-dark.jpg" alt="BeeSample" width={160} height={101} priority />
          {toggleButton}
        </div>
      )}

      <div
        className={cn(
          "mb-4 flex items-center border-t border-neutral-light/10 pt-4",
          collapsed ? "mx-2 justify-center" : "mx-5 gap-2"
        )}
      >
        <div
          title={collapsed ? `${userName} · ${role}` : undefined}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-neutral-light/10 text-caption font-semibold text-neutral-light"
        >
          {userName.charAt(0).toUpperCase()}
        </div>
        {!collapsed && (
          <>
            <div className="min-w-0 flex-1">
              <p className="truncate text-body font-medium text-neutral-light">{userName}</p>
            </div>
            <RoleBadge role={role} />
          </>
        )}
      </div>

      <AppNav items={items} collapsed={collapsed} />

      <div className={cn("border-t border-neutral-light/10", collapsed ? "p-2" : "p-3")}>
        {collapsed ? signOutIconSlot : signOutSlot}
      </div>
    </aside>
  );
}
