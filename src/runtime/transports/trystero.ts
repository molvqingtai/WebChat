import { joinRoom, selfId } from 'trystero'
import type { Room } from 'trystero'
import type { RoomTransport } from '@/runtime/core/RoomTransport'
import { DELIVERY_FAILURE_MESSAGE } from '@/constants/config'
import { createTransportEvents } from './events'

/**
 * Failures that belong to one peer rather than to the room. A peer behind a symmetric NAT never
 * finishes the handshake, and a user who is chatting happily with everyone else must not be told
 * about it: the room is fine, that one peer is not.
 */
const PEER_LEVEL_FAILURES = [
  'could not connect to peer ',
  'handshake timed out after ',
  'handshake failed',
  'failed sending handshake readiness'
]

/** Trystero prefixes every message with its own name, so the marker can sit anywhere in the text. */
export const isPeerLevelFailure = (message: string) => PEER_LEVEL_FAILURES.some((marker) => message.includes(marker))

/**
 * Frames that never left because one peer stopped reading. The room is fine and the message can be
 * sent again, so the caller is told plainly instead of being handed trystero's internal wording.
 */
const SEND_FAILURES = ['data channel stopped draining', 'peer disconnected', 'no peer with id']

export const isTransientSendFailure = (message: string) => SEND_FAILURES.some((marker) => message.includes(marker))

interface Owner {
  room: Room
  action: StringAction
}

type StringAction = ReturnType<typeof makeStringAction>
const makeStringAction = (room: Room) => room.makeAction<string>('message')

/** Trystero uses one peer id for every room and never reports a room close. */
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
    peerIdOf: (roomId) => (owners.has(roomId) ? selfId : ''),
    join: async (roomId) => {
      await leaving.get(roomId)
      if (owners.has(roomId)) return
      const room = joinRoom({ appId: __NAME__ }, roomId, {
        onJoinError: (details) => {
          if (owners.get(roomId) !== owner) return
          if (isPeerLevelFailure(details.error)) {
            console.warn('[webchat] a peer could not be reached:', details.error)
            return
          }
          events.error.emit(new Error(details.error), roomId)
        }
      })
      const action = makeStringAction(room)
      const owner: Owner = { room, action }
      const live = () => owners.get(roomId) === owner
      owners.set(roomId, owner)
      action.onMessage = (payload, context) => {
        if (live()) events.message.emit(roomId, context.peerId, payload)
      }
      room.onPeerJoin = (peerId) => live() && events.peerJoin.emit(roomId, peerId)
      room.onPeerLeave = (peerId) => live() && events.peerLeave.emit(roomId, peerId)
    },
    leave,
    send: async (roomId, payload, to) => {
      const owner = owners.get(roomId)
      if (!owner) throw new Error(`Room "${roomId}" not joined`)
      await owner.action.send(payload, { target: to ?? null }).catch((error) => {
        const reason = error instanceof Error ? error.message : String(error)
        if (!isTransientSendFailure(reason)) throw error
        console.warn('[webchat] a message was not delivered:', reason)
        throw new Error(DELIVERY_FAILURE_MESSAGE)
      })
    },
    dispose: () => {
      ;[...owners.keys()].forEach(leave)
      events.clear()
    }
  }
}
