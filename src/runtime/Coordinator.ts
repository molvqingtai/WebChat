import type { HostPhase, RuntimeHostStatus } from '@/runtime/Contract'
import type { Clock } from '@/domain/runtime/externs/Clock'

export const COORDINATOR_HEALTH_INTERVAL_MS = 5000
export const COORDINATOR_LEASE_TTL_MS = 15000
export const COORDINATOR_SESSION_KEY = 'WEB_CHAT_RUNTIME_COORDINATOR_V2:state'

interface PersistedState {
  generation: number
  hostId?: string
  pages: { domain: string; pageId: string; lastSeenAt: number }[]
}

interface PhysicalPage {
  domain: string
  pageId: string
  lastSeenAt: number
}

export interface SessionStorage {
  get: (key: string) => Promise<Record<string, unknown>>
  set: (items: Record<string, unknown>) => Promise<void>
}

export interface HostEnsureResult {
  phase: HostPhase
  created: boolean
}

export interface CoordinatorOptions {
  clock: Clock
  storage: SessionStorage
  ensureHostDocument: () => Promise<HostEnsureResult>
  probeHost: (startup: boolean) => Promise<{ hostId: string; phase: HostPhase }>
  destroyHostDocument: () => Promise<void>
  detachPage: (lease: { domain: string; pageId: string }) => Promise<void>
}

export class Coordinator {
  private readonly pages = new Map<string, PhysicalPage>()
  private creating: Promise<RuntimeHostStatus> | null = null
  private persistTail: Promise<void> = Promise.resolve()
  private healthTimer: ReturnType<typeof globalThis.setInterval> | null = null
  private hostId: string | null = null
  private hostPhase: HostPhase = 'none'
  private generation = 0

  constructor(private readonly options: CoordinatorOptions) {}

  private onlinePages() {
    return [...this.pages.values()]
  }

  private async persist() {
    const state: PersistedState = {
      generation: this.generation,
      ...(this.hostId ? { hostId: this.hostId } : {}),
      pages: this.onlinePages()
    }
    this.persistTail = this.persistTail
      .catch(() => {})
      .then(() => this.options.storage.set({ [COORDINATOR_SESSION_KEY]: state }))
    await this.persistTail
  }

  private maintainHost() {
    if (this.healthTimer || this.pages.size === 0) return
    this.healthTimer = globalThis.setInterval(() => void this.sweep(), COORDINATOR_HEALTH_INTERVAL_MS)
  }

  private stopMaintainingHost() {
    if (this.pages.size > 0 || !this.healthTimer) return
    globalThis.clearInterval(this.healthTimer)
    this.healthTimer = null
  }

  private async sweep() {
    const now = this.options.clock.now()
    const expired = this.onlinePages().filter((page) => now - page.lastSeenAt >= COORDINATOR_LEASE_TTL_MS)
    expired.forEach(({ pageId }) => this.pages.delete(pageId))
    await Promise.allSettled(expired.map(({ domain, pageId }) => this.options.detachPage({ domain, pageId })))
    await this.persist()
    if (this.pages.size > 0) await this.ensureHost()
    this.stopMaintainingHost()
  }

  private async requireHealthyRuntime(startup: boolean) {
    const probe = await this.options.probeHost(startup)
    if (probe.phase !== 'ready') throw new Error(`Runtime provider is ${probe.phase}`)
    return probe
  }

  private markDestroyed() {
    this.hostPhase = 'none'
    this.hostId = null
  }

  private async establishHost(): Promise<HostEnsureResult> {
    let result = await this.options.ensureHostDocument()
    if (result.phase !== 'ready') {
      this.hostId = null
      return result
    }

    if (result.created && this.generation > 0) this.markDestroyed()

    try {
      const probe = await this.requireHealthyRuntime(result.created)
      const identityChanged = this.hostId !== null && this.hostId !== probe.hostId
      if (identityChanged) this.markDestroyed()
      this.hostId = probe.hostId
      return { ...result, created: result.created || identityChanged }
    } catch (error) {
      if (result.created) throw error
      this.markDestroyed()
      await this.options.destroyHostDocument()
      result = await this.options.ensureHostDocument()
      if (result.phase !== 'ready') {
        this.hostId = null
        return result
      }
      const probe = await this.requireHealthyRuntime(true)
      this.hostId = probe.hostId
      return { phase: 'ready', created: true }
    }
  }

  async ensureHost(): Promise<RuntimeHostStatus> {
    if (!this.creating) {
      this.hostPhase = 'connecting'
      this.creating = this.establishHost()
        .catch((error) => {
          console.error('[WebChat] Runtime host creation failed:', error)
          return { phase: 'unavailable', created: false } as HostEnsureResult
        })
        .then(async (result) => {
          if (result.phase === 'ready') {
            this.hostPhase = 'ready'
            this.generation = result.created ? this.generation + 1 : Math.max(1, this.generation)
            if (!Number.isSafeInteger(this.generation)) {
              this.hostPhase = 'unavailable'
              throw new Error('host generation exhausted')
            }
          } else {
            this.hostPhase = 'unavailable'
          }
          await this.persist()
          return { phase: this.hostPhase, generation: this.generation }
        })
        .finally(() => {
          this.creating = null
        })
    }
    return this.creating
  }

  async registerPage(lease: { domain: string; pageId: string }): Promise<RuntimeHostStatus> {
    this.pages.set(lease.pageId, { ...lease, lastSeenAt: this.options.clock.now() })
    await this.persist()
    this.maintainHost()
    return this.ensureHost()
  }

  async unregisterPage(lease: { domain: string; pageId: string }): Promise<void> {
    this.pages.delete(lease.pageId)
    await this.persist()
    this.stopMaintainingHost()
  }

  watchHost() {
    this.maintainHost()
  }

  async restore(): Promise<void> {
    const stored = (await this.options.storage.get(COORDINATOR_SESSION_KEY))[COORDINATOR_SESSION_KEY]
    if (stored && typeof stored === 'object' && !Array.isArray(stored)) {
      const candidate = stored as Partial<PersistedState>
      this.generation = Number.isSafeInteger(candidate.generation) ? candidate.generation! : 0
      this.hostId = typeof candidate.hostId === 'string' && candidate.hostId ? candidate.hostId : null
      if (Array.isArray(candidate.pages)) {
        candidate.pages.forEach((page) => {
          if (
            page &&
            typeof page.domain === 'string' &&
            typeof page.pageId === 'string' &&
            Number.isFinite(page.lastSeenAt) &&
            this.options.clock.now() - page.lastSeenAt < COORDINATOR_LEASE_TTL_MS
          ) {
            this.pages.set(page.pageId, page)
          }
        })
      }
    }
    await this.persist()
    if (this.pages.size > 0) {
      this.maintainHost()
      await this.ensureHost()
    }
  }

  snapshotForTest() {
    return {
      generation: this.generation,
      pages: this.onlinePages(),
      hostPhase: this.hostPhase,
      hostId: this.hostId
    }
  }
}
