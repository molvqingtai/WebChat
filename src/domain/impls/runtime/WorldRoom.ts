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
      this.attachmentTask = this.attachmentTask.catch(() => {}).then(() => this.attachRuntime(attachedHostId))
      void this.attachmentTask.catch((error) => this.emit('error', error as Error))
    })
  }

  private replaceSource(sourcePeerId: string, presence: WorldRoomMessage, activeKeys?: Set<string>) {
    const nextOrigins = new Set(presence.sites.map((site) => site.origin))
    // functional-loop: owner-commit — per-item Map deletion during live iteration has no bulk primitive
    for (const [key, contribution] of this.contributions) {
      if (contribution.sourcePeerId === sourcePeerId && !nextOrigins.has(contribution.site.origin)) {
        this.contributions.delete(key)
      }
    }

    // functional-loop: owner-commit — ordered per-site contribution writes into the live map
    for (const site of presence.sites) {
      const key = contributionKey(sourcePeerId, site.origin)
      activeKeys?.add(key)
      const current = this.contributions.get(key)
      this.contributions.set(key, {
        sourcePeerId,
        site,
        user: presence.user,
        order: current?.order ?? this.nextOrder++
      })
    }
  }

  private state(): WorldState {
    const ordered = [...this.contributions.values()].toSorted((left, right) => left.order - right.order)
    const groups = ordered.reduce<Map<string, ChatSite & { users: ChatUser[] }>>((acc, { site, user }) => {
      const current = acc.get(site.origin)
      return current
        ? acc.set(site.origin, { ...current, users: [...current.users, user] })
        : acc.set(site.origin, { ...site, users: [user] })
    }, new Map())
    return [...groups.values()]
  }

  private emitState() {
    this.emit('state', this.state())
  }

  private applyPresence(event: WorldPresenceEvent) {
    if (event.presence) this.replaceSource(event.sourcePeerId, event.presence.presence)
    else {
      // functional-loop: owner-commit — per-item Map deletion during live iteration has no bulk primitive
      for (const [key, contribution] of this.contributions) {
        if (contribution.sourcePeerId === event.sourcePeerId) this.contributions.delete(key)
      }
    }
    this.emitState()
  }

  private applySnapshot(snapshot: RuntimeSnapshot) {
    const activeKeys = new Set<string>()
    // functional-loop: owner-commit — ordered per-presence replacement commits with no bulk primitive
    for (const { sourcePeerId, presence } of snapshot.world.presences) {
      this.replaceSource(sourcePeerId, presence, activeKeys)
    }
    if (snapshot.world.localPresence) {
      this.replaceSource(snapshot.peerId, snapshot.world.localPresence, activeKeys)
    }
    // functional-loop: owner-commit — per-item Map deletion during live iteration has no bulk primitive
    for (const key of this.contributions.keys()) {
      if (!activeKeys.has(key)) this.contributions.delete(key)
    }
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
    // functional-loop: owner-commit — ordered per-event presence application with no bulk primitive
    for (const event of bufferedEvents) {
      this.applyPresence(event)
    }
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
