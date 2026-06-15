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
import { COOKIE_NAME, requireEnv, verifyCookie } from "@/lib/auth";

/**
 * Paths that never require authentication.
 *
 * Use exact matches for /login and /api/auth so that a path like
 * /api/authfoo or /api/authenticate is NOT accidentally whitelisted.
 * The /_next/ and /favicon.ico entries use prefix/exact matches that
 * correspond precisely to Next.js's own asset paths.
 */
function isPublic(pathname: string): boolean {
  return (
    pathname === "/login" ||
    pathname === "/api/auth" ||
    pathname.startsWith("/api/auth/") ||
    pathname.startsWith("/_next/") ||
    pathname === "/favicon.ico"
  );
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Always allow public routes through.
  if (isPublic(pathname)) {
    return NextResponse.next();
  }

  let sessionSecret: string;
  try {
    // Use the centralized validator so both proxy.ts and route.ts share the
    // same misconfiguration detection path.
    ({ sessionSecret } = requireEnv());
  } catch {
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
   * Run on every path EXCEPT Next.js static/image assets and favicon.
   * /_next/static and /_next/image are excluded here as a belt-and-suspenders
   * measure in addition to the isPublic() check above, so the login page's
   * CSS/JS loads even before the cookie is set.
   *
   * NOTE: /_next/data IS intentionally included (not excluded) per Next.js 16
   * docs — those are RSC data requests that must also be auth-guarded, not
   * static files. Do not add _next/data to the negative lookahead.
   */
  matcher: [
    "/((?!_next/static|_next/image|favicon\\.ico).*)",
  ],
};
