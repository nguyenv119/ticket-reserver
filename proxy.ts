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
import { COOKIE_NAME, requireEnv, verifyCookie, verifyAgentToken } from "@/lib/auth";

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

/**
 * Paths that the external rebook agent is allowed to reach via bearer token.
 *
 * Scoped narrowly to the two endpoints the agent actually needs:
 *   - GET /api/jobs — lists jobs so the agent can discover which need re-holding
 *   - POST /api/jobs/:id/heartbeat — updates hold_state / last_heartbeat_at
 *
 * All other routes (including /, /api/auth, and any future endpoints) are
 * NOT covered by this predicate and continue to require a human session cookie.
 * Bearer tokens must NOT grant access to the full site — a leaked AGENT_TOKEN
 * should expose only these two endpoints, not the admin UI.
 */
function isAgentPath(pathname: string): boolean {
  return (
    pathname === "/api/jobs" ||
    pathname.startsWith("/api/jobs/")
  );
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Always allow public routes through.
  if (isPublic(pathname)) {
    return NextResponse.next();
  }

  // Agent bearer-token bypass — checked BEFORE the cookie path so the agent
  // can call its endpoints without a browser session.
  //
  // Requirements:
  //   1. Path must be an agent endpoint (isAgentPath) — not the whole site.
  //   2. AGENT_TOKEN must be set in the environment (verifyAgentToken fails
  //      closed when it is unset/empty).
  //   3. The Authorization header must contain the correct "Bearer <token>".
  //
  // If all three hold, pass through immediately. Otherwise fall through to the
  // human cookie check below — this preserves the redirect behavior for wrong
  // or absent tokens on agent paths, and handles non-agent paths unchanged.
  if (isAgentPath(pathname)) {
    const authHeader = request.headers.get("authorization");
    if (verifyAgentToken(authHeader)) {
      return NextResponse.next();
    }
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
