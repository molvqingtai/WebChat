import type { ConnectionLifecycle, ConnectionLifecycleResult } from '@/domain/externs/ConnectionLifecycle'

/**
 * A per-attempt token acquirer for a Runtime-backed ChatRoom. Each connection attempt acquires an exact
 * token at creation and reports its own result; the domain reads its reserved token. Nothing global is
 * read, and overlapping attempts each own their own token.
 */
export interface RuntimeChatRoomTokenAcquirer {
  acquire: () => number
  report: (token: number, result: ConnectionLifecycleResult) => void
}

export interface ConnectionLifecycleBundle {
  value: ConnectionLifecycle
  tokenAcquirer: RuntimeChatRoomTokenAcquirer
}

export const createConnectionLifecycle = (): ConnectionLifecycleBundle => {
  const results = new Map<number, ConnectionLifecycleResult>()
  const reserved = new Set<number>()
  let sequence = 0
  return {
    value: {
      beginAttempt: () => {
        const token = ++sequence
        results.set(token, 'active')
        reserved.add(token)
        return token
      },
      getAttemptResult: (token) => {
        const result = results.get(token) ?? 'active'
        // A terminal result is consumed on read so the invocation's token is released from live state.
        if (result !== 'active' && reserved.has(token)) {
          reserved.delete(token)
          results.delete(token)
        }
        return result
      }
    },
    tokenAcquirer: {
      acquire: () => {
        // Reuse the domain's reserved token if one is pending; otherwise mint a fresh one.
        const reservedTokens = [...reserved]
        const token = reservedTokens.pop() ?? ++sequence
        reserved.delete(token)
        if (!results.has(token)) results.set(token, 'active')
        return token
      },
      report: (token, result) => {
        const current = results.get(token)
        if (current === undefined || current !== 'active' || result === 'active') return
        // Only the owning invocation settles its still-active token; the first terminal win persists.
        results.set(token, result)
      }
    }
  }
}
