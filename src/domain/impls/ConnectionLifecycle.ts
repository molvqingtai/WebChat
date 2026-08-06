import type { ConnectionLifecycle, ConnectionLifecycleResult } from '@/domain/externs/ConnectionLifecycle'

export type ConnectionResultReporter = (token: number, result: ConnectionLifecycleResult) => void

export interface ConnectionLifecycleBundle {
  value: ConnectionLifecycle
  report: ConnectionResultReporter
}

/**
 * A one-shot task-identity correlation used by the composition facade to bind each exact public-port
 * invocation task to its token and result. The facade mints a token, binds it to the returned task, and
 * wires `report` to the Runtime adapter's private reporter. No secondary business port, no
 * stack/FIFO/LIFO/global-current or error-shape correlation; terminal state is consumed one-shot on read.
 */
export const createConnectionLifecycle = (): ConnectionLifecycleBundle => {
  const results = new Map<number, ConnectionLifecycleResult>()
  // Keyed by the exact public-port Promise task object; consumed one-shot on read so no terminal state
  // outlives the invocation.
  const byTask = new WeakMap<Promise<void>, number>()
  let sequence = 0

  const report: ConnectionResultReporter = (token, result) => {
    const current = results.get(token)
    // Only the owning invocation settles its still-active token; the first terminal win persists.
    if (current === undefined || current !== 'active' || result === 'active') return
    results.set(token, result)
  }

  return {
    report,
    value: {
      mint: () => {
        const token = ++sequence
        results.set(token, 'active')
        return token
      },
      bindTask: (task, token) => {
        byTask.set(task, token)
      },
      getTaskResult: (task) => {
        const token = byTask.get(task)
        if (token === undefined) return 'active'
        byTask.delete(task)
        const result = results.get(token) ?? 'active'
        // Consumed one-shot: terminal state is released here.
        if (result !== 'active') results.delete(token)
        return result
      }
    }
  }
}
