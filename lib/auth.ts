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
 * Recomputes the expected HMAC and compares using timingSafeEqual to prevent
 * timing-based attacks. Handles mismatched buffer lengths safely (returns
 * false rather than throwing RangeError).
 */
export function verifyCookie(cookieValue: string, secret: string): boolean {
  const appPassword = process.env.APP_PASSWORD;
  if (!appPassword) {
    throw new Error("APP_PASSWORD env var is not set");
  }
  const expected = signCookie(appPassword, secret);

  const a = Buffer.from(cookieValue, "utf8");
  const b = Buffer.from(expected, "utf8");

  // timingSafeEqual requires equal-length buffers; pad the shorter one so we
  // always call it (prevents length-based short-circuit leaks) and still
  // return false on mismatch.
  if (a.length !== b.length) {
    // Compare against expected anyway to consume constant time for the HMAC
    // path, then return false.
    timingSafeEqual(b, b); // consume time
    return false;
  }

  return timingSafeEqual(a, b);
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
