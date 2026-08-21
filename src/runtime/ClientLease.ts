import type { HostPhase, RuntimeCoordinator, RuntimePageRegistration, RuntimeSnapshot } from '@/runtime/Contract'

export const CLIENT_LEASE_RPC_TIMEOUT_MS = 5000

export interface ClientLeaseOptions {
  coordinator: RuntimeCoordinator
  pageId: string
  domain: string
  startupTimeoutMs?: number
  startupRetryIntervalMs?: number
}

export interface ClientLeaseActivation {
  runtimeHostId?: string
  bindingId?: string
  bindingRevision?: number
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
  private bindingIdValue: string | null = null
  private bindingRevisionValue: number | null = null
  private ready = false
  private lifecycle: AbortController | null = null
  private activation = 0
  private readonly readyCallbacks = new Set<(activation?: ClientLeaseActivation) => void | Promise<void>>()
  private readonly hostPhaseCallbacks = new Set<(phase: HostPhase) => void>()
  private readonly failureCallbacks = new Set<(error: Error) => void>()
  private hostPhase: HostPhase = 'none'
  private readonly startupTimeoutMs
  private readonly startupRetryIntervalMs

  constructor(private readonly options: ClientLeaseOptions) {
    this.startupTimeoutMs = options.startupTimeoutMs ?? 15000
    this.startupRetryIntervalMs = options.startupRetryIntervalMs ?? 1000
  }

  whenReady(callback: (activation?: ClientLeaseActivation) => void | Promise<void>) {
    this.readyCallbacks.add(callback)
    if (this.ready) void Promise.resolve(callback(this.currentActivation())).catch((error) => this.emitFailure(error))
    return () => this.readyCallbacks.delete(callback)
  }

  whenHostPhase(callback: (phase: HostPhase) => void) {
    this.hostPhaseCallbacks.add(callback)
    callback(this.hostPhase)
    return () => this.hostPhaseCallbacks.delete(callback)
  }

  /** Every distinct real control-plane failure is surfaced once here. */
  whenFailure(callback: (error: Error) => void) {
    this.failureCallbacks.add(callback)
    return () => this.failureCallbacks.delete(callback)
  }

  private lease(rebindId?: string) {
    return {
      domain: this.options.domain,
      pageId: this.options.pageId,
      ...(rebindId ? { rebindId } : {})
    }
  }

  private async notifyReady() {
    // Start every direct owner before inspecting failure so one synchronous callback exception
    // cannot suppress Chat's remaining registrations or World attachment.
    const results = await Promise.allSettled(
      [...this.readyCallbacks].map((callback) => Promise.resolve().then(() => callback(this.currentActivation())))
    )
    const failure = results.find((result): result is PromiseRejectedResult => result.status === 'rejected')
    if (failure) throw failure.reason
  }

  private currentActivation(): ClientLeaseActivation {
    return {
      runtimeHostId: this.runtimeHostId(),
      bindingId: this.bindingId(),
      bindingRevision: this.bindingRevision()
    }
  }

  private isCurrent(lifecycle: AbortController, activation?: number) {
    return (
      this.lifecycle === lifecycle &&
      !lifecycle.signal.aborted &&
      (activation === undefined || this.activation === activation)
    )
  }

  private setHostPhase(phase: HostPhase) {
    if (this.hostPhase === phase) return
    this.hostPhase = phase
    if (this.snapshotValue) this.snapshotValue = { ...this.snapshotValue, hostPhase: phase }
    this.hostPhaseCallbacks.forEach((callback) => callback(phase))
  }

  private emitFailure(error: unknown) {
    const failure = error instanceof Error ? error : new Error(String(error))
    this.failureCallbacks.forEach((callback) => {
      try {
        callback(failure)
      } catch (listenerError) {
        console.error(listenerError)
      }
    })
  }

  private emitRegistrationFailures(registration: RuntimePageRegistration) {
    registration.failures?.forEach((failure) => this.emitFailure(new Error(failure.message)))
  }

  /** Callback delivery rejections are diagnostic only; error content never controls the lease lifecycle. */
  observeTransportRejection(_error: unknown) {
    return false
  }

  private async registerWithinBudget(
    lifecycle: AbortController,
    deadline: number,
    rebindId?: string
  ): Promise<RuntimePageRegistration> {
    let lastError: unknown = new Error('Runtime registration failed')
    for (;;) {
      lifecycle.signal.throwIfAborted()
      const remaining = deadline - Date.now()
      if (remaining <= 0) throw lastError
      try {
        const attemptDeadline = Math.min(deadline, Date.now() + CLIENT_LEASE_RPC_TIMEOUT_MS)
        const result = await withDeadline(
          this.options.coordinator.registerPage(this.lease(rebindId)),
          attemptDeadline - Date.now(),
          lifecycle.signal
        )
        if (Date.now() >= attemptDeadline) throw new Error('Runtime control-plane request timed out')
        return result
      } catch (error) {
        lifecycle.signal.throwIfAborted()
        lastError = error
        if (Date.now() + this.startupRetryIntervalMs > deadline) throw error
        await wait(this.startupRetryIntervalMs, lifecycle.signal)
      }
    }
  }

  private async attach(lifecycle: AbortController, activation: number, deadline = Date.now() + this.startupTimeoutMs) {
    const registration = await this.registerWithinBudget(lifecycle, deadline)
    if (!this.isCurrent(lifecycle, activation)) return null
    this.snapshotValue = registration.snapshot
    this.bindingIdValue = registration.bindingId ?? null
    this.bindingRevisionValue = registration.bindingRevision ?? null
    await this.notifyReady()
    if (!this.isCurrent(lifecycle, activation)) return null
    this.ready = true
    this.setHostPhase(registration.snapshot.hostPhase)
    this.emitRegistrationFailures(registration)
    return registration.snapshot
  }

  /**
   * A real Page RPC may explicitly refresh its exact binding. There is deliberately no timer:
   * browser events, not a page health loop, wake or recover the Background authority.
   */
  async checkNow() {
    const lifecycle = this.lifecycle
    if (!lifecycle || !this.isCurrent(lifecycle)) return
    const activation = ++this.activation
    const deadline = Date.now() + this.startupTimeoutMs
    try {
      const registration = await this.registerWithinBudget(lifecycle, deadline)
      if (!this.isCurrent(lifecycle, activation)) return
      this.emitRegistrationFailures(registration)
      const lease = registration.snapshot.domains.find((item) => item.domain === this.options.domain)
      const replaced =
        registration.snapshot.hostId !== this.snapshotValue?.hostId ||
        !lease?.pageIds.includes(this.options.pageId) ||
        registration.bindingId !== this.bindingIdValue
      this.bindingIdValue = registration.bindingId ?? null
      this.bindingRevisionValue = registration.bindingRevision ?? null
      if (replaced) {
        // This exact RPC is the sole new admission. Adopt its current state directly instead of
        // issuing another probe or replaying an action through a recovery helper.
        this.snapshotValue = registration.snapshot
        await this.notifyReady()
        if (!this.isCurrent(lifecycle, activation)) return
        this.ready = true
        this.setHostPhase(registration.snapshot.hostPhase)
        return
      }
      this.snapshotValue = registration.snapshot
      this.setHostPhase(registration.snapshot.hostPhase)
    } catch (error) {
      if (!this.isCurrent(lifecycle, activation)) return
      this.ready = false
      this.setHostPhase('unavailable')
      this.emitFailure(error)
    }
  }

  async init(): Promise<RuntimeSnapshot | null> {
    this.lifecycle?.abort(new DOMException('Runtime lease superseded', 'AbortError'))
    const lifecycle = new AbortController()
    this.lifecycle = lifecycle
    const activation = ++this.activation
    this.ready = false
    this.bindingIdValue = null
    this.bindingRevisionValue = null
    this.setHostPhase('connecting')
    try {
      const snapshot = await this.attach(lifecycle, activation)
      if (!snapshot || !this.isCurrent(lifecycle, activation)) return null
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
    this.activation += 1
    this.ready = false
    this.bindingIdValue = null
    this.bindingRevisionValue = null
    this.setHostPhase('none')
  }

  snapshot(): RuntimeSnapshot {
    if (!this.snapshotValue) throw new Error('Runtime client not initialized')
    return this.snapshotValue
  }

  runtimeHostId() {
    return this.snapshotValue?.hostId
  }

  bindingId() {
    return this.bindingIdValue ?? undefined
  }

  bindingRevision() {
    return this.bindingRevisionValue ?? undefined
  }

  /**
   * The Background asks a surviving Page to make a fresh ordinary registration after it restarts.
   * This deliberately shares the registration primitive with startup without turning `checkNow()`
   * into a production recovery oracle.
   */
  async rebind(rebindId?: string) {
    const lifecycle = this.lifecycle
    if (!lifecycle || !this.isCurrent(lifecycle)) return
    const activation = ++this.activation
    const deadline = Date.now() + this.startupTimeoutMs
    this.ready = false
    this.setHostPhase('connecting')
    try {
      const registration = await this.registerWithinBudget(lifecycle, deadline, rebindId)
      if (!this.isCurrent(lifecycle, activation)) return
      if (rebindId && registration.rebindId !== rebindId) {
        throw new Error('Runtime rebind response is no longer current')
      }
      this.snapshotValue = registration.snapshot
      this.bindingIdValue = registration.bindingId ?? null
      this.bindingRevisionValue = registration.bindingRevision ?? null
      await this.notifyReady()
      if (!this.isCurrent(lifecycle, activation)) return
      this.ready = true
      this.setHostPhase(registration.snapshot.hostPhase)
      this.emitRegistrationFailures(registration)
      return rebindId ? { rebindId } : undefined
    } catch (error) {
      if (!this.isCurrent(lifecycle, activation)) return
      this.ready = false
      this.setHostPhase('unavailable')
      this.emitFailure(error)
      throw error
    }
  }
}
