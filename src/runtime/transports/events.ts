import type { RoomTransport } from '@/runtime/core/RoomTransport'

type Subscribe<Args extends unknown[]> = (callback: (...args: Args) => void) => () => void

const createEmitter = <Args extends unknown[]>() => {
  const listeners = new Set<(...args: Args) => void>()
  const subscribe: Subscribe<Args> = (callback) => {
    listeners.add(callback)
    return () => listeners.delete(callback)
  }
  return { subscribe, emit: (...args: Args) => listeners.forEach((listener) => listener(...args)), clear: () => listeners.clear() }
}

/** The five event streams every transport exposes. */
export const createTransportEvents = () => {
  const message = createEmitter<[roomId: string, peerId: string, payload: string]>()
  const peerJoin = createEmitter<[roomId: string, peerId: string]>()
  const peerLeave = createEmitter<[roomId: string, peerId: string]>()
  const roomClose = createEmitter<[roomId: string]>()
  const error = createEmitter<[error: Error, roomId: string]>()
  const subscriptions: Pick<RoomTransport, 'onMessage' | 'onPeerJoin' | 'onPeerLeave' | 'onRoomClose' | 'onError'> = {
    onMessage: message.subscribe,
    onPeerJoin: peerJoin.subscribe,
    onPeerLeave: peerLeave.subscribe,
    onRoomClose: roomClose.subscribe,
    onError: error.subscribe
  }
  return {
    message,
    peerJoin,
    peerLeave,
    roomClose,
    error,
    subscriptions,
    clear: () => [message, peerJoin, peerLeave, roomClose, error].forEach((emitter) => emitter.clear())
  }
}
