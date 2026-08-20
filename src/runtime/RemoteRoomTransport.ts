import type { RoomTransport } from '@/runtime/RoomTransport'
import type { TransportService } from '@/runtime/TransportHost'

/** Background-local facade over the physical Offscreen transport. It retains no transport state. */
export class RemoteRoomTransport implements RoomTransport {
  private readonly peerIds = new Map<string, string>()
  private readonly messages = new Set<(roomId: string, sourcePeerId: string, payload: string) => void>()
  private readonly joins = new Set<(roomId: string, peerId: string) => void>()
  private readonly leaves = new Set<(roomId: string, peerId: string) => void>()
  private readonly closes = new Set<(roomId: string) => void>()
  private readonly errors = new Set<(error: Error, roomId: string) => void>()
  private binding: Promise<void> = Promise.resolve()
  private generation = 0
  private disposed = false

  constructor(private readonly service: TransportService) {}

  rebind() {
    const generation = ++this.generation
    const closedRoomIds = [...this.peerIds.keys()]
    this.peerIds.clear()
    this.binding = Promise.all([
      this.service.onMessage((roomId, sourcePeerId, payload) => {
        if (!this.isCurrent(generation)) return
        this.messages.forEach((callback) => callback(roomId, sourcePeerId, payload))
      }),
      this.service.onPeerJoin((roomId, peerId) => {
        if (!this.isCurrent(generation)) return
        this.joins.forEach((callback) => callback(roomId, peerId))
      }),
      this.service.onPeerLeave((roomId, peerId) => {
        if (!this.isCurrent(generation)) return
        this.leaves.forEach((callback) => callback(roomId, peerId))
      }),
      this.service.onRoomClose((roomId) => {
        if (!this.isCurrent(generation)) return
        this.peerIds.delete(roomId)
        this.closes.forEach((callback) => callback(roomId))
      }),
      this.service.onError((error, roomId) => {
        if (!this.isCurrent(generation)) return
        this.errors.forEach((callback) => callback(error, roomId))
      })
    ]).then(() => {
      if (!this.isCurrent(generation)) return
      closedRoomIds.forEach((roomId) => this.closes.forEach((callback) => callback(roomId)))
    })
    return this.binding
  }

  private isCurrent(generation: number) {
    return !this.disposed && this.generation === generation
  }

  peerIdOf = (roomId: string) => this.peerIds.get(roomId) ?? ''
  join = async (roomId: string) => {
    const generation = this.generation
    await this.binding
    if (!this.isCurrent(generation)) throw new Error('Room transport generation is no longer current')
    const peerId = await this.service.join(roomId)
    if (!this.isCurrent(generation)) throw new Error('Room transport generation is no longer current')
    this.peerIds.set(roomId, peerId)
  }
  leave = (roomId: string, options?: { diagnosticOnly?: boolean }) => {
    this.peerIds.delete(roomId)
    void this.service.leave(roomId, options).catch(console.error)
  }
  send = async (roomId: string, payload: string, to?: string | string[]) => {
    await this.binding
    await this.service.send(roomId, payload, to)
  }
  onMessage = (callback: (roomId: string, sourcePeerId: string, payload: string) => void) => {
    this.messages.add(callback)
    return () => this.messages.delete(callback)
  }
  onPeerJoin = (callback: (roomId: string, peerId: string) => void) => {
    this.joins.add(callback)
    return () => this.joins.delete(callback)
  }
  onPeerLeave = (callback: (roomId: string, peerId: string) => void) => {
    this.leaves.add(callback)
    return () => this.leaves.delete(callback)
  }
  onRoomClose = (callback: (roomId: string) => void) => {
    this.closes.add(callback)
    return () => this.closes.delete(callback)
  }
  onError = (callback: (error: Error, roomId: string) => void) => {
    this.errors.add(callback)
    return () => this.errors.delete(callback)
  }
  dispose = () => {
    this.disposed = true
    this.generation += 1
    this.peerIds.clear()
    this.messages.clear()
    this.joins.clear()
    this.leaves.clear()
    this.closes.clear()
    this.errors.clear()
  }
}
