import { NextRequest, NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";

export const runtime = "nodejs";

// List active + recent jobs (control page polls this).
export async function GET() {
  await ensureSchema();
  const rows = await sql`
    select * from jobs order by created_at desc limit 20`;
  return NextResponse.json(rows);
}

// Create a holding job. The worker takes it from here.
export async function POST(req: NextRequest) {
  await ensureSchema();
  const { venueUrl, seats } = await req.json();

  if (!venueUrl || typeof venueUrl !== "string") {
    return NextResponse.json({ error: "venueUrl required" }, { status: 400 });
  }
  const seatStr = String(seats ?? "").trim();
  if (!seatStr) {
    return NextResponse.json({ error: "seats required" }, { status: 400 });
  }

  const id = "job_" + Math.random().toString(36).slice(2, 10);
  await sql`
    insert into jobs (id, venue_url, seats, status, message)
    values (${id}, ${venueUrl}, ${seatStr}, 'holding', 'queued — worker will grab it')`;
  const [job] = await sql`select * from jobs where id = ${id}`;
  return NextResponse.json(job, { status: 201 });
}
