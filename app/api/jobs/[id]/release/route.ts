import { NextRequest, NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";

export const runtime = "nodejs";

// The "magic" button. Flips the job to released; the worker frees the seats on
// its next tick (and stops re-holding).
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  await ensureSchema();
  const { id } = await params;
  const rows = await sql`
    update jobs
    set status = 'released', message = 'release requested'
    where id = ${id} and status = 'holding'
    returning *`;
  if (rows.length === 0) {
    return NextResponse.json(
      { error: "no active job with that id" },
      { status: 404 },
    );
  }
  return NextResponse.json(rows[0]);
}
