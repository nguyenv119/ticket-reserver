/**
 * Next.js 16 Proxy (replaces middleware.ts).
 *
 * Guards all application routes behind a shared password. Unauthenticated
 * requests are redirected to /login. Authenticated state is stored in a
 * signed httpOnly cookie whose value is an HMAC of APP_PASSWORD keyed by
 * SESSION_SECRET.
 *
 * Runtime: Node.js (Next.js 16 default — do NOT add a `runtime` export, it
 * will throw). node:crypto is available.
 */
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { COOKIE_NAME, verifyCookie } from "@/lib/auth";

/** Paths that never require authentication. */
const PUBLIC_PREFIXES = [
  "/login",
  "/api/auth",
  "/_next/",
  "/favicon.ico",
];

function isPublic(pathname: string): boolean {
  return PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Always allow public routes through.
  if (isPublic(pathname)) {
    return NextResponse.next();
  }

  const sessionSecret = process.env.SESSION_SECRET;
  if (!sessionSecret) {
    // Misconfiguration: fail closed — redirect to login rather than exposing
    // the app with no auth.
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("error", "misconfigured");
    return NextResponse.redirect(loginUrl);
  }

  const cookieValue = request.cookies.get(COOKIE_NAME)?.value ?? "";

  let authenticated = false;
  try {
    authenticated = verifyCookie(cookieValue, sessionSecret);
  } catch {
    // verifyCookie throws if APP_PASSWORD is missing — fail closed.
    authenticated = false;
  }

  if (!authenticated) {
    const loginUrl = new URL("/login", request.url);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  /*
   * Run on every path EXCEPT Next.js internals and static assets.
   * /_next/ and /favicon.ico are excluded here as a belt-and-suspenders
   * measure in addition to the isPublic() check above, so the login page's
   * CSS/JS loads even before the cookie is set.
   */
  matcher: [
    "/((?!_next/static|_next/image|favicon\\.ico).*)",
  ],
};
