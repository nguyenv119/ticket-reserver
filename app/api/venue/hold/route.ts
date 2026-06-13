import { NextRequest, NextResponse } from "next/server";
import { sql, ensureSchema, VENUE_HOLD_TTL_SECONDS } from "@/lib/db";

export const runtime = "nodejs";

// Mock "ticketing site" hold endpoint. In a real build this is whatever the
// venue's reserve action is (often hidden behind login + bot protection).
export async function POST(req: NextRequest) {
  await ensureSchema();
  const { seats, holder } = await req.json();
  const list: string[] = Array.isArray(seats) ? seats : [];
  for (const seat of list) {
    await sql`
      insert into venue_seats (seat, status, holder, hold_expires_at)
      values (${seat}, 'held', ${holder ?? "guest"},
              now() + (${VENUE_HOLD_TTL_SECONDS} || ' seconds')::interval)
      on conflict (seat) do update set
        status = 'held', holder = ${holder ?? "guest"},
        hold_expires_at = now() + (${VENUE_HOLD_TTL_SECONDS} || ' seconds')::interval`;
  }
  return NextResponse.json({ ok: true, held: list });
}
