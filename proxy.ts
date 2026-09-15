import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { auth } from "@/lib/auth";

// Optimistic check only — reads the session cookie, does not hit the DB.
// Real per-route/per-action authorization lives in src/lib/dal.ts.
const publicRoutes = ["/login"];

export default async function proxy(req: NextRequest) {
  const session = await auth();
  const path = req.nextUrl.pathname;
  const isPublicRoute = publicRoutes.includes(path);

  if (!session?.user && !isPublicRoute) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  if (session?.user && isPublicRoute) {
    return NextResponse.redirect(new URL("/dashboard", req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
