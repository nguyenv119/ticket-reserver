/**
 * Pure validation helpers for the /api/jobs/[id]/heartbeat endpoint.
 *
 * Extracted here so they can be tested without importing lib/db.ts (which
 * requires DATABASE_URL at import time and calls out to Neon).
 */
import type { HoldState, HeartbeatBody } from "@/lib/types";

/**
 * Runtime list of valid hold_state values. Kept in sync with the HoldState
 * union type — both live in this file / lib/types.ts so any divergence is
 * immediately visible. The DB CHECK constraint (jobs_hold_state_check) is
 * a third layer of defense at the persistence layer.
 */
export const HOLD_STATES: readonly HoldState[] = [
  "holding",
  "confirmed",
  "lost",
  "released",
];

export type ValidationResult =
  | { ok: true; body: HeartbeatBody }
  | { ok: false; error: string };

/**
 * Validates that a raw parsed body conforms to HeartbeatBody:
 *   - hold_state is present and one of the four valid HoldState values
 *   - agent_note, if present, is a string
 *
 * Returns { ok: true, body } on success, { ok: false, error } on failure.
 */
export function validateHeartbeatBody(raw: unknown): ValidationResult {
  if (typeof raw !== "object" || raw === null) {
    return { ok: false, error: "request body must be a JSON object" };
  }

  const obj = raw as Record<string, unknown>;

  if (!("hold_state" in obj) || obj.hold_state === undefined) {
    return { ok: false, error: "hold_state is required" };
  }

  if (!(HOLD_STATES as readonly unknown[]).includes(obj.hold_state)) {
    return {
      ok: false,
      error: `hold_state must be one of: ${HOLD_STATES.join(", ")}`,
    };
  }

  const hold_state = obj.hold_state as HoldState;

  if ("agent_note" in obj && obj.agent_note !== undefined && obj.agent_note !== null) {
    if (typeof obj.agent_note !== "string") {
      return { ok: false, error: "agent_note must be a string" };
    }
  }

  return {
    ok: true,
    body: {
      hold_state,
      agent_note:
        typeof obj.agent_note === "string" ? obj.agent_note : undefined,
    },
  };
}
