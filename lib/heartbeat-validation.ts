/**
 * Pure validation helpers for the /api/jobs/[id]/heartbeat endpoint.
 *
 * Extracted here so they can be tested without importing lib/db.ts (which
 * requires DATABASE_URL at import time and calls out to Neon).
 */
import { HOLD_STATES } from "@/lib/types";
import type { HoldState, HeartbeatBody } from "@/lib/types";

// Re-export so callers that import from this module don't need to change.
// The canonical declaration lives in lib/types.ts (single source of truth).
export { HOLD_STATES };

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
