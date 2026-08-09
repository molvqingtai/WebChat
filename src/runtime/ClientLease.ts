import type { HostPhase, RuntimeCoordinator, RuntimePageRegistration, RuntimeSnapshot } from '@/runtime/Contract'

export const CLIENT_LEASE_RPC_TIMEOUT_MS = 5000

export interface ClientLeaseOptions {
  coordinator: RuntimeCoordinator
  pageId: string
  domain: string
  startupTimeoutMs?: number
  startupRetryIntervalMs?: number
  watchdogIntervalMs?: number
  logError?: (error: unknown) => void
}

const wait = (milliseconds: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      globalThis.clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
      reject(signal.reason ?? new DOMException('Runtime lease aborted', 'AbortError'))
    }
    const timer = globalThis.setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, milliseconds)
    signal.addEventListener('abort', onAbort, { once: true })
    if (signal.aborted) onAbort()
  })

const withDeadline = <T>(task: Promise<T>, milliseconds: number, signal: AbortSignal) =>
  new Promise<T>((resolve, reject) => {
    let settled = false
    const finish = (callback: () => void) => {
      if (settled) return
      settled = true
      globalThis.clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
      callback()
    }
    const onAbort = () => finish(() => reject(signal.reason ?? new DOMException('Runtime lease aborted', 'AbortError')))
    const timer = globalThis.setTimeout(
      () => finish(() => reject(new Error('Runtime control-plane request timed out'))),
      milliseconds
    )
    signal.addEventListener('abort', onAbort, { once: true })
    task.then(
      (value) => finish(() => resolve(value)),
      (error) => finish(() => reject(error))
    )
    if (signal.aborted) onAbort()
  })

export class ClientLease {
  private snapshotValue: RuntimeSnapshot | null = null
  private coordinatorGeneration = 0
  private ready = false
  private watchdog: ReturnType<typeof globalThis.setInterval> | null = null
  private lifecycle: AbortController | null = null
  private recovering: { lifecycle: AbortController; deadline: number; task: Promise<void> } | null = null
  private checking: { deadline: number; task: Promise<void> } | null = null
  private readonly readyCallbacks = new Set<() => void>()
  private readonly hostPhaseCallbacks = new Set<(phase: HostPhase) => void>()
  private readonly failureCallbacks = new Set<(error: Error) => void>()
  private hostPhase: HostPhase = 'none'
  private readonly startupTimeoutMs
  private readonly startupRetryIntervalMs
  private readonly watchdogIntervalMs
  private readonly logError

  constructor(private readonly options: ClientLeaseOptions) {
    this.startupTimeoutMs = options.startupTimeoutMs ?? 15000
    this.startupRetryIntervalMs = options.startupRetryIntervalMs ?? 1000
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

  /** Every distinct real control-plane failure is surfaced once here; polling never stops on failure. */
  whenFailure(callback: (error: Error) => void) {
    this.failureCallbacks.add(callback)
    return () => this.failureCallbacks.delete(callback)
  }

  private lease() {
    return { domain: this.options.domain, pageId: this.options.pageId }
  }

  private isCurrent(lifecycle: AbortController) {
    return this.lifecycle === lifecycle && !lifecycle.signal.aborted
  }

  private setHostPhase(phase: HostPhase) {
    if (this.hostPhase === phase) return
    this.hostPhase = phase
    if (this.snapshotValue) this.snapshotValue = { ...this.snapshotValue, hostPhase: phase }
    this.hostPhaseCallbacks.forEach((callback) => callback(phase))
  }

  private emitFailure(error: unknown) {
    const failure = error instanceof Error ? error : new Error(String(error))
    this.logError(failure)
    this.failureCallbacks.forEach((callback) => callback(failure))
  }

  /** Callback delivery rejections are diagnostic only; error content never controls the lease lifecycle. */
  observeTransportRejection(_error: unknown) {
    return false
  }

  private async registerWithinBudget(lifecycle: AbortController, deadline: number): Promise<RuntimePageRegistration> {
    let lastError: unknown = new Error('Runtime registration failed')
    for (;;) {
      lifecycle.signal.throwIfAborted()
      const remaining = deadline - Date.now()
      if (remaining <= 0) throw lastError
      try {
        const attemptDeadline = Math.min(deadline, Date.now() + CLIENT_LEASE_RPC_TIMEOUT_MS)
        const result = await withDeadline(
          this.options.coordinator.registerPage(this.lease()),
          attemptDeadline - Date.now(),
          lifecycle.signal
        )
        if (Date.now() >= attemptDeadline) throw new Error('Runtime control-plane request timed out')
        if (result.phase !== 'ready') throw new Error(`Runtime host unavailable: ${result.phase}`)
        return result
      } catch (error) {
        lifecycle.signal.throwIfAborted()
        lastError = error
        if (Date.now() + this.startupRetryIntervalMs > deadline) throw error
        await wait(this.startupRetryIntervalMs, lifecycle.signal)
      }
    }
  }

  private async attach(lifecycle: AbortController, deadline = Date.now() + this.startupTimeoutMs) {
    const registration = await this.registerWithinBudget(lifecycle, deadline)
    if (!this.isCurrent(lifecycle)) return null
    this.snapshotValue = registration.snapshot
    this.coordinatorGeneration = registration.generation
    this.ready = true
    this.setHostPhase(registration.snapshot.hostPhase)
    this.readyCallbacks.forEach((callback) => callback())
    return registration.snapshot
  }

  private recover(lifecycle: AbortController, deadline: number) {
    if (!this.isCurrent(lifecycle)) return Promise.resolve()
    if (this.recovering?.lifecycle === lifecycle && Date.now() < this.recovering.deadline) {
      return this.recovering.task
    }
    this.setHostPhase('connecting')
    const recovery = { lifecycle, deadline, task: Promise.resolve() }
    const task = this.attach(lifecycle, deadline)
      .then(() => {})
      .catch((error) => {
        if (!this.isCurrent(lifecycle) || this.recovering !== recovery) return
        this.setHostPhase('unavailable')
        this.emitFailure(error)
      })
    recovery.task = task
    this.recovering = recovery
    void task.finally(() => {
      if (this.recovering?.task === task) this.recovering = null
    })
    return task
  }

  private async checkOnce(check: { deadline: number }) {
    const lifecycle = this.lifecycle
    if (!lifecycle || !this.isCurrent(lifecycle)) return
    const attemptDeadline = Math.min(check.deadline, Date.now() + CLIENT_LEASE_RPC_TIMEOUT_MS)
    try {
      const registration = await withDeadline(
        this.options.coordinator.registerPage(this.lease()),
        attemptDeadline - Date.now(),
        lifecycle.signal
      )
      if (Date.now() >= attemptDeadline) throw new Error('Runtime control-plane request timed out')
      if (!this.isCurrent(lifecycle) || this.checking !== check || Date.now() >= check.deadline) return
      const lease = registration.snapshot.domains.find((item) => item.domain === this.options.domain)
      const replaced =
        registration.generation !== this.coordinatorGeneration ||
        registration.snapshot.hostId !== this.snapshotValue?.hostId ||
        !lease?.pageIds.includes(this.options.pageId)
      if (replaced) {
        this.ready = false
        await this.recover(lifecycle, check.deadline)
        return
      }
      this.snapshotValue = registration.snapshot
      this.setHostPhase(registration.snapshot.hostPhase)
    } catch (error) {
      if (!this.isCurrent(lifecycle) || this.checking !== check) return
      if (Date.now() >= check.deadline) {
        this.ready = false
        this.setHostPhase('unavailable')
        this.emitFailure(error)
        return
      }
      this.ready = false
      await this.recover(lifecycle, check.deadline)
    }
  }

  checkNow() {
    const now = Date.now()
    if (this.checking && now < this.checking.deadline) return this.checking.task
    if (this.recovering && now >= this.recovering.deadline) this.recovering = null
    const check = { deadline: now + this.startupTimeoutMs, task: Promise.resolve() }
    const task = this.checkOnce(check).finally(() => {
      if (this.checking?.task === task) this.checking = null
    })
    check.task = task
    this.checking = check
    return task
  }

  private startWatchdog(lifecycle: AbortController) {
    if (this.watchdog || !this.isCurrent(lifecycle)) return
    this.watchdog = globalThis.setInterval(() => {
      if (this.isCurrent(lifecycle)) void this.checkNow()
    }, this.watchdogIntervalMs)
  }

  async init(): Promise<RuntimeSnapshot | null> {
    this.lifecycle?.abort(new DOMException('Runtime lease superseded', 'AbortError'))
    this.recovering = null
    this.checking = null
    if (this.watchdog) globalThis.clearInterval(this.watchdog)
    this.watchdog = null
    const lifecycle = new AbortController()
    this.lifecycle = lifecycle
    this.ready = false
    this.setHostPhase('connecting')
    try {
      const snapshot = await this.attach(lifecycle)
      if (!snapshot || !this.isCurrent(lifecycle)) return null
      this.startWatchdog(lifecycle)
      return snapshot
    } catch (error) {
      if (lifecycle.signal.aborted) return null
      this.setHostPhase('unavailable')
      // A genuine initial control-plane failure is a distinct real failure surfaced with its
      // original message, exactly once, on the current page.
      this.emitFailure(error)
      throw error
    }
  }

  detach() {
    this.lifecycle?.abort(new DOMException('Runtime lease detached', 'AbortError'))
    this.lifecycle = null
    this.recovering = null
    this.checking = null
    this.ready = false
    this.setHostPhase('none')
    if (this.watchdog) {
      globalThis.clearInterval(this.watchdog)
      this.watchdog = null
    }
  }

  snapshot(): RuntimeSnapshot {
    if (!this.snapshotValue) throw new Error('Runtime client not initialized')
    return this.snapshotValue
  }
}
