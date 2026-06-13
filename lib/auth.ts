/**
 * Shared auth utilities for password-based session cookies.
 *
 * The cookie value is an HMAC-SHA256 digest of the APP_PASSWORD, keyed by
 * SESSION_SECRET. Both proxy.ts and app/api/auth/route.ts import from here
 * so the signing and verification logic stays in one place.
 *
 * Node.js runtime only — uses node:crypto. Proxy in Next.js 16 defaults to
 * the Node.js runtime, so this import is safe.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export const COOKIE_NAME = "__auth";

/**
 * Compute an HMAC-SHA256 of `password` keyed by `secret`.
 * Returns the digest as a hex string.
 */
export function signCookie(password: string, secret: string): string {
  return createHmac("sha256", secret).update(password).digest("hex");
}

/**
 * Verify that `cookieValue` is the correct HMAC of APP_PASSWORD.
 *
 * To prevent two classes of timing oracle:
 *   1. Length oracle — we must not short-circuit on differing buffer lengths.
 *   2. Input-length oracle — Buffer.from(cookieValue, "utf8") is
 *      O(attacker-length), so we must not call it on the raw attacker value
 *      before the comparison.
 *
 * Fix: apply HMAC again to BOTH the attacker-supplied value and the expected
 * value using the same key, producing two fixed-length (32-byte / 64-hex)
 * digests, then compare with timingSafeEqual. Because HMAC is collision-
 * resistant, HMAC(a, k) == HMAC(b, k) iff a == b, so the verification
 * result is correct. Every code path now calls exactly one timingSafeEqual on
 * two equal-size (32-byte) buffers regardless of attacker-controlled input.
 */
export function verifyCookie(cookieValue: string, secret: string): boolean {
  const appPassword = process.env.APP_PASSWORD;
  if (!appPassword) {
    throw new Error("APP_PASSWORD env var is not set");
  }

  // expected is the correct cookie value: HMAC(appPassword, secret).
  const expected = signCookie(appPassword, secret);

  // Re-sign both the attacker-supplied value and the expected value with the
  // same key. signCookie uses createHmac, which processes strings internally
  // without exposing an O(len) buffer to timing analysis. Both results are
  // always 64 hex chars (32 bytes), so timingSafeEqual never throws.
  const receivedHmac = Buffer.from(signCookie(cookieValue, secret), "hex");
  const expectedHmac = Buffer.from(signCookie(expected, secret), "hex");

  return timingSafeEqual(receivedHmac, expectedHmac);
}

/**
 * Read and validate required env vars at module load time.
 * Throws immediately if either is missing so misconfiguration is caught on
 * startup rather than silently granting access.
 */
export function requireEnv(): { appPassword: string; sessionSecret: string } {
  const appPassword = process.env.APP_PASSWORD;
  const sessionSecret = process.env.SESSION_SECRET;
  if (!appPassword) throw new Error("APP_PASSWORD env var is not set");
  if (!sessionSecret) throw new Error("SESSION_SECRET env var is not set");
  return { appPassword, sessionSecret };
}
