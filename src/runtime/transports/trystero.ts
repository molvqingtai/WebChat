import { joinRoom } from 'trystero'
import type { ActionError, MessageAction, Room } from 'trystero'
import { DELIVERY_FAILURE_MESSAGE } from '@/constants/config'
import type { RoomTransport } from '@/runtime/core/RoomTransport'
import { createTransportEvents } from './events'

/**
 * Failures that belong to one peer rather than to the room. A peer behind a symmetric NAT never
 * finishes the handshake, and a user who is chatting happily with everyone else must not be told
 * about it: the room is fine, that one peer is not.
 */
const PEER_LEVEL_ERRORS = ['peer-connect-failed', 'handshake-failed', 'decrypt-failed']

export const isPeerLevelError = (code: string) => PEER_LEVEL_ERRORS.includes(code)

/**
 * Frames that never left because one peer stopped reading. The room is fine and the message can be
 * sent again, so the caller is told plainly instead of being handed trystero's internal wording.
 */
const TRANSIENT_SEND_KINDS = ['disconnected', 'timeout', 'aborted']

export const isTransientSendFailure = (error: Error) => {
  // SAFETY: trystero rejects a send with an Error carrying the failure kind.
  return TRANSIENT_SEND_KINDS.includes((error as ActionError).kind)
}

interface Owner {
  room: Room
  action: MessageAction<string>
  /** trystero 0.27 has no top level selfId; the room reports it once it is ready. */
  peerId: string
}

export const createRoomTransport = (): RoomTransport => {
  const owners = new Map<string, Owner>()
  /** Trystero leaves asynchronously; a new join of the same room waits for it. */
  const leaving = new Map<string, Promise<void>>()
  const events = createTransportEvents()

  const leave = async (roomId: string): Promise<void> => {
    const owner = owners.get(roomId)
    if (!owner) return
    owners.delete(roomId)
    const settled = (async () => {
      await owner.room.leave().catch((error) => console.error(error))
    })()
    leaving.set(roomId, settled)
    try {
      await settled
    } finally {
      if (leaving.get(roomId) === settled) leaving.delete(roomId)
    }
  }

  return {
    ...events.subscriptions,
    peerIdOf: (roomId) => owners.get(roomId)?.peerId ?? '',
    join: async (roomId) => {
      await leaving.get(roomId)
      if (owners.has(roomId)) return
      const room = joinRoom({ appId: __NAME__ }, roomId)
      const owner: Owner = { room, action: room.makeAction<string>('message'), peerId: '' }
      const live = () => owners.get(roomId) === owner
      owners.set(roomId, owner)
      owner.action.onMessage((payload, context) => {
        if (live()) events.message.emit(roomId, context.peerId, payload)
      })
      room.onPeerJoin((context) => {
        if (live()) events.peerJoin.emit(roomId, context.peerId)
      })
      room.onPeerLeave((context) => {
        if (live()) events.peerLeave.emit(roomId, context.peerId)
      })
      room.onError((error) => {
        if (!live() || isPeerLevelError(error.code)) return
        events.error.emit(new Error(error.message), roomId)
      })
      await room.ready
      owner.peerId = (await room.getSelf()).peerId
    },
    leave,
    send: async (roomId, payload, to) => {
      const owner = owners.get(roomId)
      if (!owner) throw new Error(`Room "${roomId}" not joined`)
      await owner.action.send(payload, to === undefined ? undefined : { target: to }).catch((error) => {
        const failure = error instanceof Error ? error : new Error(String(error))
        if (!isTransientSendFailure(failure)) throw failure
        console.warn('[webchat] a message was not delivered:', failure)
        throw new Error(DELIVERY_FAILURE_MESSAGE)
      })
    },
    dispose: () => {
      ;[...owners.keys()].forEach(leave)
      events.clear()
    }
  }
}
