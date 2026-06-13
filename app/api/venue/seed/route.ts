import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";

export const runtime = "nodejs";

const ROWS = ["A", "B", "C", "D", "E"];
const COLS = [1, 2, 3, 4, 5, 6, 7, 8];

// Seed a seat grid if empty. Called by the venue page on load so the mock
// "ticketing site" always has seats to show.
export async function POST() {
  await ensureSchema();
  const [{ count }] = await sql`select count(*)::int as count from venue_seats`;
  if (count === 0) {
    for (const r of ROWS) {
      for (const c of COLS) {
        await sql`insert into venue_seats (seat, status) values (${r + c}, 'available')
                  on conflict (seat) do nothing`;
      }
    }
  }
  return NextResponse.json({ ok: true });
}
