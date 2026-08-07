import { Remesh } from 'remesh'

/** The exact, per-attempt structural outcome of one connection lifecycle invocation. */
export type ConnectionLifecycleResult = 'active' | 'succeeded' | 'cancelled' | 'failed'

/**
 * A single public-port invocation task whose exact result the application domain may read once. The
 * composition facade mints an exact token before any await, passes it explicitly into the Runtime-backed
 * adapter, and binds this task object to that token. The domain waits on the public port task and reads
 * only this exact task's result. It is one-shot (consumed on read) so no terminal state is retained.
 */
export interface ConnectionLifecycle {
  mint: () => number
  bindTask: (task: Promise<void>, token: number) => void
  getTaskResult: (task: Promise<void>) => ConnectionLifecycleResult
}

export const ConnectionLifecycleExtern = Remesh.extern<ConnectionLifecycle>({
  default: {
    mint: () => 0,
    bindTask: () => {},
    getTaskResult: () => 'active'
  }
})
