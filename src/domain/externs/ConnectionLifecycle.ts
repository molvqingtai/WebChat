import { Remesh } from 'remesh'

/** The exact, per-attempt structural outcome of one connection lifecycle operation. */
export type ConnectionLifecycleResult = 'active' | 'succeeded' | 'cancelled' | 'failed'

/**
 * A per-attempt connection lifecycle channel. Each connection/reconnect invocation reserves an exact
 * token (`beginAttempt`) before it runs; only that invocation reports and reads that token's result
 * (`active -> succeeded | cancelled | failed`). It never reflects a global "current attempt", and
 * overlapping connection/reconnect operations each own their own token.
 */
export interface ConnectionLifecycle {
  beginAttempt: () => number
  getAttemptResult: (token: number) => ConnectionLifecycleResult
}

export const ConnectionLifecycleExtern = Remesh.extern<ConnectionLifecycle>({
  default: {
    beginAttempt: () => 0,
    getAttemptResult: () => 'active'
  }
})
