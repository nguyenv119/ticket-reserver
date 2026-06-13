import { sql, ensureSchema, WORKER_REFRESH_SECONDS } from "../lib/db";
import { hold, release, HoldJob } from "../lib/holdEngine";

// The always-on engine. In production this runs on a box that never sleeps
// (Railway/Render/a Mac left on). It is the thing Vercel serverless cannot be:
// a process that lives across the full 15-minute hold window, re-holding before
// each expiry, until you press Release.

async function tick() {
  // 1. Re-hold every active job (idempotent — resets the venue timer).
  const holding = (await sql`
    select id, venue_url, seats from jobs where status = 'holding'`) as HoldJob[];
  for (const job of holding) {
    try {
      await hold(job);
      await sql`
        update jobs
        set last_held_at = now(),
            message = ${"holding " + job.seats + " — refreshed"}
        where id = ${job.id}`;
    } catch (e) {
      await sql`update jobs set status = 'error', message = ${String(e)} where id = ${job.id}`;
    }
  }

  // 2. Free seats for jobs the user just released, exactly once.
  const toFree = (await sql`
    select id, venue_url, seats from jobs
    where status = 'released' and freed = false`) as HoldJob[];
  for (const job of toFree) {
    try {
      await release(job);
      await sql`update jobs set freed = true, message = 'released — seats free' where id = ${job.id}`;
    } catch (e) {
      await sql`update jobs set message = ${"release failed: " + String(e)} where id = ${job.id}`;
    }
  }

  if (holding.length || toFree.length) {
    console.log(
      `[worker] held ${holding.length}, freed ${toFree.length} @ ${new Date().toISOString()}`,
    );
  }
}

async function main() {
  await ensureSchema();
  console.log(
    `[worker] up. refreshing every ${WORKER_REFRESH_SECONDS}s. Ctrl-C to stop.`,
  );
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      await tick();
    } catch (e) {
      console.error("[worker] tick error", e);
    }
    await new Promise((r) => setTimeout(r, WORKER_REFRESH_SECONDS * 1000));
  }
}

main();
