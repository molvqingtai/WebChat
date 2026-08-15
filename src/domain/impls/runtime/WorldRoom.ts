import EventHub from '@resreq/event-hub'
import type { WorldState } from '@/domain/externs/WorldRoom'
import type { ChatUser, ChatSite, WorldRoomMessage } from '@/protocol'
import type { RuntimeServer, RuntimeSnapshot, WorldPresenceEvent } from '@/runtime/Contract'

interface Contribution {
  sourcePeerId: string
  site: ChatSite
  user: ChatUser
  order: number
}

export interface WorldRoomDependencies {
  server: RuntimeServer
  pageId: string
  getSnapshot: () => RuntimeSnapshot
  whenReady: (callback: () => void) => () => void
}

const contributionKey = (sourcePeerId: string, origin: string) => `${sourcePeerId}\u0000${origin}`

export class WorldRoom extends EventHub {
  private readonly contributions = new Map<string, Contribution>()
  private nextOrder = 0
  private attachmentTask: Promise<void> = Promise.resolve()

  constructor(private readonly dependencies: WorldRoomDependencies) {
    super()
    dependencies.whenReady(() => {
      const attachedHostId = dependencies.getSnapshot().hostId
      const attachCurrentHost = () => this.attachRuntime(attachedHostId)
      // The settled tail serializes both outcomes; this attachment's rejection is transferred
      // exactly once to the room error owner and then becomes the next settled queue token.
      this.attachmentTask = this.attachmentTask
        .then(attachCurrentHost, attachCurrentHost)
        .then(undefined, (error) => this.emit('error', error as Error))
    })
  }

  private replaceSource(sourcePeerId: string, presence: WorldRoomMessage, activeKeys?: Set<string>) {
    const nextOrigins = new Set(presence.sites.map((site) => site.origin))
    this.contributions.forEach((contribution, key) => {
      if (contribution.sourcePeerId === sourcePeerId && !nextOrigins.has(contribution.site.origin)) {
        this.contributions.delete(key)
      }
    })

    presence.sites.forEach((site) => {
      const key = contributionKey(sourcePeerId, site.origin)
      activeKeys?.add(key)
      const current = this.contributions.get(key)
      this.contributions.set(key, {
        sourcePeerId,
        site,
        user: presence.user,
        order: current?.order ?? this.nextOrder++
      })
    })
  }

  private state(): WorldState {
    const ordered = [...this.contributions.values()].toSorted((left, right) => left.order - right.order)
    const groups = ordered.reduce<Map<string, ChatSite & { users: ChatUser[] }>>((acc, { site, user }) => {
      const current = acc.get(site.origin)
      if (current) current.users.push(user)
      else acc.set(site.origin, { ...site, users: [user] })
      return acc
    }, new Map())
    return [...groups.values()]
  }

  private emitState() {
    this.emit('state', this.state())
  }

  private applyPresence(event: WorldPresenceEvent) {
    if (event.presence) this.replaceSource(event.sourcePeerId, event.presence.presence)
    else {
      this.contributions.forEach((contribution, key) => {
        if (contribution.sourcePeerId === event.sourcePeerId) this.contributions.delete(key)
      })
    }
    this.emitState()
  }

  private applySnapshot(snapshot: RuntimeSnapshot) {
    const activeKeys = new Set<string>()
    snapshot.world.presences.forEach(({ sourcePeerId, presence }) =>
      this.replaceSource(sourcePeerId, presence, activeKeys)
    )
    if (snapshot.world.localPresence) {
      this.replaceSource(snapshot.peerId, snapshot.world.localPresence, activeKeys)
    }
    this.contributions.forEach((_contribution, key) => {
      if (!activeKeys.has(key)) this.contributions.delete(key)
    })
    this.emitState()
  }

  private async attachRuntime(attachedHostId: string) {
    const bufferedEvents: WorldPresenceEvent[] = []
    const isCurrentHost = () => this.dependencies.getSnapshot().hostId === attachedHostId
    let isLive = false
    let isValidAttachment = true

    await this.dependencies.server.onWorldPresence({ pageId: this.dependencies.pageId }, (event) => {
      if (!isValidAttachment || !isCurrentHost()) return
      if (isLive) this.applyPresence(event)
      else bufferedEvents.push(event)
    })
    const snapshot = await this.dependencies.server.getSnapshot()
    if (!isCurrentHost() || snapshot.hostId !== attachedHostId) {
      isValidAttachment = false
      return
    }

    this.applySnapshot(snapshot)
    bufferedEvents.forEach((event) => this.applyPresence(event))
    bufferedEvents.length = 0
    isLive = true
  }

  async getState() {
    await this.attachmentTask
    return this.state()
  }

  onState(callback: (state: WorldState) => void) {
    this.on('state', callback)
    return () => this.off('state', callback)
  }

  onError(callback: (error: Error) => void) {
    this.on('error', callback)
    return () => this.off('error', callback)
  }
}
