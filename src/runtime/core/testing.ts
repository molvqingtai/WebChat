import type { Channel } from './Contract'
import type { RoomTransport } from './RoomTransport'

type Listeners<Args extends unknown[]> = Set<(...args: Args) => void>

/** In-memory network for core tests: every transport created from one hub can reach the others. */
export const createMemoryHub = () => {
  const rooms = new Map<string, Map<string, MemoryTransport>>()
  let sequence = 0

  class MemoryTransport implements RoomTransport {
    readonly peerId = `peer-${++sequence}`
    readonly sent: Array<{ roomId: string; payload: string; to?: string | string[] }> = []
    private readonly message: Listeners<[string, string, string]> = new Set()
    private readonly peerJoin: Listeners<[string, string]> = new Set()
    private readonly peerLeave: Listeners<[string, string]> = new Set()
    private readonly roomClose: Listeners<[string]> = new Set()
    private readonly error: Listeners<[Error, string]> = new Set()
    failJoin = false
    /** Never settles, so the caller's join timeout is what fails the attempt. */
    hangJoin = false

    peerIdOf = (roomId: string) => (rooms.get(roomId)?.has(this.peerId) ? this.peerId : '')

    join = async (roomId: string) => {
      if (this.hangJoin) return new Promise<void>(() => {})
      if (this.failJoin) throw new Error('join failed')
      const members = rooms.get(roomId) ?? new Map<string, MemoryTransport>()
      rooms.set(roomId, members)
      if (members.has(this.peerId)) return
      members.forEach((member) => {
        member.peerJoin.forEach((listener) => listener(roomId, this.peerId))
        this.peerJoin.forEach((listener) => listener(roomId, member.peerId))
      })
      members.set(this.peerId, this)
    }

    leave = (roomId: string) => {
      const members = rooms.get(roomId)
      if (!members?.delete(this.peerId)) return
      members.forEach((member) => member.peerLeave.forEach((listener) => listener(roomId, this.peerId)))
    }

    send = async (roomId: string, payload: string, to?: string | string[]) => {
      const members = rooms.get(roomId)
      if (!members?.has(this.peerId)) throw new Error(`Room "${roomId}" not joined`)
      this.sent.push({ roomId, payload, to })
      const targets = to === undefined ? null : new Set([to].flat())
      members.forEach((member) => {
        if (member === this || (targets && !targets.has(member.peerId))) return
        member.message.forEach((listener) => listener(roomId, this.peerId, payload))
      })
    }

    /** Simulates the provider dropping the room under us. */
    close = (roomId: string) => {
      this.leave(roomId)
      this.roomClose.forEach((listener) => listener(roomId))
    }

    private subscribe = <Args extends unknown[]>(listeners: Listeners<Args>, callback: (...args: Args) => void) => {
      listeners.add(callback)
      return () => listeners.delete(callback)
    }
    onMessage: RoomTransport['onMessage'] = (callback) => this.subscribe(this.message, callback)
    onPeerJoin: RoomTransport['onPeerJoin'] = (callback) => this.subscribe(this.peerJoin, callback)
    onPeerLeave: RoomTransport['onPeerLeave'] = (callback) => this.subscribe(this.peerLeave, callback)
    onRoomClose: RoomTransport['onRoomClose'] = (callback) => this.subscribe(this.roomClose, callback)
    onError: RoomTransport['onError'] = (callback) => this.subscribe(this.error, callback)

    dispose = () => [...rooms.keys()].forEach((roomId) => this.leave(roomId))
  }

  return { createTransport: () => new MemoryTransport() }
}
/** Two Channel ends backed by a MessageChannel: the same shape a worker host would use. */
export const createChannelPair = (domain: string) => {
  const { port1, port2 } = new MessageChannel()
  const closers = new Set<() => void>()
  const close = () => {
    closers.forEach((listener) => listener())
    closers.clear()
    port1.close()
    port2.close()
  }
  const wrap = (port: MessagePort): Channel => ({
    domain,
    post: (frame) => port.postMessage(frame),
    onMessage: (listener) => {
      const handler = (event: MessageEvent) => listener(event.data)
      port.addEventListener('message', handler)
      port.start()
      return () => port.removeEventListener('message', handler)
    },
    onClose: (listener) => {
      closers.add(listener)
      return () => closers.delete(listener)
    },
    close
  })
  return { host: wrap(port1), page: wrap(port2), close }
}
