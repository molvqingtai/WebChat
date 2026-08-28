import * as v from 'valibot'
import { WORLD_ROOM_ID_V5 } from '@/constants/config'
import { NativeWireCodec, SessionMessageSchema, WorldRoomMessageSchema } from '@/protocol'
import type {
  RoomTransport,
  RoomMessageTerminal,
  RoomTransportRecovery,
  WorldTransportRecovery,
  WorldTransportRecoveryFact
} from '@/runtime/RoomTransport'
import { createRoomTransport } from '@/runtime/RoomTransportProvider'
import stringToHex from '@/utils/stringToHex'

export interface TransportRoomState {
  roomId: string
  handle: string
  peerId: string
}

export interface TransportProjection {
  rooms: TransportRoomState[]
  worldRecovery: WorldTransportRecovery
  roomRecovery: RoomTransportRecovery
  recoveryFrames: TransportRecoveryFrame[]
}

/** One pre-cut state frame, replayed once into the next Runtime's normal Wire ingress. */
export interface TransportRecoveryFrame {
  roomId: string
  sourcePeerId: string
  sourceGeneration: number
  payload: string
  sequence: number
}

export interface TransportBinding extends TransportProjection {
  admission: number
}

export interface TransportService {
  join: (roomId: string, handle: string, admission: number) => Promise<TransportRoomState>
  leave: (roomId: string, handle: string, options?: { diagnosticOnly?: boolean }) => Promise<void>
  /** Server-private strict retirement. The current handle remains owned until the provider terminal settles. */
  retireRoomForPreparation: (roomId: string, handle: string) => Promise<void>
  send: (roomId: string, handle: string, payload: string, to?: string | string[]) => Promise<void>
  requireRoomRecovery: (roomId: string, domain: string, admission: number) => Promise<void>
  rememberWorldRecovery?: (admission: number, recovery: WorldTransportRecoveryFact) => Promise<void>
  rememberRoomRecovery: (
    roomId: string,
    handle: string,
    admission: number,
    recovery: RoomTransportRecovery['rooms'][number]
  ) => Promise<void>
  rebind: (
    onMessage: (roomId: string, handle: string, sourcePeerId: string, payload: string) => unknown,
    onPeerJoin: (roomId: string, handle: string, peerId: string) => void,
    onPeerLeave: (roomId: string, handle: string, peerId: string) => void,
    onRoomClose: (roomId: string, handle: string) => void,
    onError: (error: Error, roomId: string, handle: string) => void
  ) => Promise<TransportBinding>
}

const report = (callback: () => unknown) => {
  try {
    void Promise.resolve(callback()).catch((error) => console.error(error))
  } catch (error) {
    console.error(error)
  }
}

/** Offscreen owns only physical transport and atomically replaces one callback per event lane. */
export const createTransportService = (transport: RoomTransport = createRoomTransport()): TransportService => {
  const rooms = new Map<string, TransportRoomState>()
  const worldRoomId = stringToHex(WORLD_ROOM_ID_V5)
  const worldMembers = new Map<string, number>()
  const worldIncarnations = new Map<string, number>()
  // Once accepted, the Offscreen owner attaches the opaque current physical handle to the
  // Runtime's commit receipt. Logical Runtime code can never manufacture that incarnation.
  let worldRecovery: WorldTransportRecovery = { members: [], presences: [] }
  const roomMembers = new Map<string, Map<string, number>>()
  const roomIncarnations = new Map<string, Map<string, number>>()
  const roomRecoveries = new Map<string, RoomTransportRecovery['rooms'][number]>()
  const roomRecoveryRequirements = new Map<string, string>()
  const joining = new Map<string, Promise<TransportRoomState>>()
  let admission = 0
  let rebinding: Promise<void> | null = null
  let cutting = false
  let frameSequence = 0
  const pendingFrames = new Map<
    number,
    TransportRecoveryFrame & { valid: boolean; ownerCommitted: boolean; ownerInvalid: boolean; task: Promise<void> }
  >()
  let onMessage: ((roomId: string, handle: string, sourcePeerId: string, payload: string) => unknown) | null = null
  let onPeerJoin: ((roomId: string, handle: string, peerId: string) => void) | null = null
  let onPeerLeave: ((roomId: string, handle: string, peerId: string) => void) | null = null
  let onRoomClose: ((roomId: string, handle: string) => void) | null = null
  let onError: ((error: Error, roomId: string, handle: string) => void) | null = null
  const clearRoomRecovery = (roomId: string) => {
    roomMembers.delete(roomId)
    roomIncarnations.delete(roomId)
    roomRecoveries.delete(roomId)
    roomRecoveryRequirements.delete(roomId)
  }
  const projection = (): TransportProjection => ({
    rooms: [...rooms.values()],
    worldRecovery: {
      members: [...worldMembers].map(([sourcePeerId, sourceGeneration]) => ({ sourcePeerId, sourceGeneration })),
      presences: worldRecovery.presences.filter(
        ({ sourcePeerId, sourceGeneration }) => worldMembers.get(sourcePeerId) === sourceGeneration
      ),
      ...(worldRecovery.local
        ? {
            local: {
              peerId: worldRecovery.local.peerId,
              handle: worldRecovery.local.handle,
              registrations: worldRecovery.local.registrations.map(({ domain, user, site }) => ({
                domain,
                user: { ...user },
                site: { ...site }
              }))
            }
          }
        : {})
    },
    roomRecovery: {
      rooms: [...roomRecoveries.values()].map((recovery) => {
        const members = roomMembers.get(recovery.roomId) ?? new Map<string, number>()
        return {
          ...recovery,
          local: { ...recovery.local, user: { ...recovery.local.user }, site: { ...recovery.local.site } },
          sessions: recovery.sessions
            .filter(({ sourcePeerId, sourceGeneration }) => members.get(sourcePeerId) === sourceGeneration)
            .map(({ sourcePeerId, sourceGeneration, session }) => ({
              sourcePeerId,
              sourceGeneration,
              session: { ...session, user: { ...session.user } }
            }))
        }
      })
    },
    recoveryFrames: []
  })
  const currentRoom = (roomId: string, handle: string) => {
    const room = rooms.get(roomId)
    if (!room || room.handle !== handle) throw new Error('Transport room handle is no longer current')
    return room
  }
  const forgetRoom = (roomId: string) => {
    rooms.delete(roomId)
    if (roomId === worldRoomId) {
      worldMembers.clear()
      worldIncarnations.clear()
      worldRecovery = { members: [], presences: [] }
    } else clearRoomRecovery(roomId)
  }

  transport.onMessage((roomId, sourcePeerId, payload) => {
    const room = rooms.get(roomId)
    let tracked = false
    if (!cutting) {
      const sourceGeneration =
        roomId === worldRoomId ? worldMembers.get(sourcePeerId) : roomMembers.get(roomId)?.get(sourcePeerId)
      if (sourceGeneration !== undefined) {
        tracked = true
        const sequence = ++frameSequence
        const frame = {
          roomId,
          sourcePeerId,
          sourceGeneration,
          payload,
          sequence,
          valid: false,
          ownerCommitted: false,
          ownerInvalid: false,
          task: Promise.resolve()
        }
        const classified = NativeWireCodec.decode(payload)
          .then((value) =>
            roomId === worldRoomId
              ? v.safeParse(WorldRoomMessageSchema, value).success
              : v.safeParse(SessionMessageSchema, value).success
          )
          .then((valid) => {
            frame.valid = valid
          })
          .catch(() => {})
        // The Remote facade resolves this only when its currently installed Wire owner reaches
        // the raw-frame terminal. A disposed facade rejects, which preserves the decoded frame
        // for the next owner's ordered recovery drain instead of silently dropping it.
        const ownerCallback = onMessage
        const owner =
          room && ownerCallback
            ? Promise.resolve()
                .then(() => ownerCallback(roomId, room.handle, sourcePeerId, payload))
                .then(
                  (terminal) => {
                    if (terminal === 'invalid') frame.ownerInvalid = true
                    else frame.ownerCommitted = true
                  },
                  () => {
                    frame.ownerInvalid = true
                  }
                )
            : Promise.resolve('invalid' as const).then(() => {
                frame.ownerInvalid = true
              })
        frame.task = Promise.all([classified, owner]).then(() => {
          if (!cutting && frame.ownerCommitted) pendingFrames.delete(sequence)
        })
        pendingFrames.set(sequence, frame)
      }
    }
    if (room && onMessage && !tracked) {
      report(() => onMessage!(roomId, room.handle, sourcePeerId, payload))
    }
  })
  transport.onPeerJoin((roomId, peerId) => {
    if (roomId === worldRoomId) {
      if (!worldMembers.has(peerId)) {
        const sourceGeneration = (worldIncarnations.get(peerId) ?? 0) + 1
        worldIncarnations.set(peerId, sourceGeneration)
        worldMembers.set(peerId, sourceGeneration)
      }
    } else if (rooms.has(roomId) || roomRecoveryRequirements.has(roomId)) {
      const members = roomMembers.get(roomId) ?? new Map<string, number>()
      const incarnations = roomIncarnations.get(roomId) ?? new Map<string, number>()
      const sourceGeneration = (incarnations.get(peerId) ?? 0) + 1
      incarnations.set(peerId, sourceGeneration)
      roomIncarnations.set(roomId, incarnations)
      members.set(peerId, sourceGeneration)
      roomMembers.set(roomId, members)
    }
    const room = rooms.get(roomId)
    if (room && onPeerJoin) report(() => onPeerJoin!(roomId, room.handle, peerId))
  })
  transport.onPeerLeave((roomId, peerId) => {
    if (roomId === worldRoomId) {
      worldMembers.delete(peerId)
      worldRecovery = {
        members: worldRecovery.members.filter((member) => member.sourcePeerId !== peerId),
        presences: worldRecovery.presences.filter((presence) => presence.sourcePeerId !== peerId)
      }
    } else {
      roomMembers.get(roomId)?.delete(peerId)
    }
    const room = rooms.get(roomId)
    if (room && onPeerLeave) report(() => onPeerLeave!(roomId, room.handle, peerId))
  })
  transport.onRoomClose((roomId) => {
    const room = rooms.get(roomId)
    if (!room) return
    rooms.delete(roomId)
    if (roomId === worldRoomId) {
      worldMembers.clear()
      worldIncarnations.clear()
      worldRecovery = { members: [], presences: [] }
    } else clearRoomRecovery(roomId)
    if (onRoomClose) report(() => onRoomClose!(roomId, room.handle))
  })
  transport.onError((error, roomId) => {
    const room = rooms.get(roomId)
    if (room && onError) report(() => onError!(error, roomId, room.handle))
  })

  return {
    join: async (roomId, handle, joinAdmission) => {
      if (joinAdmission !== admission) throw new Error('Transport room admission is no longer current')
      const existing = rooms.get(roomId)
      if (existing) {
        if (existing.handle !== handle) throw new Error('Transport room is owned by a newer handle')
        return existing
      }
      const pending = joining.get(roomId)
      if (pending) {
        const room = await pending
        if (room.handle !== handle) throw new Error('Transport room is owned by a newer handle')
        return room
      }
      const task = (async () => {
        await transport.join(roomId)
        const room = { roomId, handle, peerId: transport.peerIdOf(roomId) }
        rooms.set(roomId, room)
        return room
      })()
      joining.set(roomId, task)
      void task.then(
        () => {
          if (joining.get(roomId) === task) joining.delete(roomId)
        },
        () => {
          if (joining.get(roomId) === task) joining.delete(roomId)
        }
      )
      return task
    },
    leave: async (roomId, handle, options) => {
      currentRoom(roomId, handle)
      forgetRoom(roomId)
      transport.leave(roomId, options)
    },
    retireRoomForPreparation: async (roomId, handle) => {
      currentRoom(roomId, handle)
      await transport.retireRoomsForPreparation([roomId])
      // A provider close event may already have removed this handle. Otherwise retirement owns
      // the local routing cut only after the exact provider terminal succeeded.
      if (rooms.get(roomId)?.handle === handle) forgetRoom(roomId)
    },
    send: async (roomId, handle, payload, to) => {
      currentRoom(roomId, handle)
      await transport.send(roomId, payload, to)
    },
    requireRoomRecovery: async (roomId, domain, recoveryAdmission) => {
      if (recoveryAdmission !== admission) throw new Error('Transport recovery admission is no longer current')
      const existing = roomRecoveryRequirements.get(roomId)
      if (existing && existing !== domain) throw new Error('Transport Room recovery domain conflicts with current room')
      roomRecoveryRequirements.set(roomId, domain)
    },
    rememberWorldRecovery: async (recoveryAdmission, recovery) => {
      if (recoveryAdmission !== admission) throw new Error('Transport recovery admission is no longer current')
      const worldRoom = rooms.get(worldRoomId)
      if (recovery.local && (!worldRoom || worldRoom.peerId !== recovery.local.peerId)) {
        throw new Error('Transport World local recovery does not match its current physical peer')
      }
      if (
        recovery.members.some(
          ({ sourcePeerId, sourceGeneration }) => worldMembers.get(sourcePeerId) !== sourceGeneration
        ) ||
        recovery.presences.some(
          ({ sourcePeerId, sourceGeneration }) => worldMembers.get(sourcePeerId) !== sourceGeneration
        )
      ) {
        throw new Error('Transport World recovery source is no longer current')
      }
      worldRecovery = {
        members: recovery.members.map((member) => ({ ...member })),
        presences: recovery.presences.map(({ sourcePeerId, sourceGeneration, presence }) => ({
          sourcePeerId,
          sourceGeneration,
          presence: { ...presence, user: { ...presence.user }, sites: presence.sites.map((site) => ({ ...site })) }
        })),
        ...(recovery.local
          ? {
              local: {
                peerId: recovery.local.peerId,
                handle: worldRoom!.handle,
                registrations: recovery.local.registrations.map(({ domain, user, site }) => ({
                  domain,
                  user: { ...user },
                  site: { ...site }
                }))
              }
            }
          : {})
      }
    },
    rememberRoomRecovery: async (roomId, handle, recoveryAdmission, recovery) => {
      if (recoveryAdmission !== admission) throw new Error('Transport recovery admission is no longer current')
      currentRoom(roomId, handle)
      if (recovery.roomId !== roomId) throw new Error('Transport recovery room does not match its current handle')
      const requiredDomain = roomRecoveryRequirements.get(roomId)
      if (requiredDomain && requiredDomain !== recovery.domain) {
        throw new Error('Transport Room recovery domain conflicts with current room')
      }
      roomRecoveryRequirements.set(roomId, recovery.domain)
      const members = roomMembers.get(roomId) ?? new Map<string, number>()
      if (
        recovery.sessions.some(({ sourcePeerId, sourceGeneration }) => members.get(sourcePeerId) !== sourceGeneration)
      ) {
        throw new Error('Transport Room recovery source is no longer current')
      }
      roomRecoveries.set(roomId, {
        ...recovery,
        local: { ...recovery.local, user: { ...recovery.local.user }, site: { ...recovery.local.site } },
        sessions: recovery.sessions.map(({ sourcePeerId, sourceGeneration, session }) => ({
          sourcePeerId,
          sourceGeneration,
          session: { ...session, user: { ...session.user } }
        }))
      })
    },
    rebind: (message, peerJoin, peerLeave, roomClose, error) => {
      const register = async () => {
        cutting = true
        onMessage = message
        onPeerJoin = peerJoin
        onPeerLeave = peerLeave
        onRoomClose = roomClose
        onError = error
        // Let an already-active facade submit its synchronous admission before the rebind cut.
        await Promise.resolve()
        // The final empty observation, projection, and admission publication are one cut.
        while (joining.size > 0) await Promise.allSettled(joining.values())
        if (
          worldRecovery.members.some(
            ({ sourcePeerId, sourceGeneration }) => worldMembers.get(sourcePeerId) !== sourceGeneration
          )
        ) {
          throw new Error('Transport World recovery is incomplete')
        }
        const preCutFrames = [...pendingFrames.values()]
        if (preCutFrames.length > 0) await Promise.allSettled(preCutFrames.map((frame) => frame.task))
        const incompleteRooms = [...roomRecoveryRequirements.keys()].filter(
          (roomId) => rooms.has(roomId) && !roomRecoveries.has(roomId)
        )
        if (incompleteRooms.length > 0) {
          // Retire only each exact currently-owned incomplete physical Room through the same
          // ownership cut as retireRoomForPreparation before rejecting the original error.
          for (const roomId of incompleteRooms) {
            const handle = rooms.get(roomId)?.handle
            if (handle === undefined) continue
            currentRoom(roomId, handle)
            await transport.retireRoomsForPreparation([roomId])
            // A provider close event may already have removed this handle. Otherwise retirement
            // owns the local routing cut only after the exact provider terminal succeeded.
            if (rooms.get(roomId)?.handle === handle) forgetRoom(roomId)
          }
          throw new Error('Transport Room recovery is incomplete')
        }
        const current = projection()
        current.recoveryFrames = preCutFrames
          .filter(
            ({ roomId, sourcePeerId, sourceGeneration, valid, ownerCommitted, ownerInvalid }) =>
              valid &&
              !ownerCommitted &&
              ownerInvalid &&
              (roomId === worldRoomId
                ? worldMembers.get(sourcePeerId) === sourceGeneration
                : roomMembers.get(roomId)?.get(sourcePeerId) === sourceGeneration)
          )
          .sort((left, right) => left.sequence - right.sequence)
          .map(({ roomId, sourcePeerId, sourceGeneration, payload, sequence }) => ({
            roomId,
            sourcePeerId,
            sourceGeneration,
            payload,
            sequence
          }))
        preCutFrames.forEach((frame) => pendingFrames.delete(frame.sequence))
        admission += 1
        cutting = false
        return { ...current, admission }
      }
      const binding = (rebinding ? rebinding.then(register) : register()).finally(() => {
        cutting = false
      })
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
