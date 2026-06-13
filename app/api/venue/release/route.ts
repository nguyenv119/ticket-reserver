import { NextRequest, NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  await ensureSchema();
  const { seats, holder } = await req.json();
  const list: string[] = Array.isArray(seats) ? seats : [];
  for (const seat of list) {
    await sql`
      update venue_seats set status = 'available', holder = null, hold_expires_at = null
      where seat = ${seat} and (${holder ?? null}::text is null or holder = ${holder ?? null})`;
  }
  return NextResponse.json({ ok: true, released: list });
}
