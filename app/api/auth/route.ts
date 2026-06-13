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

  // Timing-safe comparison of the submitted password against APP_PASSWORD.
  const a = Buffer.from(submitted, "utf8");
  const b = Buffer.from(appPassword, "utf8");
  const match =
    a.length === b.length && timingSafeEqual(a, b);

  if (!match) {
    return NextResponse.json({ error: "invalid_password" }, { status: 401 });
  }

  // Sign the cookie: HMAC-SHA256(appPassword, sessionSecret) as hex.
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
