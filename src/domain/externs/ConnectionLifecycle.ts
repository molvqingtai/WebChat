import { Remesh } from 'remesh'

/** The exact, per-attempt structural outcome of a connection lifecycle operation. */
export type ConnectionLifecycleResult = 'active' | 'succeeded' | 'cancelled' | 'failed'

export interface ConnectionLifecycle {
  /**
   * The exact outcome of the most recently settled connection attempt, owned by that attempt. A
   * `cancelled` outcome is the producer-recognized structural result (host replacement, supersession,
   * or a Runtime cancellation); `failed` is a genuine failure; `succeeded` completed normally. The
   * domain reads this per-attempt result to classify a completion; it never inspects a thrown error's
   * name/message/type/code/value.
   */
  getResult: () => ConnectionLifecycleResult
  onResultChange: (callback: (result: ConnectionLifecycleResult) => void) => () => void
}

export const ConnectionLifecycleExtern = Remesh.extern<ConnectionLifecycle>({
  default: {
    getResult: () => 'active',
    onResultChange: () => () => {}
  }
})
