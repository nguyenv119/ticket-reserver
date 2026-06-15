/**
 * Unit tests for lib/relativeTime.ts
 *
 * Exercises the two exported functions:
 *   - formatRelativeTime: renders a timestamp as a human-readable "X ago" string
 *   - isHeartbeatStale: returns true when last_heartbeat_at is older than
 *     STALE_THRESHOLD_MS (or when it is non-null and the module boundary rules
 *     say the job is at risk).
 *
 * All tests inject `now` explicitly so wall-clock drift never causes flakes.
 *
 * Runs with:
 *   ./node_modules/.bin/tsx --test __tests__/relativeTime.test.mts
 */

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";

let formatRelativeTime: (ts: string | null, now?: Date) => string;
let isHeartbeatStale: (
  ts: string | null,
  now?: Date,
  createdAt?: string | null,
) => boolean;
let STALE_THRESHOLD_MS: number;

before(async () => {
  const mod = await import("../lib/relativeTime.js");
  formatRelativeTime = mod.formatRelativeTime;
  isHeartbeatStale = mod.isHeartbeatStale;
  STALE_THRESHOLD_MS = mod.STALE_THRESHOLD_MS;
});

// ─── STALE_THRESHOLD_MS constant ─────────────────────────────────────────────

describe("STALE_THRESHOLD_MS", () => {
  it("equals exactly 6 minutes in milliseconds", () => {
    /**
     * The threshold is documented as 6 minutes because the heartbeat cron runs
     * every ~5 minutes — missing one tick means > 6 minutes with no ping.
     * If this value drifts, the stale-warning logic silently changes its
     * sensitivity, either producing false alarms or hiding real stale agents.
     */
    // GIVEN / WHEN — static check
    // THEN
    assert.equal(STALE_THRESHOLD_MS, 6 * 60 * 1000);
  });
});

// ─── formatRelativeTime ───────────────────────────────────────────────────────

describe("formatRelativeTime", () => {
  it("returns 'no heartbeat yet' for a null timestamp", () => {
    /**
     * A null last_heartbeat_at means the agent has never phoned home.
     * Displaying "0s ago" or crashing would be confusing — the job may be
     * brand new. "no heartbeat yet" tells the operator exactly what is happening
     * without implying the agent is stale.
     */
    // GIVEN
    const now = new Date("2025-01-01T00:10:00Z");

    // WHEN
    const result = formatRelativeTime(null, now);

    // THEN
    assert.equal(result, "no heartbeat yet");
  });

  it("returns seconds-ago string for a very fresh timestamp (10 s ago)", () => {
    /**
     * Sub-minute heartbeats should render in seconds so the operator can see
     * the agent is alive and recently active. Rounding to minutes here would
     * hide freshness that matters at the 6-min staleness boundary.
     */
    // GIVEN
    const now = new Date("2025-01-01T00:10:00Z");
    const ts = new Date(now.getTime() - 10_000).toISOString(); // 10s ago

    // WHEN
    const result = formatRelativeTime(ts, now);

    // THEN
    assert.equal(result, "10s ago");
  });

  it("returns minutes-ago string for a 3-minute-old timestamp", () => {
    /**
     * Once the lag exceeds 60 s the seconds unit becomes noise. Displaying
     * "3 min ago" is more readable than "180s ago" and keeps the UI scannable.
     * If the transition boundary shifts, a 3-minute heartbeat might display
     * in seconds unexpectedly, making the UI look buggy.
     */
    // GIVEN
    const now = new Date("2025-01-01T00:10:00Z");
    const ts = new Date(now.getTime() - 3 * 60_000).toISOString(); // 3 min ago

    // WHEN
    const result = formatRelativeTime(ts, now);

    // THEN
    assert.equal(result, "3 min ago");
  });

  it("returns hours-ago string for a 2-hour-old timestamp", () => {
    /**
     * Very old timestamps (>1h) should display in hours. If the cron is down
     * for hours this is the label the operator sees — it must be readable at a
     * glance so they can gauge severity without mental arithmetic.
     */
    // GIVEN
    const now = new Date("2025-01-01T06:00:00Z");
    const ts = new Date(now.getTime() - 2 * 60 * 60_000).toISOString(); // 2h ago

    // WHEN
    const result = formatRelativeTime(ts, now);

    // THEN
    assert.equal(result, "2 hr ago");
  });

  it("returns '1 min ago' for exactly 60 seconds ago (minute boundary)", () => {
    /**
     * The boundary between 'Xs ago' and 'X min ago' is at 60 s. This test
     * pins the exact crossover so a refactor can't accidentally shift it to
     * 59 s or 61 s without a failing test.
     */
    // GIVEN
    const now = new Date("2025-01-01T00:10:00Z");
    const ts = new Date(now.getTime() - 60_000).toISOString(); // exactly 60s ago

    // WHEN
    const result = formatRelativeTime(ts, now);

    // THEN
    assert.equal(result, "1 min ago");
  });

  it("returns '1 hr ago' for exactly 60 minutes ago (hour boundary)", () => {
    /**
     * Pins the exact crossover from minutes to hours at 60 min (3600 s).
     * Without this, a refactor could emit "60 min ago" instead of "1 hr ago"
     * or shift the boundary, both of which degrade readability.
     */
    // GIVEN
    const now = new Date("2025-01-01T02:00:00Z");
    const ts = new Date(now.getTime() - 60 * 60_000).toISOString(); // exactly 60 min ago

    // WHEN
    const result = formatRelativeTime(ts, now);

    // THEN
    assert.equal(result, "1 hr ago");
  });
});

// ─── isHeartbeatStale ─────────────────────────────────────────────────────────

describe("isHeartbeatStale", () => {
  it("returns false for a fresh heartbeat (10 s ago)", () => {
    /**
     * A heartbeat that arrived 10 seconds ago is clearly fresh. Returning true
     * here would produce false-alarm stale warnings that erode operator trust
     * and cause unnecessary panic during normal operation.
     */
    // GIVEN
    const now = new Date("2025-01-01T00:10:00Z");
    const ts = new Date(now.getTime() - 10_000).toISOString();

    // WHEN
    const result = isHeartbeatStale(ts, now);

    // THEN
    assert.equal(result, false);
  });

  it("returns false for a null ts AND null createdAt (truly brand-new / unknown)", () => {
    /**
     * When both ts and createdAt are null there is no reference point to measure
     * staleness against. Returning true here would fire a warning on every job
     * whose creation time is somehow missing — that would be misleading and
     * erode operator trust in the stale banner.
     */
    // GIVEN
    const now = new Date("2025-01-01T00:10:00Z");

    // WHEN
    const result = isHeartbeatStale(null, now, null);

    // THEN
    assert.equal(result, false);
  });

  it("returns false for null ts when createdAt is within the threshold (fresh never-heartbeated job)", () => {
    /**
     * A job created 3 minutes ago has never heartbeated, but the agent may not
     * have run its first tick yet — 3 min < STALE_THRESHOLD_MS (6 min) so we
     * must NOT warn. Returning true here would fire a red warning on every
     * freshly submitted job before the first cron tick, making the warning noisy
     * and untrustworthy.
     */
    // GIVEN
    const now = new Date("2025-01-01T00:10:00Z");
    const createdAt = new Date(now.getTime() - 3 * 60_000).toISOString(); // 3 min ago (< threshold)

    // WHEN
    const result = isHeartbeatStale(null, now, createdAt);

    // THEN
    assert.equal(result, false);
  });

  it("returns true for null ts when createdAt is past the threshold (old never-heartbeated job)", () => {
    /**
     * A job created 30 minutes ago that has NEVER heartbeated is exactly the
     * failure mode the stale warning exists to catch: the cron/agent crashed
     * before writing its first heartbeat, so seats may expire unrenewed.
     * Without this branch the red banner would never fire for such a job, giving
     * the operator a false sense that everything is fine.
     *
     * Note: formatRelativeTime(null) still returns "no heartbeat yet" — the
     * warning BANNER and the time LABEL are independent; both can appear together.
     */
    // GIVEN
    const now = new Date("2025-01-01T00:40:00Z");
    const createdAt = new Date(now.getTime() - 30 * 60_000).toISOString(); // 30 min ago (> threshold)

    // WHEN
    const result = isHeartbeatStale(null, now, createdAt);

    // THEN
    assert.equal(result, true);
  });

  it("returns false at exactly the staleness threshold boundary (= 6 min)", () => {
    /**
     * The threshold is strictly greater-than: a heartbeat exactly at T=6min is
     * NOT stale (the cron fires every 5 min; a heartbeat exactly 6 min ago means
     * one tick just barely made it through). The warning should fire only when a
     * tick is clearly missed. Treating the boundary as stale would produce
     * flickering warnings on every normal cron cycle near the 5-min mark.
     */
    // GIVEN
    const now = new Date("2025-01-01T00:10:00Z");
    const ts = new Date(now.getTime() - STALE_THRESHOLD_MS).toISOString(); // exactly 6 min ago

    // WHEN
    const result = isHeartbeatStale(ts, now);

    // THEN
    assert.equal(result, false);
  });

  it("returns true for a heartbeat 1 ms past the staleness threshold (> 6 min)", () => {
    /**
     * One millisecond past the threshold should flip the staleness flag. This
     * confirms the boundary is > (strictly greater-than) and that the condition
     * fires as soon as the cron cycle is missed.
     */
    // GIVEN
    const now = new Date("2025-01-01T00:10:00Z");
    const ts = new Date(now.getTime() - STALE_THRESHOLD_MS - 1).toISOString();

    // WHEN
    const result = isHeartbeatStale(ts, now);

    // THEN
    assert.equal(result, true);
  });

  it("returns true for a heartbeat well past the threshold (20 min ago)", () => {
    /**
     * A heartbeat 20 minutes old means at least 3 cron ticks were missed —
     * the seats are almost certainly at risk. This test ensures the stale
     * flag stays true for any duration well beyond the threshold, not just
     * the boundary edge case.
     */
    // GIVEN
    const now = new Date("2025-01-01T00:30:00Z");
    const ts = new Date(now.getTime() - 20 * 60_000).toISOString();

    // WHEN
    const result = isHeartbeatStale(ts, now);

    // THEN
    assert.equal(result, true);
  });
});
