import { Artico } from '@rtco/client'
import type { Room } from '@rtco/client'
import { nanoid } from 'nanoid'
import type { RoomTransport } from '@/runtime/RoomTransport'

/** One recoverable Artico peer per Runtime host with a stable host-lifetime peer id. */
export const createArticoRoomTransport = (): RoomTransport => {
  const peerId = nanoid()
  const desiredRooms = new Set<string>()
  const rooms = new Map<string, Room>()
  const readyPeers = new Map<string, Set<string>>()
  const intentionalLeaves = new Set<string>()
  const pendingJoins = new Map<
    string,
    { promise: Promise<void>; resolve: () => void; reject: (error: Error) => void }
  >()

  const messageListeners = new Set<(roomId: string, sourcePeerId: string, rawPayload: string) => void>()
  const joinListeners = new Set<(roomId: string, peerId: string) => void>()
  const leaveListeners = new Set<(roomId: string, peerId: string) => void>()
  const closeListeners = new Set<(roomId: string) => void>()
  const errorListeners = new Set<(error: Error) => void>()

  let peer: Artico
  let restartTimer: ReturnType<typeof globalThis.setTimeout> | null = null
  let disposed = false

  const createPendingJoin = () => {
    let resolve!: () => void
    let reject!: (error: Error) => void
    const promise = new Promise<void>((onResolve, onReject) => {
      resolve = onResolve
      reject = onReject
    })
    return { promise, resolve, reject }
  }

  const bindRoom = (roomId: string, room: Room) => {
    const isCurrentRoom = () => rooms.get(roomId) === room
    const peers = new Set<string>()
    readyPeers.set(roomId, peers)
    room.on('message', (rawPayload, sourcePeerId) => {
      if (isCurrentRoom()) messageListeners.forEach((listener) => listener(roomId, sourcePeerId, rawPayload))
    })
    room.on('join', (joinedPeerId) => {
      if (!isCurrentRoom()) return
      peers.add(joinedPeerId)
      joinListeners.forEach((listener) => listener(roomId, joinedPeerId))
    })
    room.on('leave', (leftPeerId) => {
      if (!isCurrentRoom()) return
      peers.delete(leftPeerId)
      leaveListeners.forEach((listener) => listener(roomId, leftPeerId))
    })
    room.on('close', () => {
      if (!isCurrentRoom()) return
      rooms.delete(roomId)
      readyPeers.delete(roomId)
      if (!disposed && !intentionalLeaves.has(roomId)) closeListeners.forEach((listener) => listener(roomId))
    })
  }

  const joinNow = (roomId: string) => {
    if (!desiredRooms.has(roomId) || rooms.has(roomId) || peer.state !== 'ready') return
    try {
      const room = peer.join(roomId)
      rooms.set(roomId, room)
      bindRoom(roomId, room)
      pendingJoins.get(roomId)?.resolve()
      pendingJoins.delete(roomId)
    } catch (error) {
      const joinError = error as Error
      pendingJoins.get(roomId)?.reject(joinError)
      pendingJoins.delete(roomId)
      errorListeners.forEach((listener) => listener(joinError))
    }
  }

  const startPeer = () => {
    if (disposed) return
    const nextPeer = new Artico({ id: peerId })
    peer = nextPeer
    nextPeer.on('open', () => {
      if (peer !== nextPeer) return
      desiredRooms.forEach(joinNow)
    })
    nextPeer.on('error', (error) => {
      if (peer === nextPeer) errorListeners.forEach((listener) => listener(error))
    })
    nextPeer.on('close', () => {
      if (disposed || peer !== nextPeer || restartTimer || desiredRooms.size === 0) return
      restartTimer = globalThis.setTimeout(() => {
        restartTimer = null
        startPeer()
      }, 1000)
    })
  }

  const repairDisconnectedPeer = () => {
    if (peer.state !== 'disconnected') return
    if (restartTimer) {
      globalThis.clearTimeout(restartTimer)
      restartTimer = null
    }
    startPeer()
  }

  startPeer()

  return {
    peerId,
    join: (roomId) => {
      desiredRooms.add(roomId)
      repairDisconnectedPeer()
      if (rooms.has(roomId)) return Promise.resolve()
      const pending = pendingJoins.get(roomId) ?? createPendingJoin()
      pendingJoins.set(roomId, pending)
      joinNow(roomId)
      return pending.promise
    },
    leave: (roomId) => {
      desiredRooms.delete(roomId)
      if (desiredRooms.size === 0 && restartTimer) {
        globalThis.clearTimeout(restartTimer)
        restartTimer = null
      }
      pendingJoins.get(roomId)?.reject(new Error(`Room "${roomId}" join cancelled`))
      pendingJoins.delete(roomId)
      const room = rooms.get(roomId)
      if (!room) return
      intentionalLeaves.add(roomId)
      try {
        room.leave()
      } catch (error) {
        errorListeners.forEach((listener) => listener(error as Error))
      } finally {
        intentionalLeaves.delete(roomId)
        rooms.delete(roomId)
        readyPeers.delete(roomId)
      }
    },
    /**
     * One stale Artico call must not abort sends to later targets before its delayed Room "leave" event.
     * @see https://github.com/matallui/artico/blob/8a4f1a185be9355f893120e9492151f1785e59fa/packages/client/src/room.ts#L114
     * @see https://github.com/matallui/artico/blob/8a4f1a185be9355f893120e9492151f1785e59fa/packages/peer/src/peer.ts#L281
     */
    send: async (roomId, payload, to) => {
      const room = rooms.get(roomId)
      if (!room) throw new Error(`Room "${roomId}" not joined`)
      const targets = new Set(typeof to === 'string' ? [to] : (to ?? readyPeers.get(roomId) ?? []))
      targets.forEach((target) => {
        try {
          room.send(payload, target)
        } catch {}
      })
    },
    onMessage: (callback) => {
      messageListeners.add(callback)
      return () => messageListeners.delete(callback)
    },
    onPeerJoin: (callback) => {
      joinListeners.add(callback)
      return () => joinListeners.delete(callback)
    },
    onPeerLeave: (callback) => {
      leaveListeners.add(callback)
      return () => leaveListeners.delete(callback)
    },
    onRoomClose: (callback) => {
      closeListeners.add(callback)
      return () => closeListeners.delete(callback)
    },
    onError: (callback) => {
      errorListeners.add(callback)
      return () => errorListeners.delete(callback)
    },
    dispose: () => {
      if (disposed) return
      disposed = true
      if (restartTimer) {
        globalThis.clearTimeout(restartTimer)
        restartTimer = null
      }
      desiredRooms.clear()
      pendingJoins.forEach((pending, roomId) => pending.reject(new Error(`Room "${roomId}" join cancelled`)))
      pendingJoins.clear()
      rooms.forEach((room) => {
        try {
          room.leave()
        } catch {}
      })
      rooms.clear()
      readyPeers.clear()
      intentionalLeaves.clear()
      try {
        peer.close()
      } catch {}
      messageListeners.clear()
      joinListeners.clear()
      leaveListeners.clear()
      closeListeners.clear()
      errorListeners.clear()
    }
  }
}
