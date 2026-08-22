import EventHub from '@resreq/event-hub'
import type { WorldState } from '@/domain/externs/WorldRoom'
import type { ChatUser, ChatSite, WorldRoomMessage } from '@/protocol'
import type { RuntimeSnapshot } from '@/runtime/Contract'

interface Contribution {
  sourcePeerId: string
  site: ChatSite
  user: ChatUser
  order: number
}

/**
 * Page-local World projection owner. It holds no remote Runtime callback: the sole
 * document-local drain applies each pulled current projection here under one owner.
 */
export class WorldRoom extends EventHub {
  private readonly contributions = new Map<string, Contribution>()
  private nextOrder = 0

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

  /** Idempotent full-projection application; safe to invoke repeatedly under the drain owner. */
  applyWorld(projection: RuntimeSnapshot) {
    const activeKeys = new Set<string>()
    projection.world.presences.forEach(({ sourcePeerId, presence }) =>
      this.replaceSource(sourcePeerId, presence, activeKeys)
    )
    if (projection.world.localPresence) {
      this.replaceSource(projection.peerId, projection.world.localPresence, activeKeys)
    }
    this.contributions.forEach((_contribution, key) => {
      if (!activeKeys.has(key)) this.contributions.delete(key)
    })
    this.emitState()
  }

  async getState() {
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

const contributionKey = (sourcePeerId: string, origin: string) => `${sourcePeerId}\u0000${origin}`
