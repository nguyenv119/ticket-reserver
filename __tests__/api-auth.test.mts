/**
 * Tests for app/api/auth/route.ts — password verification and cookie-setting.
 *
 * Uses real Request/Response (Web API globals available in Node.js 18+).
 * No mocking of crypto or cookie APIs — exercises the real code path.
 *
 * Runs with: ./node_modules/.bin/tsx --test __tests__/api-auth.test.mts
 */
import { describe, it, before, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

let POST: (req: Request) => Promise<Response>;

const CORRECT_PASSWORD = "demo-magic-2026";
const TEST_SECRET = "test-session-secret";

before(async () => {
  const mod = await import("../app/api/auth/route.js");
  POST = mod.POST;
});

const origEnv = { ...process.env };
beforeEach(() => {
  process.env.APP_PASSWORD = CORRECT_PASSWORD;
  process.env.SESSION_SECRET = TEST_SECRET;
});
afterEach(() => {
  process.env.APP_PASSWORD = origEnv.APP_PASSWORD;
  process.env.SESSION_SECRET = origEnv.SESSION_SECRET;
});

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/auth", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/auth", () => {
  it("returns 200 and sets a signed httpOnly cookie on correct password", async () => {
    /**
     * Core happy path: a correct password must grant a session cookie.
     * Without this, no user can ever authenticate — login always fails.
     * The cookie must be httpOnly so client JS cannot read or steal it.
     */
    // GIVEN
    const req = makeRequest({ password: CORRECT_PASSWORD });

    // WHEN
    const res = await POST(req);

    // THEN
    assert.equal(res.status, 200);
    const setCookie = res.headers.get("set-cookie") ?? "";
    assert.ok(setCookie.includes("__auth="), "cookie name must be __auth");
    assert.ok(
      setCookie.toLowerCase().includes("httponly"),
      "cookie must be httpOnly"
    );
  });

  it("returns 401 on incorrect password", async () => {
    /**
     * Wrong passwords must be rejected. Without this check any visitor
     * could set a session cookie by posting any non-empty string.
     */
    // GIVEN
    const req = makeRequest({ password: "wrong-password-xyz" });

    // WHEN
    const res = await POST(req);

    // THEN
    assert.equal(res.status, 401);
    const setCookie = res.headers.get("set-cookie");
    assert.ok(!setCookie, "no cookie must be set on failed auth");
  });

  it("returns 401 on empty password string", async () => {
    /**
     * An empty string is not a valid password. Accepting it would allow
     * unauthenticated access if APP_PASSWORD were accidentally unset or
     * if the form were submitted without input.
     */
    // GIVEN
    const req = makeRequest({ password: "" });

    // WHEN
    const res = await POST(req);

    // THEN
    assert.equal(res.status, 401);
  });

  it("returns 400 when the request body is not valid JSON", async () => {
    /**
     * Malformed bodies must return 400, not 500. A 500 would expose a
     * stack trace in non-production environments and counts as an
     * unexpected error in monitoring.
     */
    // GIVEN
    const req = new Request("http://localhost/api/auth", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not json {{{",
    });

    // WHEN
    const res = await POST(req);

    // THEN
    assert.equal(res.status, 400);
  });

  it("returns 400 when the password field is missing from the body", async () => {
    /**
     * A body without a `password` key is a malformed request.
     * Returning 400 (not 401) distinguishes a client protocol error from
     * an actual auth failure, which aids debugging.
     */
    // GIVEN
    const req = makeRequest({ user: "someone" });

    // WHEN
    const res = await POST(req);

    // THEN
    assert.equal(res.status, 400);
  });

  it("sets cookie with samesite attribute", async () => {
    /**
     * sameSite prevents CSRF: the cookie is not sent on cross-origin form
     * submissions. Without this an attacker could trigger seat-hold API
     * calls by tricking the user into visiting a malicious page.
     */
    // GIVEN
    const req = makeRequest({ password: CORRECT_PASSWORD });

    // WHEN
    const res = await POST(req);

    // THEN
    const setCookie = (res.headers.get("set-cookie") ?? "").toLowerCase();
    assert.ok(setCookie.includes("samesite"), "cookie must have samesite");
  });
});
