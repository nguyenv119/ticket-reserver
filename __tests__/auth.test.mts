/**
 * Tests for lib/auth.ts — HMAC cookie signing and verification.
 *
 * Runs with Node.js built-in test runner (node --import tsx/esm --test).
 *
 * verifyCookie reads process.env.APP_PASSWORD internally (so it can be used
 * in the proxy without passing the password around). Tests set
 * process.env.APP_PASSWORD in GIVEN to control what the function sees.
 */
import { describe, it, before, afterEach } from "node:test";
import assert from "node:assert/strict";

// Dynamically import so missing module produces a clear failure in `before`.
let signCookie: (password: string, secret: string) => string;
let verifyCookie: (cookieValue: string, secret: string) => boolean;

before(async () => {
  const mod = await import("../lib/auth.js");
  signCookie = mod.signCookie;
  verifyCookie = mod.verifyCookie;
});

// Clean up env after each test so tests are isolated.
const originalEnv = { ...process.env };
afterEach(() => {
  process.env.APP_PASSWORD = originalEnv.APP_PASSWORD;
});

describe("signCookie", () => {
  it("returns a non-empty string for valid inputs", () => {
    /**
     * Verifies the basic contract that signCookie produces output.
     * Without this guarantee a caller could store an empty token and
     * accidentally accept any cookie value when comparing.
     */
    // GIVEN
    const password = "demo-magic-2026";
    const secret = "test-secret-abc";

    // WHEN
    const token = signCookie(password, secret);

    // THEN
    assert.ok(token.length > 0, "token must not be empty");
  });

  it("produces different tokens for different secrets", () => {
    /**
     * Verifies HMAC uses the secret as the key.
     * If the secret were ignored, a forged cookie with any password digest
     * would pass, defeating the signing scheme.
     */
    // GIVEN
    const password = "same-password";

    // WHEN
    const t1 = signCookie(password, "secret-one");
    const t2 = signCookie(password, "secret-two");

    // THEN
    assert.notEqual(t1, t2);
  });

  it("produces different tokens for different passwords", () => {
    /**
     * Verifies that the HMAC input includes the password value.
     * A cookie signed for one password must never verify as valid for another.
     */
    // GIVEN
    const secret = "same-secret";

    // WHEN
    const t1 = signCookie("password-a", secret);
    const t2 = signCookie("password-b", secret);

    // THEN
    assert.notEqual(t1, t2);
  });

  it("is deterministic — same inputs produce same token", () => {
    /**
     * Verifies that token verification is possible: verifyCookie must be able
     * to recompute the expected token and compare it. If signCookie were
     * non-deterministic (e.g., included a random nonce), verification would
     * always fail.
     */
    // GIVEN
    const password = "demo-magic-2026";
    const secret = "test-secret";

    // WHEN
    const t1 = signCookie(password, secret);
    const t2 = signCookie(password, secret);

    // THEN
    assert.equal(t1, t2);
  });
});

describe("verifyCookie", () => {
  it("returns true when the cookie was signed with the correct password and secret", () => {
    /**
     * Core happy-path: a cookie produced by signCookie(APP_PASSWORD, secret)
     * must be accepted by verifyCookie. If this fails, all authenticated users
     * get redirected to login on every request.
     */
    // GIVEN
    const appPassword = "demo-magic-2026";
    const secret = "test-secret-abc";
    process.env.APP_PASSWORD = appPassword;
    const token = signCookie(appPassword, secret);

    // WHEN
    const result = verifyCookie(token, secret);

    // THEN
    assert.equal(result, true);
  });

  it("returns false when the cookie value is tampered with", () => {
    /**
     * Verifies HMAC integrity: a modified token must be rejected.
     * Without this an attacker who guesses the cookie format could
     * forge a session without knowing the secret.
     */
    // GIVEN
    const appPassword = "demo-magic-2026";
    const secret = "test-secret-abc";
    process.env.APP_PASSWORD = appPassword;
    const token = signCookie(appPassword, secret);
    const tampered = token.slice(0, -4) + "XXXX";

    // WHEN
    const result = verifyCookie(tampered, secret);

    // THEN
    assert.equal(result, false);
  });

  it("returns false when the wrong secret is used", () => {
    /**
     * Verifies that a cookie signed with one secret is rejected when
     * verified with a different secret.
     * After a secret rotation, old cookies must be invalid so users are
     * forced to re-authenticate.
     */
    // GIVEN
    const appPassword = "demo-magic-2026";
    process.env.APP_PASSWORD = appPassword;
    const token = signCookie(appPassword, "secret-A");

    // WHEN
    const result = verifyCookie(token, "secret-B");

    // THEN
    assert.equal(result, false);
  });

  it("returns false for an empty string", () => {
    /**
     * Verifies that a missing or empty cookie is rejected rather than
     * causing an exception. An exception in the proxy would crash and block
     * all traffic — returning false is the safe fallback.
     */
    // GIVEN
    process.env.APP_PASSWORD = "demo-magic-2026";
    const secret = "test-secret-abc";

    // WHEN
    const result = verifyCookie("", secret);

    // THEN
    assert.equal(result, false);
  });

  it("returns false for a random garbage value", () => {
    /**
     * Verifies that an arbitrary cookie value (e.g., a session cookie from
     * a different app) does not accidentally pass verification.
     */
    // GIVEN
    process.env.APP_PASSWORD = "demo-magic-2026";
    const secret = "test-secret-abc";

    // WHEN
    const result = verifyCookie("not-a-real-hmac-token-xyz123", secret);

    // THEN
    assert.equal(result, false);
  });

  it("does not throw for a value shorter than the expected HMAC digest", () => {
    /**
     * timingSafeEqual requires equal-length buffers; mismatched lengths
     * would throw a RangeError and crash the proxy on a bad cookie.
     * The function must return false rather than propagating the error.
     */
    // GIVEN
    process.env.APP_PASSWORD = "demo-magic-2026";
    const secret = "test-secret-abc";

    // WHEN / THEN
    assert.doesNotThrow(() => verifyCookie("x", secret));
    assert.equal(verifyCookie("x", secret), false);
  });

  it("does not throw for a value longer than the expected HMAC digest", () => {
    /**
     * Same buffer-length safety as above but for an oversized cookie value.
     * Both cases must produce false, not an exception.
     */
    // GIVEN
    process.env.APP_PASSWORD = "demo-magic-2026";
    const secret = "test-secret-abc";
    const longValue = "x".repeat(200);

    // WHEN / THEN
    assert.doesNotThrow(() => verifyCookie(longValue, secret));
    assert.equal(verifyCookie(longValue, secret), false);
  });
});
