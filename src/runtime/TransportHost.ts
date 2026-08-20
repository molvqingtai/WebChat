import type { RoomTransport } from '@/runtime/RoomTransport'
import { createRoomTransport } from '@/runtime/RoomTransportProvider'

export interface TransportService {
  join: (roomId: string) => Promise<string>
  leave: (roomId: string, options?: { diagnosticOnly?: boolean }) => Promise<void>
  send: (roomId: string, payload: string, to?: string | string[]) => Promise<void>
  onMessage: (callback: (roomId: string, sourcePeerId: string, payload: string) => void) => Promise<void>
  onPeerJoin: (callback: (roomId: string, peerId: string) => void) => Promise<void>
  onPeerLeave: (callback: (roomId: string, peerId: string) => void) => Promise<void>
  onRoomClose: (callback: (roomId: string) => void) => Promise<void>
  onError: (callback: (error: Error, roomId: string) => void) => Promise<void>
}

const report = (callback: () => void) => {
  try {
    callback()
  } catch (error) {
    console.error(error)
  }
}

/** Offscreen owns only physical transport and atomically replaces one callback per event lane. */
export const createTransportService = (transport: RoomTransport = createRoomTransport()): TransportService => {
  let onMessage: ((roomId: string, sourcePeerId: string, payload: string) => void) | null = null
  let onPeerJoin: ((roomId: string, peerId: string) => void) | null = null
  let onPeerLeave: ((roomId: string, peerId: string) => void) | null = null
  let onRoomClose: ((roomId: string) => void) | null = null
  let onError: ((error: Error, roomId: string) => void) | null = null

  transport.onMessage((roomId, sourcePeerId, payload) => {
    const callback = onMessage
    if (callback) report(() => callback(roomId, sourcePeerId, payload))
  })
  transport.onPeerJoin((roomId, peerId) => {
    const callback = onPeerJoin
    if (callback) report(() => callback(roomId, peerId))
  })
  transport.onPeerLeave((roomId, peerId) => {
    const callback = onPeerLeave
    if (callback) report(() => callback(roomId, peerId))
  })
  transport.onRoomClose((roomId) => {
    const callback = onRoomClose
    if (callback) report(() => callback(roomId))
  })
  transport.onError((error, roomId) => {
    const callback = onError
    if (callback) report(() => callback(error, roomId))
  })

  return {
    join: async (roomId) => {
      await transport.join(roomId)
      return transport.peerIdOf(roomId)
    },
    leave: async (roomId, options) => transport.leave(roomId, options),
    send: (roomId, payload, to) => transport.send(roomId, payload, to),
    onMessage: async (callback) => {
      onMessage = callback
    },
    onPeerJoin: async (callback) => {
      onPeerJoin = callback
    },
    onPeerLeave: async (callback) => {
      onPeerLeave = callback
    },
    onRoomClose: async (callback) => {
      onRoomClose = callback
    },
    onError: async (callback) => {
      onError = callback
    }
  }
}

export const TRANSPORT_NAMESPACE_PREFIX = 'WEB_CHAT_RUNTIME_TRANSPORT_V1'
