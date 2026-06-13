/**
 * Tests for proxy.ts — the Next.js 16 auth guard.
 *
 * Tests the exported `proxy` function using real NextRequest instances.
 * No mocking of Next.js internals — the function is pure logic over the
 * request URL and cookies.
 *
 * Runs with: ./node_modules/.bin/tsx --test __tests__/proxy.test.mts
 */
import { describe, it, before, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

let proxyFn: (req: NextRequest) => Response | undefined;
let signCookie: (password: string, secret: string) => string;
let COOKIE_NAME: string;

const TEST_PASSWORD = "demo-magic-2026";
const TEST_SECRET = "test-session-secret";

before(async () => {
  const proxyMod = await import("../proxy.js");
  proxyFn = proxyMod.proxy;
  const authMod = await import("../lib/auth.js");
  signCookie = authMod.signCookie;
  COOKIE_NAME = authMod.COOKIE_NAME;
});

// Control env vars per test.
const origEnv = { ...process.env };
beforeEach(() => {
  process.env.APP_PASSWORD = TEST_PASSWORD;
  process.env.SESSION_SECRET = TEST_SECRET;
});
afterEach(() => {
  process.env.APP_PASSWORD = origEnv.APP_PASSWORD;
  process.env.SESSION_SECRET = origEnv.SESSION_SECRET;
});

function makeRequest(path: string, cookieHeader?: string): NextRequest {
  const url = `http://localhost${path}`;
  const headers: Record<string, string> = {};
  if (cookieHeader) headers["cookie"] = cookieHeader;
  return new NextRequest(url, { headers });
}

function cookieHeader(name: string, value: string): string {
  return `${name}=${value}`;
}

describe("proxy — public route allowlist", () => {
  it("passes /login through without a cookie", () => {
    /**
     * /login must be reachable before authentication so users can submit
     * the password form. Blocking /login would create a lock-out deadlock.
     */
    // GIVEN
    const req = makeRequest("/login");

    // WHEN
    const res = proxyFn(req) as Response;

    // THEN — NextResponse.next() has no Location header (not a redirect)
    assert.ok(!res.headers.get("location"), "should not redirect /login");
  });

  it("passes /api/auth through without a cookie", () => {
    /**
     * The password submission endpoint must be reachable before login.
     * Blocking /api/auth would make it impossible to ever authenticate.
     */
    // GIVEN
    const req = makeRequest("/api/auth");

    // WHEN
    const res = proxyFn(req) as Response;

    // THEN
    assert.ok(!res.headers.get("location"), "should not redirect /api/auth");
  });

  it("passes /_next/static paths through without a cookie", () => {
    /**
     * Static asset paths must not require auth — the login page's JS and
     * CSS load via /_next/static before any cookie is set. Blocking them
     * produces a blank/unstyled login page.
     */
    // GIVEN
    const req = makeRequest("/_next/static/chunks/main.js");

    // WHEN
    const res = proxyFn(req) as Response;

    // THEN
    assert.ok(!res.headers.get("location"), "should not redirect _next/static");
  });

  it("passes /favicon.ico through without a cookie", () => {
    /**
     * favicon.ico is fetched before any interaction; blocking it with a
     * redirect loop causes unnecessary noise in browser devtools.
     */
    // GIVEN
    const req = makeRequest("/favicon.ico");

    // WHEN
    const res = proxyFn(req) as Response;

    // THEN
    assert.ok(!res.headers.get("location"), "should not redirect favicon.ico");
  });
});

describe("proxy — unauthenticated requests", () => {
  it("redirects / to /login when no cookie is present", () => {
    /**
     * Core protection: the root page must be behind auth. Without this,
     * the seat-holding dashboard is publicly accessible on the deployed URL.
     */
    // GIVEN
    const req = makeRequest("/");

    // WHEN
    const res = proxyFn(req) as Response;

    // THEN
    const location = res.headers.get("location") ?? "";
    assert.ok(location.includes("/login"), `expected redirect to /login, got: ${location}`);
  });

  it("redirects /api/jobs to /login when no cookie is present", () => {
    /**
     * The jobs API must also be guarded so unauthenticated callers cannot
     * read or create seat-hold jobs via direct API access.
     */
    // GIVEN
    const req = makeRequest("/api/jobs");

    // WHEN
    const res = proxyFn(req) as Response;

    // THEN
    const location = res.headers.get("location") ?? "";
    assert.ok(location.includes("/login"), `expected redirect to /login, got: ${location}`);
  });

  it("redirects when cookie value is tampered", () => {
    /**
     * A modified cookie must be rejected, not silently accepted. Without
     * this check, an attacker who knows the cookie name but not the HMAC
     * could gain access by guessing or brute-forcing the value.
     */
    // GIVEN
    const validToken = signCookie(TEST_PASSWORD, TEST_SECRET);
    const tampered = validToken.slice(0, -4) + "XXXX";
    const req = makeRequest("/", cookieHeader(COOKIE_NAME, tampered));

    // WHEN
    const res = proxyFn(req) as Response;

    // THEN
    const location = res.headers.get("location") ?? "";
    assert.ok(location.includes("/login"), "tampered cookie must redirect to login");
  });
});

describe("proxy — authenticated requests", () => {
  it("passes / through when a valid signed cookie is present", () => {
    /**
     * A correctly signed cookie must grant access. If this fails, users
     * with a valid session are endlessly redirected to login.
     */
    // GIVEN
    const token = signCookie(TEST_PASSWORD, TEST_SECRET);
    const req = makeRequest("/", cookieHeader(COOKIE_NAME, token));

    // WHEN
    const res = proxyFn(req) as Response;

    // THEN
    assert.ok(!res.headers.get("location"), "valid cookie must not redirect");
  });

  it("passes /api/jobs through when a valid signed cookie is present", () => {
    /**
     * Auth must allow API access for authenticated sessions, not just page
     * loads — the dashboard polls /api/jobs on a 1.5 s interval.
     */
    // GIVEN
    const token = signCookie(TEST_PASSWORD, TEST_SECRET);
    const req = makeRequest("/api/jobs", cookieHeader(COOKIE_NAME, token));

    // WHEN
    const res = proxyFn(req) as Response;

    // THEN
    assert.ok(!res.headers.get("location"), "authenticated /api/jobs must not redirect");
  });
});

describe("proxy — misconfiguration", () => {
  it("redirects to /login when SESSION_SECRET is missing", () => {
    /**
     * Missing SESSION_SECRET must fail closed — redirect to login rather
     * than granting access or crashing. An uncaught exception in proxy
     * would block all traffic with a 500 error.
     */
    // GIVEN
    delete process.env.SESSION_SECRET;
    const req = makeRequest("/");

    // WHEN
    const res = proxyFn(req) as Response;

    // THEN
    const location = res.headers.get("location") ?? "";
    assert.ok(location.includes("/login"), "missing SESSION_SECRET must redirect to /login");
  });

  it("redirects to /login when APP_PASSWORD is missing, even with a valid-looking cookie", () => {
    /**
     * Missing APP_PASSWORD must fail closed — verifyCookie throws when
     * APP_PASSWORD is unset, and the proxy's catch block must redirect to
     * /login rather than granting access. Without this, a misconfigured
     * deployment with no APP_PASSWORD set would grant access to any request
     * that carries a cookie (or even no cookie at all).
     */
    // GIVEN
    const validLookingCookie = signCookie(TEST_PASSWORD, TEST_SECRET);
    delete process.env.APP_PASSWORD;
    const req = makeRequest("/", cookieHeader(COOKIE_NAME, validLookingCookie));

    // WHEN
    const res = proxyFn(req) as Response;

    // THEN
    const location = res.headers.get("location") ?? "";
    assert.ok(location.includes("/login"), "missing APP_PASSWORD must redirect to /login");
  });
});
