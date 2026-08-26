import type {
  RoomTransport,
  RoomMessageTerminal,
  RecoveryBindingCapability,
  RecoveryBindingCapabilityUse,
  RoomTransportRecovery,
  WorldTransportRecovery,
  WorldTransportRecoveryFact
} from '@/runtime/RoomTransport'
import { nanoid } from 'nanoid'
import type {
  TransportProjection,
  TransportRecoveryFrame,
  TransportRoomState,
  TransportService
} from '@/runtime/TransportHost'

type PendingJoin = {
  generation: number
  admission: number
  task: Promise<void>
}

/** Background-side facade over Offscreen's physical transport; its rooms are callback-aligned projections. */
export class RemoteRoomTransport implements RoomTransport {
  private readonly rooms = new Map<string, TransportRoomState>()
  private readonly messages = new Set<(roomId: string, sourcePeerId: string, payload: string) => unknown>()
  private readonly joins = new Set<(roomId: string, peerId: string) => void>()
  private readonly leaves = new Set<(roomId: string, peerId: string) => void>()
  private readonly closes = new Set<(roomId: string) => void>()
  private readonly errors = new Set<(error: Error, roomId: string) => void>()
  private readonly pendingJoins = new Map<string, PendingJoin>()
  private binding: Promise<void> = Promise.resolve()
  private generation = 0
  private acceptingGeneration = 0
  private admission = 0
  private disposed = false
  private pendingIngress: Array<() => Promise<RoomMessageTerminal>> = []
  private readonly ownerInvalidations = new Map<number, PromiseWithResolvers<RoomMessageTerminal>>()
  private worldRecoveryState: WorldTransportRecovery = { members: [], presences: [] }
  private roomRecoveryState: RoomTransportRecovery = { rooms: [] }
  private recoveryFrames: TransportRecoveryFrame[] = []
  private recoveryCapabilityEpoch = 0
  private readonly recoveryCapabilities = new WeakMap<
    RecoveryBindingCapability,
    { roomId: string; generation: number; admission: number; handle: string; epoch: number; consumed: boolean }
  >()

  constructor(private readonly service: TransportService) {}

  rebind() {
    this.recoveryCapabilityEpoch += 1
    this.invalidateOwner(this.generation)
    this.pendingJoins.clear()
    const generation = ++this.generation
    this.acceptingGeneration = 0
    const align = (projection: TransportProjection) => {
      const previous = new Map(this.rooms)
      this.rooms.clear()
      projection.rooms.forEach((room) => this.rooms.set(room.roomId, room))
      previous.forEach((room, roomId) => {
        if (this.rooms.get(roomId)?.handle !== room.handle) this.closes.forEach((callback) => callback(roomId))
      })
      this.worldRecoveryState = projection.worldRecovery
      this.roomRecoveryState = projection.roomRecovery
      this.recoveryFrames = projection.recoveryFrames
    }
    this.binding = this.service
      .rebind(
        (roomId, handle, sourcePeerId, payload) => {
          return this.enqueueIngress(generation, roomId, handle, () =>
            this.deliverMessages(roomId, sourcePeerId, payload)
          )
        },
        (roomId, handle, peerId) => {
          this.enqueueIngress(generation, roomId, handle, () =>
            this.joins.forEach((callback) => callback(roomId, peerId))
          )
        },
        (roomId, handle, peerId) => {
          this.enqueueIngress(generation, roomId, handle, () =>
            this.leaves.forEach((callback) => callback(roomId, peerId))
          )
        },
        (roomId, handle) => {
          this.enqueueIngress(generation, roomId, handle, () => {
            this.rooms.delete(roomId)
            this.closes.forEach((callback) => callback(roomId))
          })
        },
        (error, roomId, handle) => {
          this.enqueueIngress(generation, roomId, handle, () =>
            this.errors.forEach((callback) => callback(error, roomId))
          )
        }
      )
      .then(({ admission, ...projection }) => {
        if (!this.isCurrent(generation)) return
        align(projection)
        this.admission = admission
        // Server activates only after both recovery owners and durable ROOM state are ready.
      })
    return this.binding
  }

  private isCurrent(generation: number) {
    return !this.disposed && this.generation === generation
  }

  private invalidationFor(generation: number) {
    let invalidation = this.ownerInvalidations.get(generation)
    if (!invalidation) {
      invalidation = Promise.withResolvers<RoomMessageTerminal>()
      this.ownerInvalidations.set(generation, invalidation)
    }
    return invalidation
  }

  private invalidateOwner(generation: number) {
    this.ownerInvalidations.get(generation)?.resolve('invalid')
  }

  private accepts(generation: number, roomId: string, handle: string) {
    return (
      this.isCurrent(generation) && this.acceptingGeneration === generation && this.rooms.get(roomId)?.handle === handle
    )
  }

  private deliverMessages(roomId: string, sourcePeerId: string, payload: string): Promise<RoomMessageTerminal> {
    return Promise.all([...this.messages].map((callback) => callback(roomId, sourcePeerId, payload))).then(
      (terminals) => (terminals.some((terminal) => terminal === 'invalid') ? 'invalid' : 'committed')
    )
  }

  private invokeIngress(callback: () => unknown): Promise<RoomMessageTerminal> {
    return Promise.resolve(callback()).then((terminal) => (terminal === 'invalid' ? 'invalid' : 'committed'))
  }

  private settleIngress(generation: number, callback: () => unknown) {
    return Promise.race([this.invokeIngress(callback), this.invalidationFor(generation).promise])
  }

  private enqueueIngress(
    generation: number,
    roomId: string,
    handle: string,
    callback: () => unknown
  ): Promise<RoomMessageTerminal> {
    if (!this.isCurrent(generation)) return Promise.resolve('invalid')
    if (this.acceptingGeneration === generation) {
      return this.rooms.get(roomId)?.handle === handle
        ? this.settleIngress(generation, callback)
        : Promise.resolve('invalid')
    }
    const terminal = Promise.withResolvers<RoomMessageTerminal>()
    this.pendingIngress.push(async () => {
      if (!this.isCurrent(generation) || this.rooms.get(roomId)?.handle !== handle) {
        terminal.resolve('invalid')
        return 'invalid'
      }
      const result = await this.settleIngress(generation, callback)
      terminal.resolve(result)
      return result
    })
    return terminal.promise
  }

  peerIdOf = (roomId: string) => this.rooms.get(roomId)?.peerId ?? ''
  worldRecovery = (): WorldTransportRecovery => ({
    members: [...this.worldRecoveryState.members],
    presences: this.worldRecoveryState.presences.map(({ sourcePeerId, sourceGeneration, presence }) => ({
      sourcePeerId,
      sourceGeneration,
      presence
    })),
    ...(this.worldRecoveryState.local
      ? {
          local: {
            peerId: this.worldRecoveryState.local.peerId,
            handle: this.worldRecoveryState.local.handle,
            registrations: this.worldRecoveryState.local.registrations.map(({ domain, user, site }) => ({
              domain,
              user: { ...user },
              site: { ...site }
            }))
          }
        }
      : {})
  })
  roomRecovery = (): RoomTransportRecovery => ({
    rooms: this.roomRecoveryState.rooms.map((recovery) => ({
      ...recovery,
      local: { ...recovery.local, user: { ...recovery.local.user }, site: { ...recovery.local.site } },
      sessions: recovery.sessions.map(({ sourcePeerId, sourceGeneration, session }) => ({
        sourcePeerId,
        sourceGeneration,
        session: { ...session, user: { ...session.user } }
      }))
    }))
  })
  mintRecoveryBindingCapability = (roomId: string): RecoveryBindingCapability | null => {
    const room = this.rooms.get(roomId)
    if (!room || !this.isCurrent(this.generation) || this.admission === 0) return null
    const capability = Object.freeze(Object.create(null)) as RecoveryBindingCapability
    this.recoveryCapabilities.set(capability, {
      roomId,
      generation: this.generation,
      admission: this.admission,
      handle: room.handle,
      epoch: this.recoveryCapabilityEpoch,
      consumed: false
    })
    return capability
  }
  consumeRecoveryBindingCapabilities = (capabilities: readonly RecoveryBindingCapabilityUse[]) => {
    if (
      capabilities.length === 0 ||
      new Set(capabilities.map(({ capability }) => capability)).size !== capabilities.length
    ) {
      return false
    }
    const records = capabilities.map(
      ({ roomId, capability }) => [roomId, capability, this.recoveryCapabilities.get(capability)] as const
    )
    if (
      records.some(
        ([roomId, , record]) =>
          !record ||
          record.consumed ||
          record.roomId !== roomId ||
          record.generation !== this.generation ||
          record.admission !== this.admission ||
          record.epoch !== this.recoveryCapabilityEpoch ||
          ![...this.rooms.values()].some((room) => room.handle === record.handle)
      )
    ) {
      return false
    }
    records.forEach(([, , record]) => {
      record!.consumed = true
    })
    return true
  }
  requireRoomRecovery = async (roomId: string, domain: string) => {
    const generation = this.generation
    if (this.acceptingGeneration !== generation) throw new Error('Room transport recovery is not bound')
    await this.service.requireRoomRecovery(roomId, domain, this.admission)
    if (!this.isCurrent(generation)) throw new Error('Room transport recovery generation is no longer current')
  }
  rememberWorldRecovery = async (recovery: WorldTransportRecoveryFact) => {
    const generation = this.generation
    if (this.acceptingGeneration !== generation) throw new Error('Room transport recovery is not bound')
    if (!this.service.rememberWorldRecovery) throw new Error('Transport service does not retain World recovery')
    await this.service.rememberWorldRecovery(this.admission, recovery)
    if (!this.isCurrent(generation)) throw new Error('Room transport recovery generation is no longer current')
  }
  rememberRoomRecovery = async (recovery: RoomTransportRecovery['rooms'][number]) => {
    const generation = this.generation
    const room = this.rooms.get(recovery.roomId)
    if (!room || this.acceptingGeneration !== generation) {
      throw new Error('Room transport recovery is not bound to a current room')
    }
    await this.service.rememberRoomRecovery(recovery.roomId, room.handle, this.admission, recovery)
    if (!this.isCurrent(generation) || this.rooms.get(recovery.roomId)?.handle !== room.handle) {
      throw new Error('Room transport recovery generation is no longer current')
    }
  }
  activateIngress = async () => {
    const generation = this.generation
    if (!this.isCurrent(generation) || this.acceptingGeneration === generation) return
    const recoveryFrames = this.recoveryFrames
    for (const { roomId, sourcePeerId, payload } of recoveryFrames) {
      if (!this.isCurrent(generation)) return
      await this.deliverMessages(roomId, sourcePeerId, payload)
    }
    this.recoveryFrames = []
    // Keep cut-time ingress buffered until every recovered frame has passed the normal Wire
    // owner. New arrivals during an awaited drain append to this same queue and retain order.
    while (this.pendingIngress.length > 0) {
      const callback = this.pendingIngress[0]!
      const terminal = await callback()
      this.pendingIngress.shift()
      if (terminal === 'invalid') continue
      if (!this.isCurrent(generation)) return
    }
    if (this.isCurrent(generation)) {
      this.acceptingGeneration = generation
      this.recoveryCapabilityEpoch += 1
    }
  }
  join = (roomId: string) => {
    const generation = this.generation
    const existing = this.pendingJoins.get(roomId)
    if (existing && existing.generation === generation && existing.admission === this.admission) return existing.task

    const handle = nanoid()
    const admitted =
      this.acceptingGeneration === generation && !this.rooms.has(roomId)
        ? this.service.join(roomId, handle, this.admission)
        : null
    let pending!: PendingJoin
    const task = (async () => {
      await this.binding
      if (!this.isCurrent(generation)) throw new Error('Room transport generation is no longer current')
      pending.admission = this.admission
      const current = this.rooms.get(roomId)
      if (current) return
      const room = await (admitted ?? this.service.join(roomId, handle, pending.admission))
      if (!this.isCurrent(generation)) throw new Error('Room transport generation is no longer current')
      this.rooms.set(roomId, room)
    })()
    pending = { generation, admission: this.admission, task }
    this.pendingJoins.set(roomId, pending)
    const release = () => {
      if (this.pendingJoins.get(roomId) === pending) this.pendingJoins.delete(roomId)
    }
    void task.then(release, release)
    return task
  }
  leave = async (roomId: string, options?: { diagnosticOnly?: boolean }) => {
    const generation = this.generation
    const room = this.rooms.get(roomId)
    if (!room) return
    this.recoveryCapabilityEpoch += 1
    await this.binding
    if (!this.isCurrent(generation) || this.rooms.get(roomId)?.handle !== room.handle) return
    await this.service.leave(roomId, room.handle, options)
    if (this.isCurrent(generation) && this.rooms.get(roomId)?.handle === room.handle) this.rooms.delete(roomId)
  }
  retireRoomsForPreparation = async (roomIds: readonly string[]) => {
    const generation = this.generation
    const selected = [...new Set(roomIds)]
      .map((roomId) => ({ roomId, room: this.rooms.get(roomId) }))
      .filter((item): item is { roomId: string; room: TransportRoomState } => item.room !== undefined)
    await this.binding
    if (!this.isCurrent(generation)) throw new Error('Room transport generation is no longer current')
    let failed = false
    let firstFailure: unknown
    await Promise.all(
      selected.map(async ({ roomId, room }) => {
        try {
          if (!this.isCurrent(generation) || this.rooms.get(roomId)?.handle !== room.handle) {
            throw new Error('Room transport retirement generation is no longer current')
          }
          await this.service.retireRoomForPreparation(roomId, room.handle)
          if (this.isCurrent(generation) && this.rooms.get(roomId)?.handle === room.handle) this.rooms.delete(roomId)
        } catch (error) {
          if (!failed) {
            failed = true
            firstFailure = error
          }
        }
      })
    )
    if (failed) throw firstFailure
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
  onMessage = (callback: (roomId: string, sourcePeerId: string, payload: string) => unknown) => {
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
    this.invalidateOwner(this.generation)
    this.generation += 1
    this.acceptingGeneration = 0
    this.recoveryCapabilityEpoch += 1
    this.pendingJoins.clear()
    this.pendingIngress = []
    this.rooms.clear()
    this.worldRecoveryState = { members: [], presences: [] }
    this.roomRecoveryState = { rooms: [] }
    this.recoveryFrames = []
    this.messages.clear()
    this.joins.clear()
    this.leaves.clear()
    this.closes.clear()
    this.errors.clear()
  }
}
