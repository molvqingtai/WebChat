import type { ConnectionLifecycle } from '@/domain/externs/ConnectionLifecycle'

/**
 * The Runtime-boundary epoch facts a Runtime-backed ChatRoom exposes: a monotonic counter that advances
 * whenever the Runtime supersedes or releases a connection hierarchy, plus a change subscription. These
 * are read by the ChatRoom domain to classify a completion as a structural cancellation (never from a
 * thrown error's content).
 */
export interface RuntimeChatRoomEpochSource {
  getLifecycleEpoch: () => number
  onLifecycleEpochChange: (callback: (epoch: number) => void) => () => void
}

export const createConnectionLifecycleImpl = (source: RuntimeChatRoomEpochSource): ConnectionLifecycle => {
  let epoch = source.getLifecycleEpoch()
  source.onLifecycleEpochChange((next) => {
    epoch = next
  })
  return {
    getEpoch: () => epoch,
    onEpochChange: (callback) => {
      callback(epoch)
      return source.onLifecycleEpochChange(callback)
    }
  }
}
