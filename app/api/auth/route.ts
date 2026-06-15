/**
 * POST /api/auth
 *
 * Accepts { password: string } in the request body.
 * Compares the submitted password to APP_PASSWORD using timing-safe
 * comparison. On match, sets an httpOnly signed session cookie and returns
 * 200. On mismatch, returns 401.
 */
import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { COOKIE_NAME, requireEnv, signCookie } from "@/lib/auth";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  if (
    typeof body !== "object" ||
    body === null ||
    typeof (body as Record<string, unknown>).password !== "string"
  ) {
    return NextResponse.json({ error: "missing_password" }, { status: 400 });
  }

  const submitted = (body as { password: string }).password;

  const { appPassword, sessionSecret } = requireEnv();

  // Timing-safe comparison: sign both the submitted password and the real
  // APP_PASSWORD with the same key, then compare fixed-length (64-hex) HMAC
  // digests. This avoids the length-based short-circuit that `a.length ===
  // b.length && timingSafeEqual(a, b)` would introduce when the submitted
  // password has a different byte-length than APP_PASSWORD.
  const submittedDigest = Buffer.from(signCookie(submitted, sessionSecret), "hex");
  const expectedDigest = Buffer.from(signCookie(appPassword, sessionSecret), "hex");
  const match = timingSafeEqual(submittedDigest, expectedDigest);

  if (!match) {
    return NextResponse.json({ error: "invalid_password" }, { status: 401 });
  }

  // The cookie value is the HMAC of APP_PASSWORD — the same digest we already
  // computed as expectedDigest, expressed as hex.
  const cookieValue = signCookie(appPassword, sessionSecret);

  const isProduction = process.env.NODE_ENV === "production";

  const response = NextResponse.json({ ok: true });
  response.cookies.set(COOKIE_NAME, cookieValue, {
    httpOnly: true,
    sameSite: "lax",
    secure: isProduction,
    path: "/",
    // No explicit maxAge — session cookie (expires when browser closes).
  });

  return response;
}
