// Deliberately its own module rather than an export from desktop-sidebar.tsx: that file is
// a "use client" module, and anything a Server Component imports from one arrives as a
// client reference proxy instead of the value. Passing that proxy to cookies().get()
// silently matches nothing — the cookie is present in getAll() but never found by name.
export const SIDEBAR_COOKIE = "slt.sidebar";

export type SidebarState = "collapsed" | "expanded";
