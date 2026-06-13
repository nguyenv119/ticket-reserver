import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";

export const runtime = "nodejs";

// Live seat map. A hold whose timer has lapsed reads back as 'available' — this
// is what makes the worker's job real: stop re-holding and the seat frees
// itself. `secs_left` drives the on-screen countdown.
export async function GET() {
  await ensureSchema();
  const rows = await sql`
    select
      seat,
      case when status = 'held' and hold_expires_at > now()
           then 'held' else 'available' end as status,
      case when status = 'held' and hold_expires_at > now()
           then ceil(extract(epoch from (hold_expires_at - now())))::int
           else null end as secs_left
    from venue_seats
    order by seat`;
  return NextResponse.json(rows);
}
