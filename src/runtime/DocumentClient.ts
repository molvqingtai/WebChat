import type { HostPhase, RuntimeCoordinator, RuntimeServer, RuntimeSnapshot } from '@/runtime/Contract'

export interface DocumentClientOptions {
  coordinator: RuntimeCoordinator
  server: RuntimeServer
  domain: string
}

export type ProjectionApplier = (projection: RuntimeSnapshot) => void | Promise<void>

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
  private dirty = false
  private owner: Promise<void> | null = null
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
    this.owner = this.drain()
  }

  private async drain() {
    try {
      do {
        this.dirty = false
        const projection = this.registered
          ? await this.options.server.getSnapshot()
          : (await this.options.coordinator.registerPage({ domain: this.options.domain })).snapshot
        // The registration/read response succeeded; a later apply failure never re-registers.
        this.registered = true
        this.currentSnapshot = projection
        this.setHostPhase(projection.hostPhase)
        await this.appliers.chat?.(projection)
        await this.appliers.persistence?.(projection)
        await this.appliers.world?.(projection)
      } while (this.dirty)
      if (!this.readyPublished) {
        this.publishReady()
      }
    } catch (error) {
      this.publishFailure(error)
    } finally {
      // One synchronous finalization cut, with no await: clear the owner, immediately recheck
      // dirty, and restart only for an explicit invalidation already reflected by dirty.
      this.owner = null
      if (this.dirty) this.startDrainIfAbsent()
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
    this.readyPublished = false
    this.currentSnapshot = null
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
