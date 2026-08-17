import { joinRoom, selfId } from 'trystero'
import type { Room } from 'trystero'
import type { RoomTransport } from '@/runtime/RoomTransport'

interface PeerOwner {
  roomId: string
  room?: Room
  disposed: boolean
}

interface TrysteroMessageAction {
  send: (data: string, options?: { target?: string | string[] | null }) => Promise<void>
  onMessage: ((data: string, context: { peerId: string }) => void | Promise<void>) | null
}

/**
 * Runtime-private transport facade over Trystero's default Nostr strategy. Each joined room owns
 * exactly one Trystero Room plus one stable message action; the peer identity is Trystero's
 * module-global `selfId` (shared across rooms by design), so `peerIdOf` reports it only while the
 * room owner exists. Trystero has no room-close or peer-error channel: recovery-relevant events
 * are simply never emitted, join failures arrive through `onJoinError`, and send rejections
 * surface through the returned Promise as-is.
 */
export const createTrysteroRoomTransport = (): RoomTransport => {
  const owners = new Map<string, PeerOwner>()

  const messageListeners = new Set<(roomId: string, sourcePeerId: string, rawPayload: string) => void>()
  const joinListeners = new Set<(roomId: string, peerId: string) => void>()
  const leaveListeners = new Set<(roomId: string, peerId: string) => void>()
  const closeListeners = new Set<(roomId: string) => void>()
  const errorListeners = new Set<(error: Error, roomId: string) => void>()

  const bindRoom = (owner: PeerOwner, room: Room, action: TrysteroMessageAction) => {
    const isCurrent = () => owners.get(owner.roomId) === owner && !owner.disposed && owner.room === room
    action.onMessage = (rawPayload, context) => {
      if (isCurrent()) messageListeners.forEach((listener) => listener(owner.roomId, context.peerId, rawPayload))
    }
    room.onPeerJoin = (joinedPeerId) => {
      if (!isCurrent()) return
      joinListeners.forEach((listener) => listener(owner.roomId, joinedPeerId))
    }
    room.onPeerLeave = (leftPeerId) => {
      if (!isCurrent()) return
      leaveListeners.forEach((listener) => listener(owner.roomId, leftPeerId))
    }
  }

  const createOwner = (roomId: string): PeerOwner => {
    const owner: PeerOwner = { roomId, disposed: false }
    owners.set(roomId, owner)
    const room = joinRoom({ appId: __NAME__ }, roomId, {
      onJoinError: (details) => {
        if (owners.get(roomId) !== owner || owner.disposed) return
        errorListeners.forEach((listener) => listener(new Error(details.error), roomId))
      }
    })
    const action = roomAction(room)
    owner.room = room
    bindRoom(owner, room, action)
    return owner
  }

  const dropOwner = (owner: PeerOwner) => {
    if (owner.disposed) return
    owner.disposed = true
    owners.delete(owner.roomId)
    const room = owner.room
    owner.room = undefined
    room?.leave().catch((error: unknown) => {
      // A disposed owner is already non-current: its leave failure has no current user impact,
      // but it must not disappear.
      console.error(error)
    })
  }

  return {
    peerIdOf: (roomId) => (owners.has(roomId) ? selfId : ''),
    join: (roomId) => {
      const owner = owners.get(roomId) ?? createOwner(roomId)
      // Trystero creates the physical room synchronously; the join settles immediately.
      return owner.room ? Promise.resolve() : Promise.reject(new Error(`Room "${roomId}" not joined`))
    },
    leave: (roomId) => {
      const owner = owners.get(roomId)
      if (!owner) return
      dropOwner(owner)
    },
    send: async (roomId, payload, to) => {
      const owner = owners.get(roomId)
      const room = owner?.room
      if (!owner || !room) throw new Error(`Room "${roomId}" not joined`)
      if (Array.isArray(to) && to.length === 0) return
      await roomAction(room).send(payload, { target: to ?? null })
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
      Array.from(owners.values()).forEach((owner) => dropOwner(owner))
      messageListeners.clear()
      joinListeners.clear()
      leaveListeners.clear()
      closeListeners.clear()
      errorListeners.clear()
    }
  }
}

/** The one stable message action per room, cached on the Room instance. */
const roomActions = new WeakMap<Room, TrysteroMessageAction>()
const roomAction = (room: Room): TrysteroMessageAction => {
  const cached = roomActions.get(room)
  if (cached) return cached
  const action = room.makeAction('message') as unknown as TrysteroMessageAction
  roomActions.set(room, action)
  return action
}
