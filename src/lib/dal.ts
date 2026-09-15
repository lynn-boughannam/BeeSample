import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import type { Role } from "@/lib/types";

// Real authorization lives here, not in proxy.ts (proxy only does an optimistic
// cookie-presence redirect). Every Server Action, Route Handler, and page that
// touches protected data must call one of these.

export const verifySession = cache(async () => {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }
  return session;
});

export const getOptionalSession = cache(async () => {
  return auth();
});

export async function requireRole(role: Role) {
  const session = await verifySession();
  if (session.user.role !== role) {
    redirect("/dashboard");
  }
  return session;
}

export async function requireAdmin() {
  return requireRole("ADMIN");
}
