"use client";

import { useState } from "react";
import Image from "next/image";
import { AppNav } from "@/components/app-nav";
import { RoleBadge } from "@/components/role-badge";
import type { NavItem } from "@/lib/nav";
import type { Role } from "@/lib/types";

// SignOutButton is passed in as a rendered slot, not imported here — it's a Server
// Component (its inline server action pulls in Prisma/mssql), and a Client Component
// module can't import a Server Component that way; the RSC boundary only allows it to
// arrive as an already-rendered child/prop from the server-rendered parent.
export function MobileNav({
  items,
  userName,
  role,
  signOutSlot,
}: {
  items: NavItem[];
  userName: string;
  role: Role;
  signOutSlot: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="md:hidden">
      <div className="flex items-center justify-between bg-neutral-dark px-4 py-3">
        <Image src="/brand/logo-dark.jpg" alt="BeeSample" width={120} height={76} />
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open menu"
          className="rounded-lg p-2 text-neutral-light focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-light/40"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
      </div>

      {open && (
        <div className="fixed inset-0 z-50 flex">
          <div className="flex w-72 flex-col bg-neutral-dark shadow-floating">
            <div className="flex items-center justify-between px-5 py-5">
              <Image src="/brand/logo-dark.jpg" alt="BeeSample" width={140} height={88} />
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close menu"
                className="rounded-lg p-1 text-neutral-light focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-light/40"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </div>
            <div className="mx-5 mb-4 flex items-center gap-2 border-t border-neutral-light/10 pt-4">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-neutral-light/10 text-caption font-semibold text-neutral-light">
                {userName.charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-body font-medium text-neutral-light">{userName}</p>
              </div>
              <RoleBadge role={role} />
            </div>
            <div onClick={() => setOpen(false)}>
              <AppNav items={items} />
            </div>
            <div className="border-t border-neutral-light/10 p-3">{signOutSlot}</div>
          </div>
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setOpen(false)}
            className="flex-1 bg-neutral-dark/40"
          />
        </div>
      )}
    </div>
  );
}
