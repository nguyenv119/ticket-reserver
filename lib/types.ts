/**
 * Shared types for the ticket-reserver job contract.
 *
 * COLUMN SEMANTICS INVARIANT (every bead must honor):
 *   status     = USER INTENT     (holding | released | error)
 *   hold_state = AGENT-OBSERVED REALITY (holding | confirmed | lost | released)
 *   source     = WRITER FENCE: mock worker only writes source='mock';
 *                              real agent only writes source='agent'
 */

/** The four states the external re-booker agent can report about a hold. */
export type HoldState = "holding" | "confirmed" | "lost" | "released";

/** All columns in the `jobs` table. */
export type Job = {
  id: string;
  venue_url: string;
  seats: string;
  /** User intent — only the web layer sets this. */
  status: "holding" | "released" | "error";
  message: string | null;
  freed: boolean;
  last_held_at: string | null;
  hold_expires_at: string | null;
  created_at: string;
  /** Agent-observed reality — set by the re-booker agent via heartbeat. */
  hold_state: HoldState;
  /** When the agent last phoned home. Null until the agent first runs. */
  last_heartbeat_at: string | null;
  /** Free-text note the agent can attach to explain the current hold_state. */
  agent_note: string | null;
  /**
   * Writer fence. Only the dev mock worker writes 'mock' rows; the real
   * Claude-in-Chrome agent writes 'agent' rows. Prevents cross-contamination
   * in dev (mock churning over real agent rows).
   */
  source: "agent" | "mock";
};

/** Body the re-booker agent POSTs to /api/jobs/:id/heartbeat each tick. */
export type HeartbeatBody = {
  hold_state: HoldState;
  agent_note?: string;
};
