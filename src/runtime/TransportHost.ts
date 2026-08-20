import type { RoomTransport } from '@/runtime/RoomTransport'
import { createRoomTransport } from '@/runtime/RoomTransportProvider'

export interface TransportRoomState {
  roomId: string
  handle: string
  peerId: string
}

export interface TransportProjection {
  rooms: TransportRoomState[]
}

export interface TransportService {
  join: (roomId: string, handle: string) => Promise<TransportRoomState>
  leave: (roomId: string, handle: string, options?: { diagnosticOnly?: boolean }) => Promise<void>
  send: (roomId: string, handle: string, payload: string, to?: string | string[]) => Promise<void>
  onMessage: (
    callback: (roomId: string, handle: string, sourcePeerId: string, payload: string) => void
  ) => Promise<TransportProjection>
  onPeerJoin: (callback: (roomId: string, handle: string, peerId: string) => void) => Promise<TransportProjection>
  onPeerLeave: (callback: (roomId: string, handle: string, peerId: string) => void) => Promise<TransportProjection>
  onRoomClose: (callback: (roomId: string, handle: string) => void) => Promise<TransportProjection>
  onError: (callback: (error: Error, roomId: string, handle: string) => void) => Promise<TransportProjection>
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
  const rooms = new Map<string, TransportRoomState>()
  let onMessage: ((roomId: string, handle: string, sourcePeerId: string, payload: string) => void) | null = null
  let onPeerJoin: ((roomId: string, handle: string, peerId: string) => void) | null = null
  let onPeerLeave: ((roomId: string, handle: string, peerId: string) => void) | null = null
  let onRoomClose: ((roomId: string, handle: string) => void) | null = null
  let onError: ((error: Error, roomId: string, handle: string) => void) | null = null
  const projection = (): TransportProjection => ({ rooms: [...rooms.values()] })
  const currentRoom = (roomId: string, handle: string) => {
    const room = rooms.get(roomId)
    if (!room || room.handle !== handle) throw new Error('Transport room handle is no longer current')
    return room
  }

  transport.onMessage((roomId, sourcePeerId, payload) => {
    const room = rooms.get(roomId)
    if (room && onMessage) report(() => onMessage!(roomId, room.handle, sourcePeerId, payload))
  })
  transport.onPeerJoin((roomId, peerId) => {
    const room = rooms.get(roomId)
    if (room && onPeerJoin) report(() => onPeerJoin!(roomId, room.handle, peerId))
  })
  transport.onPeerLeave((roomId, peerId) => {
    const room = rooms.get(roomId)
    if (room && onPeerLeave) report(() => onPeerLeave!(roomId, room.handle, peerId))
  })
  transport.onRoomClose((roomId) => {
    const room = rooms.get(roomId)
    if (!room) return
    rooms.delete(roomId)
    if (onRoomClose) report(() => onRoomClose!(roomId, room.handle))
  })
  transport.onError((error, roomId) => {
    const room = rooms.get(roomId)
    if (room && onError) report(() => onError!(error, roomId, room.handle))
  })

  return {
    join: async (roomId, handle) => {
      const existing = rooms.get(roomId)
      if (existing) {
        if (existing.handle !== handle) throw new Error('Transport room is owned by a newer handle')
        return existing
      }
      await transport.join(roomId)
      const room = { roomId, handle, peerId: transport.peerIdOf(roomId) }
      rooms.set(roomId, room)
      return room
    },
    leave: async (roomId, handle, options) => {
      currentRoom(roomId, handle)
      rooms.delete(roomId)
      transport.leave(roomId, options)
    },
    send: async (roomId, handle, payload, to) => {
      currentRoom(roomId, handle)
      await transport.send(roomId, payload, to)
    },
    onMessage: async (callback) => {
      onMessage = callback
      return projection()
    },
    onPeerJoin: async (callback) => {
      onPeerJoin = callback
      return projection()
    },
    onPeerLeave: async (callback) => {
      onPeerLeave = callback
      return projection()
    },
    onRoomClose: async (callback) => {
      onRoomClose = callback
      return projection()
    },
    onError: async (callback) => {
      onError = callback
      return projection()
    }
  }
}

export const TRANSPORT_NAMESPACE_PREFIX = 'WEB_CHAT_RUNTIME_TRANSPORT_V1'
