import { SendLifecycleExtern, type SendLifecycle, type SendResult } from '@/domain/externs/SendLifecycle'

/** In-memory per-send token store; each token is settled exactly once by its own invocation. */
export const createSendLifecycle = (): SendLifecycle => {
  const tokens = new Map<number, SendResult>()
  const settled = new Set<(payload: { token: number; result: SendResult }) => void>()
  let sequence = 0
  return {
    beginSend: () => {
      const token = ++sequence
      tokens.set(token, 'active')
      return token
    },
    getSendResult: (token) => tokens.get(token) ?? 'active',
    settleSend: (token, result) => {
      const current = tokens.get(token)
      // Only the owning invocation settles its token; an already-settled token is never overwritten.
      if (current === undefined || current === result || current !== 'active') return
      tokens.set(token, result)
      settled.forEach((callback) => callback({ token, result }))
    },
    cancelActiveSends: () => {
      tokens.forEach((result, token) => {
        if (result === 'active') {
          tokens.set(token, 'cancelled')
          settled.forEach((callback) => callback({ token, result: 'cancelled' }))
        }
      })
    },
    onSendSettled: (callback) => {
      settled.add(callback)
      return () => {
        settled.delete(callback)
      }
    }
  }
}

export const bindSendLifecycleExtern = (): ReturnType<typeof SendLifecycleExtern.impl> =>
  SendLifecycleExtern.impl(createSendLifecycle())
