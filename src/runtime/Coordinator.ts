import type {
  HostPhase,
  RuntimeHostStatus,
  RuntimePageRegistration,
  RuntimeSnapshot,
  RuntimeTab
} from '@/runtime/Contract'
import { canonicalNavigationUrl, isEligibleContentUrl, isSameNavigation } from '@/service/adapter/runtime/Navigation'

export const COORDINATOR_HEALTH_INTERVAL_MS = 5000
export const COORDINATOR_RPC_TIMEOUT_MS = 5000
export const COORDINATOR_SESSION_KEY = 'WEB_CHAT_RUNTIME_COORDINATOR_V3:state'

interface PersistedState {
  generation: number
  hostId?: string
  tabs: PhysicalTab[]
}

interface PhysicalTab {
  tabId: number
  domain: string
  pageId: string
  url: string
}

interface PendingRegistration {
  pageId: string
  epoch: number
  task: Promise<RuntimePageRegistration>
}

interface PendingRelease {
  domain: string
  pageId: string
  task: Promise<void>
}

export interface SessionStorage {
  get: (key: string) => Promise<Record<string, unknown>>
  set: (items: Record<string, unknown>) => Promise<void>
}

export interface HostEnsureResult {
  phase: HostPhase
  created: boolean
}

export interface CoordinatorTabsApi {
  get: (tabId: number) => Promise<RuntimeTab>
}

export interface CoordinatorOptions {
  storage: SessionStorage
  tabs: CoordinatorTabsApi
  ensureHostDocument: () => Promise<HostEnsureResult>
  probeHost: (startup: boolean) => Promise<{ hostId: string; phase: HostPhase }>
  destroyHostDocument: () => Promise<void>
  attachPage: (lease: { domain: string; pageId: string }) => Promise<RuntimeSnapshot>
  detachPage: (lease: { domain: string; pageId: string }) => Promise<void>
}

const withDeadline = <T>(task: Promise<T>, timeoutMs: number, message: string) =>
  new Promise<T>((resolve, reject) => {
    const timer = globalThis.setTimeout(() => reject(new Error(message)), timeoutMs)
    task.then(resolve, reject).finally(() => globalThis.clearTimeout(timer))
  })

export class Coordinator {
  private readonly tabs = new Map<number, PhysicalTab>()
  private readonly epochs = new Map<number, number>()
  private readonly pending = new Map<number, PendingRegistration>()
  private readonly releases = new Map<number, PendingRelease>()
  private creating: Promise<RuntimeHostStatus> | null = null
  private restoration: Promise<void> | null = null
  private persistTail: Promise<void> = Promise.resolve()
  private healthTimer: ReturnType<typeof globalThis.setInterval> | null = null
  private hostId: string | null = null
  private hostPhase: HostPhase = 'none'
  private generation = 0

  constructor(private readonly options: CoordinatorOptions) {}

  private currentTabs() {
    return [...this.tabs.values()].sort((left, right) => left.tabId - right.tabId)
  }

  private async persist() {
    const state: PersistedState = {
      generation: this.generation,
      ...(this.hostId ? { hostId: this.hostId } : {}),
      tabs: this.currentTabs()
    }
    this.persistTail = this.persistTail
      .catch(() => {})
      .then(() => this.options.storage.set({ [COORDINATOR_SESSION_KEY]: state }))
    await this.persistTail
  }

  private maintainHost() {
    if (this.healthTimer || this.tabs.size === 0) return
    this.healthTimer = globalThis.setInterval(() => void this.reconcile(), COORDINATOR_HEALTH_INTERVAL_MS)
  }

  private stopMaintainingHost() {
    if (this.tabs.size > 0 || !this.healthTimer) return
    globalThis.clearInterval(this.healthTimer)
    this.healthTimer = null
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

  private async currentNavigation(binding: PhysicalTab) {
    try {
      const tab = await this.options.tabs.get(binding.tabId)
      const url = typeof tab.url === 'string' ? canonicalNavigationUrl(tab.url) : null
      return url && isEligibleContentUrl(url) && new URL(url).origin === binding.domain ? url : null
    } catch {
      return null
    }
  }

  private async isCurrentTab(binding: PhysicalTab) {
    const url = await this.currentNavigation(binding)
    return url !== null && isSameNavigation(url, binding.url)
  }

  private async reconcileOneTab(binding: PhysicalTab) {
    try {
      const url = await this.currentNavigation(binding)
      if (!url) {
        await this.removeCurrentTab(binding.tabId)
        return
      }
      if (url === binding.url) return
      const current = this.tabs.get(binding.tabId)
      if (current?.pageId !== binding.pageId) return
      this.tabs.set(binding.tabId, { ...current, url })
      await this.persist()
    } catch {
      // best-effort reconciliation: a failed tab must not block the remaining tabs
    }
  }

  private async reconcileTabs() {
    await Promise.all(this.currentTabs().map((binding) => this.reconcileOneTab(binding)))
  }

  private async rebuildTabs() {
    await this.reconcileTabs()
    await Promise.all(
      this.currentTabs().map((binding) =>
        withDeadline(
          this.options.attachPage({ domain: binding.domain, pageId: binding.pageId }),
          COORDINATOR_RPC_TIMEOUT_MS,
          'Runtime page attachment timed out'
        ).catch(() => {
          // best-effort attachment: a failed tab must not block the remaining tabs
        })
      )
    )
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
          if (result.created && this.hostPhase === 'ready') await this.rebuildTabs()
          return { phase: this.hostPhase, generation: this.generation }
        })
        .finally(() => {
          this.creating = null
        })
    }
    return this.creating
  }

  private nextEpoch(tabId: number) {
    const next = (this.epochs.get(tabId) ?? 0) + 1
    if (!Number.isSafeInteger(next)) throw new Error('tab generation exhausted')
    this.epochs.set(tabId, next)
    return next
  }

  private async validateRegistration(payload: {
    domain: string
    pageId: string
    tab?: RuntimeTab
  }): Promise<PhysicalTab> {
    const tabId = payload.tab?.id
    const claimedUrl = payload.tab?.url
    if (!Number.isSafeInteger(tabId) || tabId! < 0 || typeof claimedUrl !== 'string') {
      throw new Error('Trusted browser tab metadata is required')
    }
    const current = await this.options.tabs.get(tabId!)
    if (current.id !== undefined && current.id !== tabId) throw new Error('Browser tab identity changed')
    if (
      typeof current.url !== 'string' ||
      !isEligibleContentUrl(current.url) ||
      !isSameNavigation(current.url, claimedUrl)
    ) {
      throw new Error('Browser tab navigation is no longer eligible')
    }
    const canonicalUrl = canonicalNavigationUrl(current.url)
    if (!canonicalUrl || new URL(canonicalUrl).origin !== payload.domain) {
      throw new Error('Runtime domain does not match the trusted browser tab')
    }
    return { tabId: tabId!, domain: payload.domain, pageId: payload.pageId, url: canonicalUrl }
  }

  private async attachRegistration(binding: PhysicalTab, epoch: number): Promise<RuntimePageRegistration> {
    const status = await this.ensureHost()
    if (status.phase !== 'ready') throw new Error(`Runtime host unavailable: ${status.phase}`)
    const lease = { domain: binding.domain, pageId: binding.pageId }
    const attachment = this.options.attachPage(lease)
    let snapshot: RuntimeSnapshot
    try {
      snapshot = await withDeadline(attachment, COORDINATOR_RPC_TIMEOUT_MS, 'Runtime page attachment timed out')
    } catch (error) {
      void attachment.then(
        async () => {
          const current = this.tabs.get(binding.tabId)
          if (current?.pageId !== binding.pageId) await this.options.detachPage(lease)
        },
        () => {}
      )
      throw error
    }
    if (this.epochs.get(binding.tabId) !== epoch || !(await this.isCurrentTab(binding))) {
      const current = this.tabs.get(binding.tabId)
      if (current?.pageId !== binding.pageId) await this.options.detachPage(lease)
      throw new Error('Browser tab registration was superseded')
    }

    const previous = this.tabs.get(binding.tabId)
    if (previous && (previous.domain !== binding.domain || previous.pageId !== binding.pageId)) {
      try {
        await this.releaseBinding(previous)
      } catch (error) {
        await Promise.allSettled([this.options.detachPage(lease)])
        throw error
      }
      if (this.epochs.get(binding.tabId) !== epoch || !(await this.isCurrentTab(binding))) {
        await this.options.detachPage(lease)
        throw new Error('Browser tab registration was superseded')
      }
    }
    this.tabs.set(binding.tabId, binding)
    await this.persist()
    this.maintainHost()
    return { ...status, snapshot }
  }

  async registerPage(payload: { domain: string; pageId: string; tab?: RuntimeTab }): Promise<RuntimePageRegistration> {
    await this.restore()
    const binding = await this.validateRegistration(payload)
    const current = this.pending.get(binding.tabId)
    if (current?.pageId === binding.pageId) return current.task
    const epoch = this.nextEpoch(binding.tabId)
    const task = this.attachRegistration(binding, epoch)
    this.pending.set(binding.tabId, { pageId: binding.pageId, epoch, task })
    void task
      .finally(() => {
        if (this.pending.get(binding.tabId)?.epoch === epoch) this.pending.delete(binding.tabId)
      })
      .catch(() => {})
    return task
  }

  private releaseBinding(binding: PhysicalTab): Promise<void> {
    const current = this.releases.get(binding.tabId)
    if (current?.domain === binding.domain && current.pageId === binding.pageId) return current.task

    const task = this.options.detachPage({ domain: binding.domain, pageId: binding.pageId })
    this.releases.set(binding.tabId, { domain: binding.domain, pageId: binding.pageId, task })
    void task
      .finally(() => {
        if (this.releases.get(binding.tabId)?.task === task) this.releases.delete(binding.tabId)
      })
      .catch(() => {})
    return task
  }

  private async removeCurrentTab(tabId: number): Promise<void> {
    const binding = this.tabs.get(tabId)
    const release = this.releases.get(tabId)
    if (binding && release?.domain === binding.domain && release.pageId === binding.pageId) return release.task

    const epoch = this.nextEpoch(tabId)
    this.pending.delete(tabId)
    if (!binding) return
    await this.releaseBinding(binding)
    const current = this.tabs.get(tabId)
    if (this.epochs.get(tabId) !== epoch || current?.domain !== binding.domain || current.pageId !== binding.pageId) {
      return
    }
    this.tabs.delete(tabId)
    await this.persist()
    this.stopMaintainingHost()
  }

  async removeTab(tabId: number): Promise<void> {
    await this.restore()
    await this.removeCurrentTab(tabId)
  }

  async updateTab(tabId: number, url: string): Promise<void> {
    await this.restore()
    const binding = this.tabs.get(tabId)
    if (!binding) return
    const canonicalUrl = canonicalNavigationUrl(url)
    if (!canonicalUrl || !isEligibleContentUrl(url) || new URL(canonicalUrl).origin !== binding.domain) {
      await this.removeTab(tabId)
      return
    }
    if (binding.url === canonicalUrl) return
    this.tabs.set(tabId, { ...binding, url: canonicalUrl })
    await this.persist()
  }

  watchHost() {
    this.maintainHost()
  }

  private async restoreState(): Promise<void> {
    const stored = (await this.options.storage.get(COORDINATOR_SESSION_KEY))[COORDINATOR_SESSION_KEY]
    if (stored && typeof stored === 'object' && !Array.isArray(stored)) {
      const candidate = stored as Partial<PersistedState>
      this.generation = Number.isSafeInteger(candidate.generation) ? candidate.generation! : 0
      this.hostId = typeof candidate.hostId === 'string' && candidate.hostId ? candidate.hostId : null
      if (Array.isArray(candidate.tabs)) {
        candidate.tabs.forEach((tab) => {
          if (
            tab &&
            Number.isSafeInteger(tab.tabId) &&
            tab.tabId >= 0 &&
            typeof tab.domain === 'string' &&
            typeof tab.pageId === 'string' &&
            typeof tab.url === 'string'
          ) {
            this.tabs.set(tab.tabId, tab)
          }
        })
      }
    }
    await this.persist()
    if (this.tabs.size > 0) {
      this.maintainHost()
      const status = await this.ensureHost()
      if (status.phase === 'ready') await this.reconcileTabs()
    }
  }

  restore(): Promise<void> {
    if (!this.restoration) {
      this.restoration = this.restoreState().catch((error) => {
        this.restoration = null
        throw error
      })
    }
    return this.restoration
  }

  async reconcile(): Promise<void> {
    await this.restore()
    if (this.tabs.size > 0) {
      const status = await this.ensureHost()
      if (status.phase === 'ready') await this.reconcileTabs()
    }
  }

  snapshotForTest() {
    return {
      generation: this.generation,
      tabs: this.currentTabs(),
      hostPhase: this.hostPhase,
      hostId: this.hostId
    }
  }
}
