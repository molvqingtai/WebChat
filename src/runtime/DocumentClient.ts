import type { HostPhase, RuntimeCoordinator, RuntimeServer, RuntimeSnapshot } from '@/runtime/Contract'

export interface DocumentClientOptions {
  coordinator: RuntimeCoordinator
  server: RuntimeServer
  domain: string
}

/**
 * Document-local owner capability passed to every applier. It carries the current owner's abort
 * signal (for cancellable persistence) and a current-owner assertion. A stale continuation throws
 * a local AbortError and is silenced by the drain's stale fence — never a Page identity,
 * cross-context generation, delivery receipt, or binding.
 */
export interface ProjectionApplyContext {
  readonly signal: AbortSignal
  readonly assertCurrent: () => void
}

export type ProjectionApplier = (projection: RuntimeSnapshot, context: ProjectionApplyContext) => void | Promise<void>

/**
 * The one document-local registration/refresh drain owner (V17):
 * - The `runtime:state-changed` listener (installed by the composition module before any read)
 *   only marks this owner dirty and starts or joins it; the notification is a content-free
 *   invalidation, never a payload.
 * - Each pull clears dirty first, then runs `registered ? read-current : register-and-read`,
 *   then applies Chat, local persistence, and World serially under the same owner. `while(dirty)`
 *   has no fixed cap: the owner drains until one complete pull and apply stays clean.
 * - A rejected read or any failed apply stage publishes the original document-local
 *   Error/unavailable. Failure never sets dirty and never retries by itself.
 * - Success and failure enter one no-await `finally`: unconditionally clear the owner,
 *   synchronously recheck dirty, and synchronously restart only when an explicit invalidation
 *   already set it. No `dirty=true/owner=null` lost wakeup is possible.
 */
export class DocumentClient {
  private registered = false
  private currentHostId: string | null = null
  private dirty = false
  /** The one live drain owner: a document-local exact token, abort controller, and task. Never exposed. */
  private owner: { token: number; controller: AbortController; task: Promise<void> } | null = null
  private ownerSequence = 0
  private readyPublished = false
  private detached = false
  private currentSnapshot: RuntimeSnapshot | null = null
  private hostPhase: HostPhase = 'none'
  private readonly appliers: { chat?: ProjectionApplier; persistence?: ProjectionApplier; world?: ProjectionApplier } =
    {}
  private readonly readyCallbacks = new Set<() => void>()
  private readonly hostPhaseCallbacks = new Set<(phase: HostPhase) => void>()
  private readonly failureCallbacks = new Set<(error: Error) => void>()
  private readonly initWaiters = new Set<{
    resolve: (snapshot: RuntimeSnapshot) => void
    reject: (error: unknown) => void
  }>()

  constructor(private readonly options: DocumentClientOptions) {}

  /** Idempotent synchronous local-state observers; a throw keeps ready unpublished. */
  whenReady(callback: () => void) {
    this.readyCallbacks.add(callback)
    if (this.readyPublished) callback()
    return () => this.readyCallbacks.delete(callback)
  }

  whenHostPhase(callback: (phase: HostPhase) => void) {
    this.hostPhaseCallbacks.add(callback)
    callback(this.hostPhase)
    return () => this.hostPhaseCallbacks.delete(callback)
  }

  /** Every distinct drain failure is surfaced once here with its original Error. */
  whenFailure(callback: (error: Error) => void) {
    this.failureCallbacks.add(callback)
    return () => this.failureCallbacks.delete(callback)
  }

  /**
   * Registers one apply stage and explicitly invalidates so the late-registered applier converges
   * through the same drain owner (never through an independent apply path).
   */
  registerApplier(stage: 'chat' | 'persistence' | 'world', applier: ProjectionApplier) {
    this.appliers[stage] = applier
    this.invalidate()
  }

  /** The sole entry for an explicit invalidation: a hint, an applier registration, or an init. */
  invalidate() {
    if (this.detached) return
    this.dirty = true
    this.startDrainIfAbsent()
  }

  private startDrainIfAbsent() {
    if (this.detached || this.owner) return
    if (!this.readyPublished && !this.currentSnapshot) this.setHostPhase('connecting')
    // The owner token is installed before any fallible work: the drain body starts one microtask
    // later, so even a synchronous RPC throw lands inside the drain's own try/finally and the
    // common finally stays the last write to the slot.
    const entry = { token: ++this.ownerSequence, controller: new AbortController(), task: Promise.resolve() }
    entry.task = Promise.resolve().then(() => this.drain(entry))
    this.owner = entry
  }

  /** A continuation may mutate only while its exact owner token is active and the document lives. */
  private isOwnerCurrent(entry: { token: number }) {
    return !this.detached && this.owner?.token === entry.token
  }

  private applyContext(entry: { token: number; controller: AbortController }): ProjectionApplyContext {
    return {
      signal: entry.controller.signal,
      assertCurrent: () => {
        if (!this.isOwnerCurrent(entry)) {
          throw new DOMException('Projection apply superseded', 'AbortError')
        }
      }
    }
  }

  private async drain(entry: { token: number; controller: AbortController }) {
    try {
      do {
        this.dirty = false
        const projection = this.registered
          ? await this.options.server.getSnapshot({ domain: this.options.domain })
          : (await this.options.coordinator.registerPage({ domain: this.options.domain })).snapshot
        if (!this.isOwnerCurrent(entry)) return
        if (this.currentHostId !== null && projection.hostId !== this.currentHostId) {
          // The logical Background was replaced: drop only host-local drain identity and loop
          // through the register-and-read surface so the fresh Runtime rebuilds tab membership
          // (and the History provider) before any projection is applied.
          this.registered = false
          this.currentHostId = null
          this.dirty = true
          continue
        }
        // The registration/read response succeeded; a later apply failure never re-registers.
        this.registered = true
        this.currentHostId = projection.hostId
        this.currentSnapshot = projection
        const context = this.applyContext(entry)
        await this.appliers.chat?.(projection, context)
        if (!this.isOwnerCurrent(entry)) return
        await this.appliers.persistence?.(projection, context)
        if (!this.isOwnerCurrent(entry)) return
        await this.appliers.world?.(projection, context)
        if (!this.isOwnerCurrent(entry)) return
        // The pulled host phase is a pending fact until every apply stage has settled.
        this.setHostPhase(projection.hostPhase)
      } while (this.dirty)
      if (!this.isOwnerCurrent(entry)) return
      if (!this.readyPublished) {
        this.publishReady()
      }
    } catch (error) {
      // A fenced late continuation is inert; only a current owner's failure is published.
      if (!this.isOwnerCurrent(entry)) return
      this.publishFailure(error)
    } finally {
      // One synchronous finalization cut, with no await: only the exact current owner clears its
      // own slot, immediately rechecks dirty, and restarts; a detached owner never touches a
      // successor's slot.
      if (this.owner?.token === entry.token) {
        this.owner = null
        if (this.dirty) this.startDrainIfAbsent()
      }
    }
  }

  private publishReady() {
    // Every synchronous observer must return before ready is published; a throw propagates to
    // the drain's catch, publishes the original Error, and leaves readyPublished false so a
    // later explicit hint may attempt publication again.
    this.readyCallbacks.forEach((callback) => callback())
    this.readyPublished = true
    if (this.currentSnapshot) {
      const snapshot = this.currentSnapshot
      this.initWaiters.forEach((waiter) => waiter.resolve(snapshot))
      this.initWaiters.clear()
    }
  }

  private publishFailure(error: unknown) {
    const failure = error instanceof Error ? error : new Error(String(error))
    this.setHostPhase('unavailable')
    this.failureCallbacks.forEach((callback) => {
      try {
        callback(failure)
      } catch (listenerError) {
        console.error(listenerError)
      }
    })
    this.initWaiters.forEach((waiter) => waiter.reject(failure))
    this.initWaiters.clear()
  }

  private setHostPhase(phase: HostPhase) {
    if (this.hostPhase === phase) return
    this.hostPhase = phase
    this.hostPhaseCallbacks.forEach((callback) => callback(phase))
  }

  /** Starts the drain and settles on the next ready publication or failure. */
  async init(): Promise<RuntimeSnapshot | null> {
    if (this.detached) this.detached = false
    if (this.readyPublished && this.currentSnapshot) {
      return this.currentSnapshot
    }
    const waiter = new Promise<RuntimeSnapshot>((resolve, reject) => {
      this.initWaiters.add({ resolve, reject })
    })
    this.invalidate()
    return waiter
  }

  /** Document-local teardown only; tab departure itself is owned by browser lifecycle events. */
  detach() {
    this.detached = true
    this.dirty = false
    this.registered = false
    this.currentHostId = null
    this.readyPublished = false
    this.currentSnapshot = null
    // Retire the live owner token immediately: abort its applier boundary, fence its late
    // continuation at every post-await checkpoint, and let a later init start a fresh
    // register-and-read owner without waiting for it.
    this.owner?.controller.abort(new DOMException('Runtime client detached', 'AbortError'))
    this.owner = null
    const reason = new DOMException('Runtime client detached', 'AbortError')
    this.initWaiters.forEach((waiter) => waiter.reject(reason))
    this.initWaiters.clear()
    this.setHostPhase('none')
  }

  snapshot(): RuntimeSnapshot {
    if (!this.currentSnapshot) throw new Error('Runtime client not initialized')
    return this.currentSnapshot
  }
}
