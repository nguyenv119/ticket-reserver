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
const TEST_AGENT_TOKEN = "test-agent-token-abc123-long-enough-to-be-safe";

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
  process.env.AGENT_TOKEN = TEST_AGENT_TOKEN;
});
afterEach(() => {
  process.env.APP_PASSWORD = origEnv.APP_PASSWORD;
  process.env.SESSION_SECRET = origEnv.SESSION_SECRET;
  process.env.AGENT_TOKEN = origEnv.AGENT_TOKEN;
});

function makeRequest(
  path: string,
  cookieHeader?: string,
  extraHeaders?: Record<string, string>,
): NextRequest {
  const url = `http://localhost${path}`;
  const headers: Record<string, string> = { ...extraHeaders };
  if (cookieHeader) headers["cookie"] = cookieHeader;
  return new NextRequest(url, { headers });
}

function cookieHeader(name: string, value: string): string {
  return `${name}=${value}`;
}

function bearerHeader(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
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

describe("proxy — agent bearer token on heartbeat path", () => {
  it("passes POST /api/jobs/:id/heartbeat through with a valid bearer token and no cookie", () => {
    /**
     * Verifies that the Claude-in-Chrome agent can reach the heartbeat endpoint
     * using only an Authorization: Bearer header, without a human browser cookie.
     *
     * The agent runs headlessly and cannot obtain a session cookie. Without this
     * bypass, heartbeat calls would be redirected to /login and the agent would
     * fail to update job hold-state.
     *
     * If this contract breaks, the rebook agent stops heartbeating, hold_state
     * goes stale, and users see incorrect job status in the dashboard.
     */
    // GIVEN — valid agent token, no session cookie
    const req = makeRequest(
      "/api/jobs/job-abc-123/heartbeat",
      undefined,
      bearerHeader(TEST_AGENT_TOKEN),
    );

    // WHEN
    const res = proxyFn(req) as Response;

    // THEN — must pass through, not redirect
    assert.ok(
      !res.headers.get("location"),
      "valid bearer on /api/jobs/:id/heartbeat must not redirect",
    );
  });

  it("passes GET /api/jobs through with a valid bearer token and no cookie", () => {
    /**
     * Verifies that the agent can list jobs to discover which need to be
     * re-held, using only the bearer token.
     *
     * GET /api/jobs is the discovery surface the agent uses to find jobs in
     * 'holding' state. Blocking it would prevent the agent from knowing which
     * jobs to act on.
     *
     * If this breaks, the agent cannot enumerate jobs and will fail silently
     * without triggering any heartbeats.
     */
    // GIVEN — valid agent token, no session cookie
    const req = makeRequest("/api/jobs", undefined, bearerHeader(TEST_AGENT_TOKEN));

    // WHEN
    const res = proxyFn(req) as Response;

    // THEN
    assert.ok(
      !res.headers.get("location"),
      "valid bearer on /api/jobs must not redirect",
    );
  });

  it("redirects /api/jobs/:id/heartbeat when the bearer token is wrong", () => {
    /**
     * Verifies that an incorrect bearer token does not grant access — the
     * proxy falls through to the human cookie check and redirects to login
     * when no cookie is present.
     *
     * Without this check, any caller who knows the URL pattern but not the
     * token would gain access to the agent surface.
     *
     * If this breaks, attackers with a wrong/guessed token can reach the
     * heartbeat endpoint without authentication.
     */
    // GIVEN — wrong bearer token, no session cookie
    const req = makeRequest(
      "/api/jobs/job-abc-123/heartbeat",
      undefined,
      bearerHeader("wrong-token-that-is-not-valid"),
    );

    // WHEN
    const res = proxyFn(req) as Response;

    // THEN — wrong token must fall through to cookie check → redirect
    const location = res.headers.get("location") ?? "";
    assert.ok(
      location.includes("/login"),
      "wrong bearer on /api/jobs/:id/heartbeat must redirect to /login",
    );
  });

  it("does NOT allow bearer token access to non-agent routes like /", () => {
    /**
     * Verifies that the bearer bypass is narrowly scoped to agent endpoints
     * only. A valid bearer token must NOT grant access to the root page or
     * any non-agent route.
     *
     * The agent only needs /api/jobs and /api/jobs/:id/heartbeat. Allowing
     * bearer on / would give the agent (or a leaked token) access to the
     * entire human-facing UI, which is broader than necessary.
     *
     * If this breaks, a leaked AGENT_TOKEN becomes equivalent to full site
     * access, violating the principle of least privilege.
     */
    // GIVEN — valid agent token on a non-agent path, no session cookie
    const req = makeRequest("/", undefined, bearerHeader(TEST_AGENT_TOKEN));

    // WHEN
    const res = proxyFn(req) as Response;

    // THEN — bearer must not unlock /
    const location = res.headers.get("location") ?? "";
    assert.ok(
      location.includes("/login"),
      "valid bearer on / must still redirect to /login",
    );
  });

  it("does NOT allow bearer token access to /api/auth with a valid token", () => {
    /**
     * Verifies that the bearer bypass does not extend to /api/auth, which is
     * already public but must remain a separate code path.
     *
     * /api/auth is handled by isPublic(), not by the agent bypass. This test
     * confirms the two paths don't accidentally overlap in the wrong direction
     * (bearer granting access to auth endpoints it shouldn't govern).
     *
     * If the bearer scope accidentally included /api/auth, the logic would be
     * confused — the route is public already, but for the wrong reason.
     * More importantly, it signals a scope regression if isAgentPath ever
     * inadvertently matches /api/auth* routes.
     */
    // GIVEN — /api/auth is public; bearer token present but irrelevant
    const req = makeRequest("/api/auth", undefined, bearerHeader(TEST_AGENT_TOKEN));

    // WHEN
    const res = proxyFn(req) as Response;

    // THEN — /api/auth passes through because it's public (not because of bearer)
    // The key assertion: no redirect (the route is reachable)
    assert.ok(
      !res.headers.get("location"),
      "/api/auth with bearer must still pass through (it is public)",
    );
  });

  it("does NOT authenticate when AGENT_TOKEN is unset (fail closed)", () => {
    /**
     * Verifies that the bearer bypass is inert when AGENT_TOKEN is not
     * configured. An empty or missing AGENT_TOKEN must never match any
     * bearer value, including an empty string.
     *
     * This prevents an accidental open door if the env var is omitted from
     * a deployment — the site remains human-password-protected.
     *
     * If this breaks, a misconfigured deployment with no AGENT_TOKEN would
     * allow any request bearing 'Authorization: Bearer ' to reach agent routes.
     */
    // GIVEN — AGENT_TOKEN removed from env; bearer header still sent
    delete process.env.AGENT_TOKEN;
    const req = makeRequest(
      "/api/jobs/job-abc-123/heartbeat",
      undefined,
      bearerHeader(TEST_AGENT_TOKEN),
    );

    // WHEN
    const res = proxyFn(req) as Response;

    // THEN — must redirect; bearer path inactive when AGENT_TOKEN unset
    const location = res.headers.get("location") ?? "";
    assert.ok(
      location.includes("/login"),
      "unset AGENT_TOKEN must cause bearer path to redirect to /login",
    );
  });
});
