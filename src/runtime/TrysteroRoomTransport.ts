import { joinRoom, selfId } from 'trystero'
import type { Room } from 'trystero'
import type { RoomTransport } from '@/runtime/RoomTransport'

interface PeerOwner {
  roomId: string
  room?: Room
  /** The in-flight physical leave settlement for this room, if any. */
  pendingLeave?: Promise<void>
  /** The retained failure of the last physical leave; the room stays occupied and non-reentrant. */
  leaveError?: { value: unknown }
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

  /** A room owner is active only while it is neither leaving nor retaining a failed leave. */
  const isActive = (owner: PeerOwner) =>
    owners.get(owner.roomId) === owner && !owner.disposed && !owner.pendingLeave && !owner.leaveError

  const bindRoom = (owner: PeerOwner, room: Room, action: TrysteroMessageAction) => {
    const isCurrent = () => isActive(owner) && owner.room === room
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
        if (!isActive(owner)) return
        errorListeners.forEach((listener) => listener(new Error(details.error), roomId))
      }
    })
    const action = roomAction(room)
    owner.room = room
    bindRoom(owner, room, action)
    return owner
  }

  const dropOwner = (owner: PeerOwner, diagnosticOnly = false) => {
    if (owner.pendingLeave) return
    const room = owner.room
    if (!room) {
      owner.disposed = true
      owners.delete(owner.roomId)
      return
    }
    // The physical leave settles asynchronously; the room stays occupied until it succeeds. A
    // same-room join must await this settlement before creating a fresh Room, and a failed leave
    // keeps the owner as a non-reentrant occupancy record.
    const pending = room.leave().then(
      () => {
        owner.disposed = true
        owner.room = undefined
        if (owners.get(owner.roomId) === owner) owners.delete(owner.roomId)
      },
      (error: unknown) => {
        // A failed leave keeps the room occupied: the owner is retained so no second Room is
        // ever created for this roomId, and later joins reject with this exact failure.
        owner.leaveError = { value: error }
        if (diagnosticOnly) console.error(error)
        else errorListeners.forEach((listener) => listener(error as Error, owner.roomId))
      }
    )
    owner.pendingLeave = pending
    void pending.finally(() => {
      owner.pendingLeave = undefined
    })
  }

  return {
    peerIdOf: (roomId) => {
      const owner = owners.get(roomId)
      return owner && isActive(owner) ? selfId : ''
    },
    join: async (roomId) => {
      const existing = owners.get(roomId)
      if (existing?.pendingLeave) await existing.pendingLeave
      const owner = owners.get(roomId)
      if (!owner) {
        createOwner(roomId)
        return
      }
      // A failed physical leave keeps the old Room occupied: rejoining must surface that exact
      // failure instead of reporting a false success against the stale Room.
      if (owner.leaveError) throw owner.leaveError.value
      if (owner.room) return
      owners.delete(roomId)
      createOwner(roomId)
    },
    leave: (roomId, options) => {
      const owner = owners.get(roomId)
      if (!owner) return
      dropOwner(owner, options?.diagnosticOnly)
    },
    send: async (roomId, payload, to) => {
      const owner = owners.get(roomId)
      const room = owner?.room
      if (!owner || !room) throw new Error(`Room "${roomId}" not joined`)
      // A room that is leaving (or whose leave failed) is not sendable: never invoke the
      // provider on the stale Room, and surface the retained leave failure when present.
      if (owner.leaveError) throw owner.leaveError.value
      if (owner.pendingLeave) throw new Error(`Room "${roomId}" is leaving`)
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
      // A leave failure during teardown has no current user impact but must stay observable as
      // diagnostics; the error listeners are cleared below, so it never fires into a dead set.
      Array.from(owners.values()).forEach((owner) => dropOwner(owner, true))
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
