import { joinRoom, selfId } from 'trystero'
import type { Room } from 'trystero'
import type { RoomTransport } from '@/runtime/core/RoomTransport'
import { createTransportEvents } from './events'

interface MessageAction {
  send: (data: string, options?: { target?: string | string[] | null }) => Promise<void>
  onMessage: ((data: string, context: { peerId: string }) => void) | null
}

interface Owner {
  room: Room
  action: MessageAction
}

/** Trystero uses one peer id for every room and never reports a room close. */
export const createRoomTransport = (): RoomTransport => {
  const owners = new Map<string, Owner>()
  /** Trystero leaves asynchronously; a new join of the same room waits for it. */
  const leaving = new Map<string, Promise<void>>()
  const events = createTransportEvents()

  const leave = (roomId: string) => {
    const owner = owners.get(roomId)
    if (!owner) return
    owners.delete(roomId)
    const settled = Promise.resolve()
      .then(() => owner.room.leave())
      .catch((error) => console.error(error))
      .finally(() => {
        if (leaving.get(roomId) === settled) leaving.delete(roomId)
      })
    leaving.set(roomId, settled)
  }

  return {
    ...events.subscriptions,
    peerIdOf: (roomId) => (owners.has(roomId) ? selfId : ''),
    join: async (roomId) => {
      await leaving.get(roomId)
      if (owners.has(roomId)) return
      const room = joinRoom({ appId: __NAME__ }, roomId, {
        onJoinError: (details) => {
          if (owners.get(roomId) !== owner || details.error.startsWith('could not connect to peer ')) return
          events.error.emit(new Error(details.error), roomId)
        }
      })
      // SAFETY: the action is created for string payloads only.
      const action = room.makeAction('message') as unknown as MessageAction
      const owner: Owner = { room, action }
      const live = () => owners.get(roomId) === owner
      owners.set(roomId, owner)
      action.onMessage = (payload, context) => live() && events.message.emit(roomId, context.peerId, payload)
      room.onPeerJoin = (peerId) => live() && events.peerJoin.emit(roomId, peerId)
      room.onPeerLeave = (peerId) => live() && events.peerLeave.emit(roomId, peerId)
    },
    leave,
    send: async (roomId, payload, to) => {
      const owner = owners.get(roomId)
      if (!owner) throw new Error(`Room "${roomId}" not joined`)
      await owner.action.send(payload, { target: to ?? null })
    },
    dispose: () => {
      ;[...owners.keys()].forEach(leave)
      events.clear()
    }
  }
}
