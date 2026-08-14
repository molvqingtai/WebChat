import { SendLifecycleExtern, type SendLifecycle, type SendResult } from '@/domain/externs/SendLifecycle'

/**
 * In-memory per-send token store. Only `active` (in-flight) tokens are retained; every settled token is
 * removed as soon as its owning invocation consumes it, so live state stays bounded by concurrent sends.
 */
export const createSendLifecycle = (): SendLifecycle => {
  const tokens = new Map<number, SendResult>()
  let sequence = 0
  return {
    beginSend: () => {
      const token = ++sequence
      tokens.set(token, 'active')
      return token
    },
    getSendResult: (token) => {
      const result = tokens.get(token) ?? 'active'
      // A terminal result is consumed on read so the invocation's token is released from live state.
      if (result !== 'active') tokens.delete(token)
      return result
    },
    settleSend: (token, result) => {
      const current = tokens.get(token)
      // Only the owning invocation settles its token; an already-settled token is never overwritten.
      if (current === undefined || result === 'active' || current !== 'active') return
      // Success/failure are terminal: the invocation does not read after settling, so drop it now.
      if (result === 'accepted' || result === 'failed') {
        tokens.delete(token)
      } else {
        tokens.set(token, result)
      }
    },
    cancelActiveSends: () => {
      // functional-loop: owner-commit — ordered per-token cancellation during live Map iteration
      for (const [token, result] of tokens) {
        // Mark active invocations cancelled; they are removed when the owning invocation reads them.
        if (result === 'active') tokens.set(token, 'cancelled')
      }
    }
  }
}

export const bindSendLifecycleExtern = (): ReturnType<typeof SendLifecycleExtern.impl> =>
  SendLifecycleExtern.impl(createSendLifecycle())
