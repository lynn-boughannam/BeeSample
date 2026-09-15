import { cookies } from "next/headers";
import { verifySession } from "@/lib/dal";
import { prisma } from "@/lib/prisma";
import { NAV_ITEMS } from "@/lib/nav";
import { SignOutButton } from "@/components/sign-out-button";
import { DesktopSidebar } from "@/components/desktop-sidebar";
import { MobileNav } from "@/components/mobile-nav";
import { SIDEBAR_COOKIE } from "@/lib/sidebar";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await verifySession();
  const role = session.user.role;
  const userName = session.user.name ?? "?";

  const hiddenSettings = await prisma.menuSetting.findMany({
    where: { role, isHidden: true },
  });
  const hiddenKeys = new Set(hiddenSettings.map((s) => s.navKey));

  const items = NAV_ITEMS.filter(
    (item) => item.roles.includes(role) && (item.pinned || !hiddenKeys.has(item.key))
  );

  // Read on the server so the sidebar renders at its saved width immediately, instead of
  // flashing open and collapsing once the client picks the preference up.
  const cookieStore = await cookies();
  const collapsed = cookieStore.get(SIDEBAR_COOKIE)?.value === "collapsed";

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <MobileNav items={items} userName={userName} role={role} signOutSlot={<SignOutButton />} />

      {/* Hidden below md — formulators may check samples from a tablet/phone on the shelf
          floor (design.md), so the sidebar becomes MobileNav's off-canvas drawer rather
          than squeezing page content into a sliver. */}
      <DesktopSidebar
        items={items}
        userName={userName}
        role={role}
        defaultCollapsed={collapsed}
        signOutSlot={<SignOutButton />}
        signOutIconSlot={<SignOutButton variant="icon" />}
      />

      <main className="min-w-0 flex-1 bg-neutral-light p-5 md:p-8">{children}</main>
    </div>
  );
}
