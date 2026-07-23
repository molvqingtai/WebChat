import type { RuntimeCoordinator, RuntimeServer, RuntimeSnapshot } from '@/runtime/Contract'
import type { HostPhase } from '@/runtime/Contract'
import poll from '@/utils/poll'

export interface ClientLeaseOptions {
  coordinator: RuntimeCoordinator
  server: RuntimeServer
  pageId: string
  domain: string
  startupTimeoutMs?: number
  startupRetryIntervalMs?: number
  watchdogIntervalMs?: number
  logError?: (error: unknown) => void
}

export class ClientLease {
  private snapshotValue: RuntimeSnapshot | null = null
  private coordinatorGeneration = 0
  private ready = false
  private watchdog: ReturnType<typeof globalThis.setInterval> | null = null
  private lifecycle: AbortController | null = null
  private recovering: { lifecycle: AbortController; task: Promise<void> } | null = null
  private readonly readyCallbacks = new Set<() => void>()
  private readonly hostPhaseCallbacks = new Set<(phase: HostPhase) => void>()
  private hostPhase: HostPhase = 'none'
  private readonly startupOptions
  private readonly watchdogIntervalMs
  private readonly logError

  constructor(private readonly options: ClientLeaseOptions) {
    this.startupOptions = {
      timeoutMs: options.startupTimeoutMs ?? 15000,
      intervalMs: options.startupRetryIntervalMs ?? 500
    }
    this.watchdogIntervalMs = options.watchdogIntervalMs ?? 5000
    this.logError = options.logError ?? ((error) => console.error('[WebChat] Runtime recovery failed:', error))
  }

  whenReady(callback: () => void) {
    this.readyCallbacks.add(callback)
    if (this.ready) callback()
    return () => this.readyCallbacks.delete(callback)
  }

  whenHostPhase(callback: (phase: HostPhase) => void) {
    this.hostPhaseCallbacks.add(callback)
    callback(this.hostPhase)
    return () => this.hostPhaseCallbacks.delete(callback)
  }

  private lease() {
    return { domain: this.options.domain, pageId: this.options.pageId }
  }

  private isCurrent(lifecycle: AbortController) {
    return this.lifecycle === lifecycle && !lifecycle.signal.aborted
  }

  private setHostPhase(phase: HostPhase) {
    this.hostPhase = phase
    if (this.snapshotValue) this.snapshotValue = { ...this.snapshotValue, hostPhase: phase }
    this.hostPhaseCallbacks.forEach((callback) => callback(phase))
  }

  private releaseLease() {
    const lease = this.lease()
    return Promise.allSettled([
      Promise.resolve().then(() => this.options.server.detachPage(lease)),
      Promise.resolve().then(() => this.options.coordinator.unregisterPage(lease))
    ]).then(() => {})
  }

  private async registerPage(lifecycle: AbortController) {
    lifecycle.signal.throwIfAborted()
    const status = await this.options.coordinator.registerPage(this.lease())
    if (!this.isCurrent(lifecycle)) {
      await this.releaseLease()
      lifecycle.signal.throwIfAborted()
    }
    return status
  }

  private async attach(lifecycle: AbortController) {
    const status = await poll(
      async () => {
        const nextStatus = await this.registerPage(lifecycle)
        if (nextStatus.phase !== 'ready') throw new Error(`Runtime host unavailable: ${nextStatus.phase}`)
        return nextStatus
      },
      { ...this.startupOptions, signal: lifecycle.signal }
    )
    const snapshot = await poll(
      async () => {
        const nextSnapshot = await this.options.server.attachPage(this.lease())
        if (!this.isCurrent(lifecycle)) {
          await this.releaseLease()
          lifecycle.signal.throwIfAborted()
        }
        return nextSnapshot
      },
      { ...this.startupOptions, signal: lifecycle.signal }
    )
    lifecycle.signal.throwIfAborted()
    if (!this.isCurrent(lifecycle)) throw new DOMException('Runtime lease superseded', 'AbortError')
    this.snapshotValue = snapshot
    this.setHostPhase(snapshot.hostPhase)
    this.coordinatorGeneration = status.generation
    this.ready = true
    this.readyCallbacks.forEach((callback) => callback())
    return snapshot
  }

  /** Recovery is single-flight per lifecycle generation. */
  private recover(lifecycle: AbortController) {
    if (!this.isCurrent(lifecycle)) return Promise.resolve()
    if (this.recovering?.lifecycle === lifecycle) return this.recovering.task
    this.setHostPhase('connecting')
    const task = this.attach(lifecycle)
      .then(() => {})
      .catch((error) => {
        if (!this.isCurrent(lifecycle)) return
        this.setHostPhase('unavailable')
        this.logError(error)
      })
    this.recovering = { lifecycle, task }
    void task.finally(() => {
      if (this.recovering?.task === task) this.recovering = null
    })
    return task
  }

  async checkNow() {
    const lifecycle = this.lifecycle
    if (!lifecycle || !this.isCurrent(lifecycle)) return
    try {
      const status = await this.registerPage(lifecycle)
      lifecycle.signal.throwIfAborted()
      if (status.phase !== 'ready') throw new Error(`Runtime host unavailable: ${status.phase}`)
      const nextSnapshot = await this.options.server.getSnapshot()
      lifecycle.signal.throwIfAborted()
      if (!this.isCurrent(lifecycle)) return
      const lease = nextSnapshot.domains.find((item) => item.domain === this.options.domain)
      const replaced =
        status.generation !== this.coordinatorGeneration ||
        nextSnapshot.hostId !== this.snapshotValue?.hostId ||
        !lease?.pageIds.includes(this.options.pageId)
      if (replaced) {
        this.ready = false
        await this.recover(lifecycle)
        return
      }
      this.snapshotValue = nextSnapshot
      this.setHostPhase(nextSnapshot.hostPhase)
    } catch {
      if (!this.isCurrent(lifecycle)) return
      this.ready = false
      await this.recover(lifecycle)
    }
  }

  private startWatchdog(lifecycle: AbortController) {
    if (this.watchdog || !this.isCurrent(lifecycle)) return
    this.watchdog = globalThis.setInterval(() => {
      if (this.isCurrent(lifecycle)) void this.checkNow()
    }, this.watchdogIntervalMs)
  }

  async init(): Promise<RuntimeSnapshot | null> {
    this.lifecycle?.abort(new DOMException('Runtime lease superseded', 'AbortError'))
    const lifecycle = new AbortController()
    this.lifecycle = lifecycle
    this.ready = false
    try {
      const snapshot = await this.attach(lifecycle)
      if (!this.isCurrent(lifecycle)) return null
      this.startWatchdog(lifecycle)
      return snapshot
    } catch (error) {
      if (lifecycle.signal.aborted) return null
      throw error
    }
  }

  detach() {
    this.lifecycle?.abort(new DOMException('Runtime lease detached', 'AbortError'))
    this.lifecycle = null
    this.ready = false
    this.setHostPhase('none')
    if (this.watchdog) {
      globalThis.clearInterval(this.watchdog)
      this.watchdog = null
    }
    void this.releaseLease()
  }

  snapshot(): RuntimeSnapshot {
    if (!this.snapshotValue) throw new Error('Runtime client not initialized')
    return this.snapshotValue
  }
}
