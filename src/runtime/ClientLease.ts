import type { HostPhase, RuntimeCoordinator, RuntimePageRegistration, RuntimeSnapshot } from '@/runtime/Contract'

export const CLIENT_LEASE_RPC_TIMEOUT_MS = 5000

export interface ClientLeaseOptions {
  coordinator: RuntimeCoordinator
  pageId: string
  domain: string
  startupTimeoutMs?: number
  startupRetryIntervalMs?: number
  /** Final Server-side exact-binding + full-readiness validation, run after the attachment
   * barrier and before the unique ready publication. Receives the captured attachment epoch.
   * Wired by the Page composition root. */
  validateReady?: (epoch: number) => Promise<void>
  /** Post-publication readiness terminal: issued once, only after ready was published for this
   * exact barrier, so the Server ends the exact-B readiness owners and wakes cohort cleanup.
   * Receives the same captured attachment epoch. Wired by the Page composition root. */
  settleReady?: (epoch: number) => Promise<void>
  /** The exact-B failure terminal: retires the binding whose attachment just failed, ending its
   * readiness owners and waking cohort cleanup. Receives the captured attachment epoch. Wired by
   * the Page composition root. */
  retireBinding?: (epoch: number) => Promise<void>
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
  private ready = false
  private lifecycle: AbortController | null = null
  /** Page-local attachment epoch: changes on every registration/rebind. A ready publication may
   * only consume the exact barrier it started — never a same-tuple successor's. */
  private attachEpoch = 0
  private readonly readyCallbacks = new Set<() => void>()
  /** Internal attach-phase hooks (ChatRoom/WorldRoom attachment). Their completions are the
   * readiness barrier: ready is published only after every one settled. */
  private readonly attachCallbacks = new Set<() => void | Promise<void>>()
  private readonly hostPhaseCallbacks = new Set<(phase: HostPhase) => void>()
  private readonly failureCallbacks = new Set<(error: Error) => void>()
  private hostPhase: HostPhase = 'none'
  private readonly startupTimeoutMs
  private readonly startupRetryIntervalMs

  constructor(private readonly options: ClientLeaseOptions) {
    this.startupTimeoutMs = options.startupTimeoutMs ?? 15000
    this.startupRetryIntervalMs = options.startupRetryIntervalMs ?? 1000
  }

  whenReady(callback: () => void) {
    this.readyCallbacks.add(callback)
    if (this.ready) callback()
    return () => this.readyCallbacks.delete(callback)
  }

  /**
   * Page-internal attachment phase: callbacks start their exact attachment when a registration is
   * admitted and must settle BEFORE ready is published. A rejection blocks ready and surfaces as
   * the attach failure. Never a public/UI hook.
   */
  whenAttach(callback: () => void | Promise<void>) {
    this.attachCallbacks.add(callback)
    return () => this.attachCallbacks.delete(callback)
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

  private lease(epoch: number) {
    return { domain: this.options.domain, pageId: this.options.pageId, epoch }
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
    epoch: number
  ): Promise<RuntimePageRegistration> {
    let lastError: unknown = new Error('Runtime registration failed')
    for (;;) {
      lifecycle.signal.throwIfAborted()
      const remaining = deadline - Date.now()
      if (remaining <= 0) throw lastError
      try {
        const attemptDeadline = Math.min(deadline, Date.now() + CLIENT_LEASE_RPC_TIMEOUT_MS)
        const result = await withDeadline(
          this.options.coordinator.registerPage(this.lease(epoch)),
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

  /** Runs the attachment barrier: starts every registered attachment and resolves only after all
   * of them settled. A rejection is a real attach failure. */
  private async runAttachmentBarrier() {
    const work = [...this.attachCallbacks].map((callback) => {
      try {
        return Promise.resolve(callback())
      } catch (error) {
        return Promise.reject(error)
      }
    })
    const settled = await Promise.allSettled(work)
    const failed = settled.find((entry): entry is PromiseRejectedResult => entry.status === 'rejected')
    if (failed) throw failed.reason
  }

  /** Retires the binding only when the failed barrier is still the current attachment epoch: a
   * stale B1 failure can never detach a same-tuple successor. */
  private async retireCurrentBinding(epoch: number) {
    if (!this.options.retireBinding || this.attachEpoch !== epoch) return
    try {
      await this.options.retireBinding(epoch)
    } catch (error) {
      // The binding may already be gone (navigation/replacement); the failure terminal is best
      // effort and never masks the original attachment failure.
      console.error(error)
    }
  }

  /** The unique readiness terminal: issued once after this exact barrier published ready. */
  private async settleReadyPublication(lifecycle: AbortController, epoch: number) {
    if (!this.options.settleReady || this.attachEpoch !== epoch || !this.isCurrent(lifecycle)) return
    try {
      await this.options.settleReady(epoch)
    } catch (error) {
      // A stale/missing binding fails closed Server-side; its readiness owners end via the
      // exact-B retirement path, so cohort cleanup still wakes.
      console.error(error)
    }
  }

  private async attach(lifecycle: AbortController, deadline = Date.now() + this.startupTimeoutMs) {
    const epoch = ++this.attachEpoch
    const registration = await this.registerWithinBudget(lifecycle, deadline, epoch)
    if (!this.isCurrent(lifecycle)) return null
    this.snapshotValue = registration.snapshot
    try {
      // Phase 1: attachments (ChatRoom registrations + replay, WorldRoom subscription + snapshot)
      // must settle BEFORE the single ready publication below.
      await this.runAttachmentBarrier()
      if (!this.isCurrent(lifecycle)) return null
      // Phase 2: the unique ready publication point — after World attach AND the final Server-side
      // exact-binding + full-readiness validation. A same-host B2 replacement installed during the
      // barrier fails this check and blocks the stale B1 ready publication.
      if (this.options.validateReady) await this.options.validateReady(epoch)
    } catch (error) {
      // The attachment failure terminal: retire the exact binding so its readiness owners end
      // exactly once and cohort cleanup wakes. The original failure is preserved.
      await this.retireCurrentBinding(epoch)
      throw error
    }
    // A same-tuple successor registration (rebind/attach) changes the epoch: this barrier can no
    // longer be published, even while the long-lived lifecycle controller still matches.
    if (!this.isCurrent(lifecycle) || this.attachEpoch !== epoch) return null
    this.ready = true
    this.setHostPhase(registration.snapshot.hostPhase)
    this.readyCallbacks.forEach((callback) => callback())
    this.emitRegistrationFailures(registration)
    // The readiness owners end only now, at the real cross-context terminal, never at validation.
    await this.settleReadyPublication(lifecycle, epoch)
    return registration.snapshot
  }

  /**
   * A real Page RPC may explicitly refresh its exact binding. There is deliberately no timer:
   * browser events, not a page health loop, wake or recover the Background authority.
   */
  async checkNow() {
    const lifecycle = this.lifecycle
    if (!lifecycle || !this.isCurrent(lifecycle)) return
    const epoch = ++this.attachEpoch
    const deadline = Date.now() + this.startupTimeoutMs
    try {
      const registration = await this.registerWithinBudget(lifecycle, deadline, epoch)
      if (!this.isCurrent(lifecycle)) return
      this.emitRegistrationFailures(registration)
      // Every successful registration installs a fresh exact binding object (the Server removes
      // the prior B and its callbacks at install). A same-host refresh is never detectable from
      // the stable tuple, so every admission rebuilds the complete attachment barrier and final
      // validation for the new B before publishing ready again.
      this.snapshotValue = registration.snapshot
      try {
        await this.runAttachmentBarrier()
        if (!this.isCurrent(lifecycle)) return
        if (this.options.validateReady) await this.options.validateReady(epoch)
      } catch (error) {
        await this.retireCurrentBinding(epoch)
        throw error
      }
      if (!this.isCurrent(lifecycle) || this.attachEpoch !== epoch) return
      this.ready = true
      this.setHostPhase(registration.snapshot.hostPhase)
      this.readyCallbacks.forEach((callback) => callback())
      await this.settleReadyPublication(lifecycle, epoch)
    } catch (error) {
      if (!this.isCurrent(lifecycle)) return
      this.ready = false
      this.setHostPhase('unavailable')
      this.emitFailure(error)
    }
  }

  async init(): Promise<RuntimeSnapshot | null> {
    this.lifecycle?.abort(new DOMException('Runtime lease superseded', 'AbortError'))
    const lifecycle = new AbortController()
    this.lifecycle = lifecycle
    this.ready = false
    this.setHostPhase('connecting')
    try {
      const snapshot = await this.attach(lifecycle)
      if (!snapshot || !this.isCurrent(lifecycle)) return null
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
    this.ready = false
    this.setHostPhase('none')
  }

  snapshot(): RuntimeSnapshot {
    if (!this.snapshotValue) throw new Error('Runtime client not initialized')
    return this.snapshotValue
  }

  runtimeHostId() {
    return this.snapshotValue?.hostId
  }

  /**
   * The Background asks a surviving Page to make a fresh ordinary registration after it restarts.
   * This deliberately shares the registration primitive with startup without turning `checkNow()`
   * into a production recovery oracle.
   */
  async rebind() {
    const lifecycle = this.lifecycle
    if (!lifecycle || !this.isCurrent(lifecycle)) return
    const epoch = ++this.attachEpoch
    const deadline = Date.now() + this.startupTimeoutMs
    this.ready = false
    this.setHostPhase('connecting')
    try {
      const registration = await this.registerWithinBudget(lifecycle, deadline, epoch)
      if (!this.isCurrent(lifecycle)) return
      this.snapshotValue = registration.snapshot
      try {
        // The rebind attachment barrier: existing ChatRoom/WorldRoom attachments complete before
        // ready is published again.
        await this.runAttachmentBarrier()
        if (!this.isCurrent(lifecycle)) return
        if (this.options.validateReady) await this.options.validateReady(epoch)
      } catch (error) {
        await this.retireCurrentBinding(epoch)
        throw error
      }
      if (!this.isCurrent(lifecycle) || this.attachEpoch !== epoch) return
      this.ready = true
      this.setHostPhase(registration.snapshot.hostPhase)
      this.readyCallbacks.forEach((callback) => callback())
      this.emitRegistrationFailures(registration)
      await this.settleReadyPublication(lifecycle, epoch)
    } catch (error) {
      if (!this.isCurrent(lifecycle)) return
      this.ready = false
      this.setHostPhase('unavailable')
      this.emitFailure(error)
      throw error
    }
  }
}
