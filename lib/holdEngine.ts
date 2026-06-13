import { sql, VENUE_HOLD_TTL_SECONDS } from "./db";

// The ONE pluggable piece. Today: a mock engine that re-holds seats in our own
// `venue_seats` table. To make this work on a real ticketing site, swap the
// body of hold()/release() for a Playwright + Claude Agent SDK driver that
// logs in, finds the seats, and clicks "hold" — same signatures, same worker.
export interface HoldJob {
  id: string;
  venue_url: string;
  seats: string; // comma separated
}

function seatList(job: HoldJob): string[] {
  return job.seats
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function hold(job: HoldJob): Promise<void> {
  const seats = seatList(job);
  for (const seat of seats) {
    await sql`
      insert into venue_seats (seat, status, holder, hold_expires_at)
      values (${seat}, 'held', ${job.id},
              now() + (${VENUE_HOLD_TTL_SECONDS} || ' seconds')::interval)
      on conflict (seat) do update set
        status = 'held',
        holder = ${job.id},
        hold_expires_at = now() + (${VENUE_HOLD_TTL_SECONDS} || ' seconds')::interval`;
  }
}

export async function release(job: HoldJob): Promise<void> {
  const seats = seatList(job);
  for (const seat of seats) {
    await sql`
      update venue_seats
      set status = 'available', holder = null, hold_expires_at = null
      where seat = ${seat} and holder = ${job.id}`;
  }
}
