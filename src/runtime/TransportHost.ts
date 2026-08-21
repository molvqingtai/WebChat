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

export interface TransportBinding extends TransportProjection {
  admission: number
}

export interface TransportService {
  join: (roomId: string, handle: string, admission: number, joinId?: string) => Promise<TransportRoomState>
  abortJoin?: (roomId: string, joinId: string) => Promise<void>
  leave: (roomId: string, handle: string, options?: { diagnosticOnly?: boolean }) => Promise<void>
  send: (roomId: string, handle: string, payload: string, to?: string | string[]) => Promise<void>
  rebind: (
    onMessage: (roomId: string, handle: string, sourcePeerId: string, payload: string) => void,
    onPeerJoin: (roomId: string, handle: string, peerId: string) => void,
    onPeerLeave: (roomId: string, handle: string, peerId: string) => void,
    onRoomClose: (roomId: string, handle: string) => void,
    onError: (error: Error, roomId: string, handle: string) => void
  ) => Promise<TransportBinding>
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
  const joining = new Map<string, { task: Promise<TransportRoomState>; joinId?: string }>()
  let admission = 0
  let rebinding: Promise<void> | null = null
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
    join: async (roomId, handle, joinAdmission, joinId) => {
      if (joinAdmission !== admission) throw new Error('Transport room admission is no longer current')
      const existing = rooms.get(roomId)
      if (existing) {
        if (existing.handle !== handle) throw new Error('Transport room is owned by a newer handle')
        return existing
      }
      const pending = joining.get(roomId)
      if (pending) {
        const room = await pending.task
        if (room.handle !== handle) throw new Error('Transport room is owned by a newer handle')
        return room
      }
      const task = (async () => {
        await transport.join(roomId, { joinId })
        const room = { roomId, handle, peerId: transport.peerIdOf(roomId) }
        rooms.set(roomId, room)
        return room
      })()
      const pendingJoin = { task, joinId }
      joining.set(roomId, pendingJoin)
      void task.then(
        () => {
          if (joining.get(roomId) === pendingJoin) joining.delete(roomId)
        },
        () => {
          if (joining.get(roomId) === pendingJoin) joining.delete(roomId)
        }
      )
      return task
    },
    abortJoin: async (roomId, joinId) => {
      const pending = joining.get(roomId)
      if (!pending || pending.joinId !== joinId || !transport.abortJoin) return new Promise<void>(() => {})
      try {
        await transport.abortJoin(roomId, joinId)
      } catch {
        return new Promise<void>(() => {})
      }
      if (joining.get(roomId) === pending) joining.delete(roomId)
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
    rebind: (message, peerJoin, peerLeave, roomClose, error) => {
      const register = async () => {
        onMessage = message
        onPeerJoin = peerJoin
        onPeerLeave = peerLeave
        onRoomClose = roomClose
        onError = error
        // Let an already-active facade submit its synchronous admission before the rebind cut.
        await Promise.resolve()
        // The final empty observation, projection, and admission publication are one cut.
        while (joining.size > 0) await Promise.allSettled([...joining.values()].map(({ task }) => task))
        const current = projection()
        admission += 1
        return { ...current, admission }
      }
      const binding = rebinding ? rebinding.then(register) : register()
      const settled = binding.then(
        () => {},
        () => {}
      )
      rebinding = settled
      void settled.then(() => {
        if (rebinding === settled) rebinding = null
      })
      return binding
    }
  }
}

export const TRANSPORT_NAMESPACE_PREFIX = 'WEB_CHAT_RUNTIME_TRANSPORT_V1'
