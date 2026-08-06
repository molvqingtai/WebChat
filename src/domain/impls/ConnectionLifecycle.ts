import type { ConnectionLifecycle, ConnectionLifecycleResult } from '@/domain/externs/ConnectionLifecycle'

/**
 * The exact per-attempt outcome facts a Runtime-backed ChatRoom exposes: the outcome of the most recently
 * settled connection attempt, plus a change subscription. The ChatRoom domain reads this per-attempt result
 * to classify a completion as a structural cancellation vs a real failure (never from a thrown error's content).
 */
export interface RuntimeChatRoomResultSource {
  getAttemptResult: () => ConnectionLifecycleResult
  onAttemptResultChange: (callback: (result: ConnectionLifecycleResult) => void) => () => void
}

export const createConnectionLifecycleImpl = (source: RuntimeChatRoomResultSource): ConnectionLifecycle => {
  let result = source.getAttemptResult()
  source.onAttemptResultChange((next) => {
    result = next
  })
  return {
    getResult: () => result,
    onResultChange: (callback) => {
      callback(result)
      return source.onAttemptResultChange(callback)
    }
  }
}
