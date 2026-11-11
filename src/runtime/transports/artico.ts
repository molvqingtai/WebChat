import { Artico, SocketSignaling } from '@rtco/client'
import type { Room } from '@rtco/client'
import { nanoid } from 'nanoid'
import type { RoomTransport } from '@/runtime/core/RoomTransport'
import { createTransportEvents } from './events'

const SIGNALING_URL = 'wss://web-chat.io'
const RESTART_DELAY_MS = 10000

interface Owner {
  roomId: string
  peerId: string
  peer?: Artico
  room?: Room
  pending?: { promise: Promise<void>; resolve: () => void; reject: (error: Error) => void }
  restart?: ReturnType<typeof setTimeout>
}

/** One Artico peer per room, so the local peer id differs between rooms. */
export const createRoomTransport = (): RoomTransport => {
  const owners = new Map<string, Owner>()
  const events = createTransportEvents()
  const isCurrent = (owner: Owner, peer: Artico) => owners.get(owner.roomId) === owner && owner.peer === peer

  const enter = (owner: Owner, peer: Artico) => {
    if (owner.room || peer.state !== 'ready') return
    try {
      const room = peer.join(owner.roomId)
      const live = () => isCurrent(owner, peer) && owner.room === room
      owner.room = room
      room.on('message', (payload, peerId) => live() && events.message.emit(owner.roomId, peerId, payload))
      room.on('join', (peerId) => live() && events.peerJoin.emit(owner.roomId, peerId))
      room.on('leave', (peerId) => live() && events.peerLeave.emit(owner.roomId, peerId))
      room.on('close', () => {
        if (!live()) return
        owner.room = undefined
        events.roomClose.emit(owner.roomId)
      })
      owner.pending?.resolve()
    } catch (error) {
      owner.pending?.reject(error as Error)
    }
    owner.pending = undefined
  }

  const start = (owner: Owner) => {
    clearTimeout(owner.restart)
    owner.restart = undefined
    owner.room = undefined
    try {
      owner.peer?.close()
    } catch (error) {
      console.error(error)
    }
    owner.peerId = nanoid()
    const peer = new Artico({
      id: owner.peerId,
      signaling: new SocketSignaling({ url: SIGNALING_URL, id: owner.peerId })
    })
    owner.peer = peer
    peer.on('open', () => isCurrent(owner, peer) && enter(owner, peer))
    peer.on('error', (error) => isCurrent(owner, peer) && events.error.emit(error, owner.roomId))
    peer.on('close', () => {
      if (!isCurrent(owner, peer) || owner.restart) return
      owner.restart = setTimeout(() => start(owner), RESTART_DELAY_MS)
    })
  }

  const leave = (roomId: string) => {
    const owner = owners.get(roomId)
    if (!owner) return
    owners.delete(roomId)
    clearTimeout(owner.restart)
    owner.pending?.reject(new Error(`Room "${roomId}" join cancelled`))
    try {
      owner.room?.leave()
      owner.peer?.close()
    } catch (error) {
      console.error(error)
    }
  }

  return {
    ...events.subscriptions,
    peerIdOf: (roomId) => {
      const owner = owners.get(roomId)
      return owner?.room ? owner.peerId : ''
    },
    join: (roomId) => {
      let owner = owners.get(roomId)
      if (!owner) {
        owner = { roomId, peerId: '' }
        owners.set(roomId, owner)
        start(owner)
      } else if (owner.peer?.state === 'disconnected') {
        start(owner)
      }
      if (owner.room) return Promise.resolve()
      if (!owner.pending) {
        const { promise, resolve, reject } = Promise.withResolvers<void>()
        owner.pending = { promise, resolve, reject }
      }
      const { promise } = owner.pending
      enter(owner, owner.peer!)
      return promise
    },
    leave,
    send: async (roomId, payload, to) => {
      const room = owners.get(roomId)?.room
      if (!room) throw new Error(`Room "${roomId}" not joined`)
      room.send(payload, to)
    },
    dispose: () => {
      ;[...owners.keys()].forEach(leave)
      events.clear()
    }
  }
}
