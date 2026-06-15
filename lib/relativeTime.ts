/**
 * Pure helpers for rendering last_heartbeat_at timestamps in the UI.
 *
 * Why a separate module: the staleness threshold and relative-time formatting
 * logic are pure (no I/O, no globals) and therefore easy to unit-test with
 * deterministic "now" injection. Keeping them here also prevents the threshold
 * from being duplicated across components.
 *
 * What breaks if this module is wrong: the stale-warning banner on the control
 * page will fire at the wrong time (or never), leaving the operator unaware
 * that the cron agent missed a heartbeat and seats may be at risk.
 */

/**
 * 6 minutes in milliseconds.
 *
 * The heartbeat cron fires every ~5 minutes. A job whose last_heartbeat_at is
 * MORE than 6 minutes ago has missed at least one cron tick — the agent is
 * likely dead or stuck and the seats may expire unrenewed.
 *
 * Exported so tests can reference it directly rather than hard-coding a magic
 * number that could silently diverge from the production value.
 */
export const STALE_THRESHOLD_MS = 6 * 60 * 1000;

/**
 * Formats a nullable ISO-8601 timestamp as a human-readable relative string.
 *
 * @param ts   - The timestamp to format. Pass `null` when the agent has never
 *               heartbeated; a special "no heartbeat yet" message is returned.
 * @param now  - The reference point for computing elapsed time. Defaults to
 *               `new Date()` in production; always pass an explicit value in
 *               tests to avoid wall-clock flakiness.
 * @returns    - e.g. "10s ago", "3 min ago", "2 hr ago", "no heartbeat yet"
 *
 * What breaks: if `now` is not injected in tests, elapsed-time assertions will
 * flake depending on how fast the test suite runs.
 */
export function formatRelativeTime(ts: string | null, now: Date = new Date()): string {
  if (ts === null) return "no heartbeat yet";

  const diffMs = now.getTime() - new Date(ts).getTime();
  const diffSec = Math.floor(diffMs / 1000);

  if (diffSec < 60) return `${diffSec}s ago`;

  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} min ago`;

  const diffHr = Math.floor(diffMin / 60);
  return `${diffHr} hr ago`;
}

/**
 * Returns true when a job's heartbeat is stale (agent missed a cron tick).
 *
 * A null timestamp means the agent has never run — that is NOT stale (the job
 * may be brand new). Treat null as "not yet stale" and let the UI display
 * "no heartbeat yet" via formatRelativeTime instead.
 *
 * The boundary is strictly greater-than: a heartbeat exactly at T=6 min is not
 * stale (one tick barely made it). This prevents flickering warnings at the
 * normal 5-min cron cycle boundary.
 *
 * @param ts   - last_heartbeat_at from the job row, or null.
 * @param now  - Reference instant. Inject in tests; defaults to new Date().
 *
 * What breaks: if the boundary were >= rather than >, normal-cadence heartbeats
 * at exactly 5-6 min would produce spurious stale warnings.
 */
export function isHeartbeatStale(ts: string | null, now: Date = new Date()): boolean {
  if (ts === null) return false;
  return now.getTime() - new Date(ts).getTime() > STALE_THRESHOLD_MS;
}
