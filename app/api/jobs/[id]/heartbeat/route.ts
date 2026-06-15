import { NextRequest, NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { validateHeartbeatBody } from "@/lib/heartbeat-validation";

export const runtime = "nodejs";

// The re-booker agent POSTs here each tick to report its observed hold state.
// Only updates hold_state, last_heartbeat_at, and agent_note — never touches
// status (user intent) or source (writer fence). See lib/types.ts for the
// column-semantics invariant.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  await ensureSchema();
  const { id } = await params;

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const validation = validateHeartbeatBody(rawBody);
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  const { hold_state, agent_note } = validation.body;

  const rows = await sql`
    update jobs
    set hold_state = ${hold_state},
        last_heartbeat_at = now(),
        agent_note = ${agent_note ?? null}
    where id = ${id}
    returning *`;

  if (rows.length === 0) {
    return NextResponse.json(
      { error: "no job with that id" },
      { status: 404 },
    );
  }

  return NextResponse.json(rows[0]);
}
