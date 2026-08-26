import { Artico, SocketSignaling } from '@rtco/client'
import type { Room } from '@rtco/client'
import { nanoid } from 'nanoid'
import type { RoomTransport } from '@/runtime/RoomTransport'

interface PendingJoin {
  promise: Promise<void>
  resolve: () => void
  reject: (error: Error) => void
}

interface PeerOwner {
  roomId: string
  peerId: string
  peer: Artico
  room?: Room
  pendingJoin?: PendingJoin
  restartTimer: ReturnType<typeof globalThis.setTimeout> | null
  /** A strict retirement keeps this exact physical owner quarantined until both terminals succeed. */
  retiring: boolean
  retirementError?: unknown
  roomRetired: boolean
  peerRetired: boolean
  disposed: boolean
}

/**
 * Runtime-private transport facade. Each joined room owns exactly one scoped Artico peer: a fresh
 * physical identity per owner creation, one allowed room, and one restart owner while demand for
 * that room is non-empty. World and every Chat domain therefore never share a peer, a desired-room
 * set, a restart, or a pending operation. Every provider error carries its exact room scope and is
 * fenced by the current owner generation; a retired or disposed owner cannot emit anything.
 */
export const createRoomTransport = (): RoomTransport => {
  const owners = new Map<string, PeerOwner>()

  const messageListeners = new Set<(roomId: string, sourcePeerId: string, rawPayload: string) => void>()
  const joinListeners = new Set<(roomId: string, peerId: string) => void>()
  const leaveListeners = new Set<(roomId: string, peerId: string) => void>()
  const closeListeners = new Set<(roomId: string) => void>()
  const errorListeners = new Set<(error: Error, roomId: string) => void>()

  const isActiveOwner = (owner: PeerOwner) =>
    owners.get(owner.roomId) === owner && !owner.disposed && !owner.retiring && owner.retirementError === undefined

  const createPendingJoin = (): PendingJoin => {
    let resolve!: () => void
    let reject!: (error: Error) => void
    const promise = new Promise<void>((onResolve, onReject) => {
      resolve = onResolve
      reject = onReject
    })
    return { promise, resolve, reject }
  }

  const bindRoom = (owner: PeerOwner, peer: Artico, room: Room) => {
    const isCurrent = () => isActiveOwner(owner) && owner.peer === peer && owner.room === room
    room.on('message', (rawPayload, sourcePeerId) => {
      if (isCurrent()) messageListeners.forEach((listener) => listener(owner.roomId, sourcePeerId, rawPayload))
    })
    room.on('join', (joinedPeerId) => {
      if (!isCurrent()) return
      joinListeners.forEach((listener) => listener(owner.roomId, joinedPeerId))
    })
    room.on('leave', (leftPeerId) => {
      if (!isCurrent()) return
      leaveListeners.forEach((listener) => listener(owner.roomId, leftPeerId))
    })
    room.on('close', () => {
      if (!isCurrent()) return
      owner.room = undefined
      if (!owner.disposed) {
        closeListeners.forEach((listener) => listener(owner.roomId))
      }
    })
  }

  const joinNow = (owner: PeerOwner) => {
    if (owner.disposed || owner.retiring || owner.retirementError || owner.room || owner.peer.state !== 'ready') return
    try {
      const room = owner.peer.join(owner.roomId)
      owner.room = room
      bindRoom(owner, owner.peer, room)
      owner.pendingJoin?.resolve()
      owner.pendingJoin = undefined
    } catch (error) {
      const joinError = error as Error
      // A synchronous provider join throw is delivered scoped to the owning attempt via the join
      // rejection only. It must not also fire the room-less global error (which would surface as a
      // duplicate cross-domain Toast).
      owner.pendingJoin?.reject(joinError)
      owner.pendingJoin = undefined
    }
  }

  /** Retire the current physical peer before any successor exists; its room is settled with it. */
  const retirePeer = (owner: PeerOwner) => {
    const stale = owner.peer
    owner.room = undefined
    try {
      stale?.close()
    } catch (error) {
      // A retired owner is already non-current: its close failure has no current user impact, but
      // it must not disappear.
      console.error(error)
    }
  }

  const startPeer = (owner: PeerOwner) => {
    if (owner.disposed || owner.retiring || owner.retirementError) return
    if (owner.peer) owner.peerId = nanoid()
    retirePeer(owner)
    // Every World/Chat Artico generation explicitly uses the owned signaling endpoint with its
    // own physical peer identity; no env selector, endpoint list, or host fallback exists.
    const nextPeer = new Artico({
      id: owner.peerId,
      signaling: new SocketSignaling({ url: 'wss://web-chat.io', id: owner.peerId })
    })
    owner.peer = nextPeer
    nextPeer.on('open', () => {
      if (!isActiveOwner(owner) || owner.peer !== nextPeer) return
      joinNow(owner)
    })
    nextPeer.on('error', (error) => {
      // Errors are never classified by message/name/code; they surface as real peer failures while
      // the physical restart path below is the only structural self-healing mechanism. A retired or
      // disposed owner can never leak an error outside its exact room scope.
      if (!isActiveOwner(owner) || owner.peer !== nextPeer) return
      errorListeners.forEach((listener) => listener(error, owner.roomId))
    })
    nextPeer.on('close', () => {
      if (!isActiveOwner(owner) || owner.peer !== nextPeer || owner.restartTimer) return
      owner.restartTimer = globalThis.setTimeout(() => {
        owner.restartTimer = null
        startPeer(owner)
      }, 10000)
    })
  }

  const repairDisconnectedPeer = (owner: PeerOwner) => {
    if (owner.retiring || owner.retirementError) return
    if (owner.peer.state !== 'disconnected') return
    if (owner.restartTimer) {
      globalThis.clearTimeout(owner.restartTimer)
      owner.restartTimer = null
    }
    startPeer(owner)
  }

  const createOwner = (roomId: string): PeerOwner => {
    const owner: PeerOwner = {
      roomId,
      peerId: nanoid(),
      peer: undefined as unknown as Artico,
      restartTimer: null,
      retiring: false,
      roomRetired: false,
      peerRetired: false,
      disposed: false
    }
    owners.set(roomId, owner)
    startPeer(owner)
    return owner
  }

  const dropOwner = (owner: PeerOwner, diagnosticOnly = false, strict = false) => {
    if (owner.disposed) return
    if (owner.retiring) {
      if (strict && owner.retirementError !== undefined) throw owner.retirementError
      return
    }
    owner.retiring = true
    if (owner.restartTimer) {
      globalThis.clearTimeout(owner.restartTimer)
      owner.restartTimer = null
    }
    owner.pendingJoin?.reject(new Error(`Room "${owner.roomId}" join cancelled`))
    owner.pendingJoin = undefined
    let failed = false
    let failure: unknown
    let roomFailed = false
    let roomFailure: unknown
    let peerFailed = false
    let peerFailure: unknown
    const rememberFailure = (error: unknown) => {
      if (failed) return
      failed = true
      failure = error
    }
    if (!owner.roomRetired) {
      const room = owner.room
      if (!room) owner.roomRetired = true
      else {
        try {
          room.leave()
          owner.roomRetired = true
        } catch (error) {
          roomFailed = true
          roomFailure = error
          rememberFailure(error)
        }
      }
    }
    if (!owner.peerRetired) {
      try {
        owner.peer.close()
        owner.peerRetired = true
      } catch (error) {
        peerFailed = true
        peerFailure = error
        rememberFailure(error)
      }
    }
    if (failed) {
      owner.retiring = false
      owner.retirementError = failure
      if (!strict) {
        if (roomFailed) {
          if (diagnosticOnly) console.error(roomFailure)
          else errorListeners.forEach((listener) => listener(roomFailure as Error, owner.roomId))
        }
        // A close failure after the room has already retired remains a provider diagnostic, as
        // before; the retained owner still prevents a second peer from being created.
        if (peerFailed) console.error(peerFailure)
      }
      if (strict) throw failure
      return
    }
    owner.retirementError = undefined
    owner.disposed = true
    owner.room = undefined
    if (owners.get(owner.roomId) === owner) owners.delete(owner.roomId)
  }

  return {
    peerIdOf: (roomId) => {
      const owner = owners.get(roomId)
      return owner && owner.room && isActiveOwner(owner) ? owner.peerId : ''
    },
    join: (roomId) => {
      const owner = owners.get(roomId) ?? createOwner(roomId)
      if (owner.retirementError !== undefined) return Promise.reject(owner.retirementError)
      if (owner.retiring) return Promise.reject(new Error(`Room "${roomId}" retirement is still pending`))
      repairDisconnectedPeer(owner)
      if (owner.room) return Promise.resolve()
      const pending = owner.pendingJoin ?? createPendingJoin()
      owner.pendingJoin = pending
      joinNow(owner)
      return pending.promise
    },
    leave: (roomId, options) => {
      const owner = owners.get(roomId)
      if (!owner) return
      dropOwner(owner, options?.diagnosticOnly)
    },
    retireRoomsForPreparation: async (roomIds) => {
      let failed = false
      let failure: unknown
      for (const roomId of new Set(roomIds)) {
        const owner = owners.get(roomId)
        if (!owner) continue
        try {
          dropOwner(owner, false, true)
        } catch (error) {
          if (!failed) {
            failed = true
            failure = error
          }
        }
      }
      if (failed) throw failure
    },
    send: async (roomId, payload, to) => {
      const owner = owners.get(roomId)
      if (owner?.retirementError !== undefined) throw owner.retirementError
      const room = owner?.room
      if (!owner || !room) throw new Error(`Room "${roomId}" not joined`)
      room.send(payload, to)
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
