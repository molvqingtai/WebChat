import type { RoomTransport } from '@/runtime/RoomTransport'
import { nanoid } from 'nanoid'
import type { TransportProjection, TransportRoomState, TransportService } from '@/runtime/TransportHost'

/** Background-side facade over Offscreen's physical transport; its rooms are callback-aligned projections. */
export class RemoteRoomTransport implements RoomTransport {
  private readonly rooms = new Map<string, TransportRoomState>()
  private readonly messages = new Set<(roomId: string, sourcePeerId: string, payload: string) => void>()
  private readonly joins = new Set<(roomId: string, peerId: string) => void>()
  private readonly leaves = new Set<(roomId: string, peerId: string) => void>()
  private readonly closes = new Set<(roomId: string) => void>()
  private readonly errors = new Set<(error: Error, roomId: string) => void>()
  private binding: Promise<void> = Promise.resolve()
  private generation = 0
  private acceptingGeneration = 0
  private disposed = false

  constructor(private readonly service: TransportService) {}

  rebind() {
    const generation = ++this.generation
    this.acceptingGeneration = 0
    const align = (projections: TransportProjection[]) => {
      const projection = projections.at(0) ?? { rooms: [] }
      if (projections.some((candidate) => JSON.stringify(candidate) !== JSON.stringify(projection))) {
        throw new Error('Transport callback registrations did not return one current projection')
      }
      const previous = new Map(this.rooms)
      this.rooms.clear()
      projection.rooms.forEach((room) => this.rooms.set(room.roomId, room))
      previous.forEach((room, roomId) => {
        if (this.rooms.get(roomId)?.handle !== room.handle) this.closes.forEach((callback) => callback(roomId))
      })
    }
    this.binding = Promise.all([
      this.service.onMessage((roomId, handle, sourcePeerId, payload) => {
        if (!this.accepts(generation, roomId, handle)) return
        this.messages.forEach((callback) => callback(roomId, sourcePeerId, payload))
      }),
      this.service.onPeerJoin((roomId, handle, peerId) => {
        if (!this.accepts(generation, roomId, handle)) return
        this.joins.forEach((callback) => callback(roomId, peerId))
      }),
      this.service.onPeerLeave((roomId, handle, peerId) => {
        if (!this.accepts(generation, roomId, handle)) return
        this.leaves.forEach((callback) => callback(roomId, peerId))
      }),
      this.service.onRoomClose((roomId, handle) => {
        if (!this.accepts(generation, roomId, handle)) return
        this.rooms.delete(roomId)
        this.closes.forEach((callback) => callback(roomId))
      }),
      this.service.onError((error, roomId, handle) => {
        if (!this.accepts(generation, roomId, handle)) return
        this.errors.forEach((callback) => callback(error, roomId))
      })
    ]).then((projections) => {
      if (!this.isCurrent(generation)) return
      align(projections)
      this.acceptingGeneration = generation
    })
    return this.binding
  }

  private isCurrent(generation: number) {
    return !this.disposed && this.generation === generation
  }

  private accepts(generation: number, roomId: string, handle: string) {
    return (
      this.isCurrent(generation) && this.acceptingGeneration === generation && this.rooms.get(roomId)?.handle === handle
    )
  }

  peerIdOf = (roomId: string) => this.rooms.get(roomId)?.peerId ?? ''
  join = async (roomId: string) => {
    const generation = this.generation
    await this.binding
    if (!this.isCurrent(generation)) throw new Error('Room transport generation is no longer current')
    const existing = this.rooms.get(roomId)
    if (existing) return
    const room = await this.service.join(roomId, nanoid())
    if (!this.isCurrent(generation)) throw new Error('Room transport generation is no longer current')
    this.rooms.set(roomId, room)
  }
  leave = async (roomId: string, options?: { diagnosticOnly?: boolean }) => {
    const generation = this.generation
    const room = this.rooms.get(roomId)
    if (!room) return
    await this.binding
    if (!this.isCurrent(generation) || this.rooms.get(roomId)?.handle !== room.handle) return
    await this.service.leave(roomId, room.handle, options)
    if (this.isCurrent(generation) && this.rooms.get(roomId)?.handle === room.handle) this.rooms.delete(roomId)
  }
  send = async (roomId: string, payload: string, to?: string | string[]) => {
    const generation = this.generation
    const room = this.rooms.get(roomId)
    if (!room) throw new Error('Room transport has no current handle')
    await this.binding
    if (!this.isCurrent(generation) || this.rooms.get(roomId)?.handle !== room.handle) {
      throw new Error('Room transport generation is no longer current')
    }
    await this.service.send(roomId, room.handle, payload, to)
    if (!this.isCurrent(generation) || this.rooms.get(roomId)?.handle !== room.handle) {
      throw new Error('Room transport generation is no longer current')
    }
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
    this.acceptingGeneration = 0
    this.rooms.clear()
    this.messages.clear()
    this.joins.clear()
    this.leaves.clear()
    this.closes.clear()
    this.errors.clear()
  }
}
