import type { PagePort as PagePortContract } from '@/domain/runtime/externs/PagePort'
import { PagePortExtern } from '@/domain/runtime/externs/PagePort'
import type {
  HistoryFeedbackEvent,
  HistorySupplyEvent,
  HistorySupplyRequest,
  HistorySupplyResult,
  InboundEvent,
  RuntimeErrorEvent,
  RuntimeSessionEvent,
  WorldPresenceEvent
} from '@/runtime/Contract'

export class PagePort implements PagePortContract {
  private readonly inbound = new Map<string, (event: InboundEvent) => void | Promise<void>>()
  private readonly sessionEvents = new Map<
    string,
    {
      generation: number
      callback: (event: RuntimeSessionEvent) => void | Promise<void>
      tail: Promise<void>
      delivering: boolean
    }
  >()
  private readonly activeSessionGenerations = new Map<string, number>()
  private readonly provisionalSessionEvents = new Map<
    string,
    {
      generation: number
      callback: (event: RuntimeSessionEvent) => void | Promise<void>
      tail: Promise<void>
      delivering: boolean
      buffered: RuntimeSessionEvent[]
    }
  >()
  private sessionEventGeneration = 0
  private readonly worldPresences = new Map<string, (event: WorldPresenceEvent) => void | Promise<void>>()
  private readonly runtimeErrors = new Map<string, (event: RuntimeErrorEvent) => void | Promise<void>>()
  private readonly historyFeedbacks = new Map<string, (event: HistoryFeedbackEvent) => void | Promise<void>>()
  private readonly historyProviders = new Map<
    string,
    { domain: string; callback: (event: HistorySupplyEvent) => void }
  >()
  private readonly pendingHistory = new Map<
    string,
    {
      pageId: string
      resolve: (result: HistorySupplyResult | null) => void
      reject: (error: Error) => void
      cancelMode: 'none' | 'failover' | 'replacement'
      settled: Promise<void>
      confirmSettled: () => void
    }
  >()

  onInbound(pageId: string, callback: (event: InboundEvent) => void | Promise<void>) {
    this.inbound.set(pageId, callback)
  }

  onSessionEvent(pageId: string, callback: (event: RuntimeSessionEvent) => void | Promise<void>) {
    this.provisionalSessionEvents.delete(pageId)
    const generation = ++this.sessionEventGeneration
    this.sessionEvents.set(pageId, { generation, callback, tail: Promise.resolve(), delivering: false })
    this.activeSessionGenerations.set(pageId, generation)
  }

  beginSessionEvent(pageId: string, callback: (event: RuntimeSessionEvent) => void | Promise<void>) {
    const generation = ++this.sessionEventGeneration
    this.sessionEvents.delete(pageId)
    this.activeSessionGenerations.delete(pageId)
    this.provisionalSessionEvents.set(pageId, {
      generation,
      callback,
      tail: Promise.resolve(),
      delivering: false,
      buffered: []
    })
    return generation
  }

  private enqueueSessionEvent(
    pageId: string,
    binding: {
      generation: number
      callback: (event: RuntimeSessionEvent) => void | Promise<void>
      tail: Promise<void>
      delivering: boolean
    },
    event: RuntimeSessionEvent,
    current: () => boolean
  ) {
    const invoke = async () => {
      if (!current()) return
      await binding.callback(event)
    }
    // Start the first active callback in this event turn; only overlapping deltas join the tail.
    // This retains the event bridge's existing immediate observable delivery without permitting
    // a second callback to overtake a pending first one.
    const delivery = binding.delivering ? binding.tail.then(invoke) : invoke()
    binding.delivering = true
    // Keep the physical delivery tail live after an error so already queued exact events can
    // observe removal/replacement fencing instead of becoming unhandled rejections.
    const settled = delivery.catch(() => {})
    binding.tail = settled
    void settled.then(() => {
      if (binding.tail === settled) binding.delivering = false
    })
    return delivery
  }

  async activateSessionEvent(pageId: string, generation: number) {
    const provisional = this.provisionalSessionEvents.get(pageId)
    if (!provisional || provisional.generation !== generation) return false
    while (provisional.buffered.length > 0) {
      await this.enqueueSessionEvent(
        pageId,
        provisional,
        provisional.buffered.shift()!,
        () => this.provisionalSessionEvents.get(pageId) === provisional
      )
      if (this.provisionalSessionEvents.get(pageId) !== provisional) return false
    }
    this.provisionalSessionEvents.delete(pageId)
    this.sessionEvents.set(pageId, provisional)
    this.activeSessionGenerations.set(pageId, generation)
    return true
  }

  cancelSessionEvent(pageId: string, generation: number) {
    if (this.provisionalSessionEvents.get(pageId)?.generation === generation) {
      this.provisionalSessionEvents.delete(pageId)
    }
  }

  isSessionEventActive(pageId: string, generation: number) {
    return this.activeSessionGenerations.get(pageId) === generation
  }

  onWorldPresence(pageId: string, callback: (event: WorldPresenceEvent) => void | Promise<void>) {
    this.worldPresences.set(pageId, callback)
  }

  onError(pageId: string, callback: (event: RuntimeErrorEvent) => void | Promise<void>) {
    this.runtimeErrors.set(pageId, callback)
  }

  onHistoryFeedback(pageId: string, callback: (event: HistoryFeedbackEvent) => void | Promise<void>) {
    this.historyFeedbacks.set(pageId, callback)
  }

  provideHistory(pageId: string, domain: string, callback: (event: HistorySupplyEvent) => void) {
    // Replacing a provider cancels its work but resolves null after physical settlement so the caller may fail over.
    const previous = this.historyProviders.get(pageId)
    if (previous) {
      for (const [supplyId, pending] of this.pendingHistory) {
        if (pending.pageId !== pageId) continue
        this.requestHistoryCancellation(supplyId, 'replacement', previous.callback)
      }
    }
    this.historyProviders.set(pageId, { domain, callback })
  }

  historyPageIds(domain: string) {
    return [...this.historyProviders].filter(([, provider]) => provider.domain === domain).map(([pageId]) => pageId)
  }

  removePage(pageId: string) {
    this.inbound.delete(pageId)
    this.sessionEvents.delete(pageId)
    this.activeSessionGenerations.delete(pageId)
    this.provisionalSessionEvents.delete(pageId)
    this.worldPresences.delete(pageId)
    this.runtimeErrors.delete(pageId)
    this.historyFeedbacks.delete(pageId)
    const historyProvider = this.historyProviders.get(pageId)
    for (const [supplyId, pending] of this.pendingHistory) {
      if (pending.pageId !== pageId) continue
      this.pendingHistory.delete(supplyId)
      try {
        historyProvider?.callback({ type: 'cancel', supplyId })
      } catch (error) {
        // The provider page is already detached: its cancellation callback failure has no user
        // impact and never routes to a replacement page, but it must not disappear. The pending
        // supply still settles by its own contract below.
        console.error(error)
      }
      pending.reject(new Error('History supplier page detached'))
      pending.confirmSettled()
    }
    this.historyProviders.delete(pageId)
  }

  private async emit<T>(
    listeners: Map<string, (payload: T) => void | Promise<void>>,
    pageIds: string[],
    payload: T
  ): Promise<string[]> {
    const deadPageIds: string[] = []
    await Promise.all(
      pageIds.map(async (pageId) => {
        const listener = listeners.get(pageId)
        if (!listener) return
        try {
          await listener(payload)
        } catch (error) {
          // Error delivery cannot recursively create another page error; retain the original
          // callback failure as a direct diagnostic and continue removing independent dead pages.
          console.error(error)
          this.removePage(pageId)
          deadPageIds.push(pageId)
        }
      })
    )
    return deadPageIds
  }

  emitInbound(pageIds: string[], event: InboundEvent) {
    return this.emit(this.inbound, pageIds, event)
  }

  async emitSessionEvent(pageIds: string[], event: RuntimeSessionEvent) {
    const deadPageIds: string[] = []
    await Promise.all(
      pageIds.map(async (pageId) => {
        const listener = this.sessionEvents.get(pageId)
        if (listener) {
          try {
            await this.enqueueSessionEvent(pageId, listener, event, () => this.sessionEvents.get(pageId) === listener)
          } catch (error) {
            console.error(error)
            if (this.sessionEvents.get(pageId) === listener) {
              this.removePage(pageId)
              deadPageIds.push(pageId)
            }
          }
          return
        }
        this.provisionalSessionEvents.get(pageId)?.buffered.push(event)
      })
    )
    return deadPageIds
  }

  emitWorldPresence(pageIds: string[], event: WorldPresenceEvent) {
    return this.emit(this.worldPresences, pageIds, event)
  }

  emitError(pageIds: string[], event: RuntimeErrorEvent) {
    return this.emit(this.runtimeErrors, pageIds, event)
  }

  emitHistoryFeedback(pageIds: string[], event: HistoryFeedbackEvent) {
    return this.emit(this.historyFeedbacks, pageIds, event)
  }

  supplyHistory(pageId: string, request: HistorySupplyRequest): Promise<HistorySupplyResult | null> {
    // settled is distinct from the result promise: timeout ownership cannot move until the page confirms cancellation exit.
    const provider = this.historyProviders.get(pageId)
    if (!provider || provider.domain !== request.domain) return Promise.resolve(null)
    return new Promise<HistorySupplyResult | null>((resolve, reject) => {
      let confirmSettled = () => {}
      const settled = new Promise<void>((confirm) => {
        confirmSettled = confirm
      })
      this.pendingHistory.set(request.supplyId, {
        pageId,
        resolve,
        reject,
        cancelMode: 'none',
        settled,
        confirmSettled
      })
      try {
        provider.callback({ type: 'request', request })
      } catch (error) {
        this.pendingHistory.delete(request.supplyId)
        this.removePage(pageId)
        reject(error as Error)
        confirmSettled()
      }
    })
  }

  /** Cancellation is idempotent; every caller joins the same physical-settlement promise. */
  private requestHistoryCancellation(
    supplyId: string,
    mode: 'failover' | 'replacement',
    callback = this.historyProviders.get(this.pendingHistory.get(supplyId)?.pageId ?? '')?.callback
  ) {
    const pending = this.pendingHistory.get(supplyId)
    if (!pending) return Promise.resolve()
    if (pending.cancelMode === 'none') {
      pending.cancelMode = mode
      try {
        callback?.({ type: 'cancel', supplyId })
      } catch (error) {
        console.error(error)
        // This provider callback is already known dead; do not invoke it again while removing the
        // page and settling its remaining supplies.
        this.historyProviders.delete(pending.pageId)
        this.removePage(pending.pageId)
      }
    }
    return pending.settled
  }

  cancelHistorySupply(supplyId: string) {
    return this.requestHistoryCancellation(supplyId, 'failover')
  }

  resolveHistorySupply(pageId: string, supplyId: string, result: HistorySupplyResult) {
    const pending = this.pendingHistory.get(supplyId)
    if (!pending || pending.pageId !== pageId) return
    this.pendingHistory.delete(supplyId)
    // The token's cancel mode decides whether settlement means timeout failure or benign provider replacement.
    if (pending.cancelMode === 'failover') {
      pending.reject(new Error('History supplier timed out'))
    } else if (pending.cancelMode === 'replacement') {
      pending.resolve(null)
    } else {
      pending.resolve(result)
    }
    pending.confirmSettled()
  }

  rejectHistorySupply(pageId: string, supplyId: string, reason: string) {
    const pending = this.pendingHistory.get(supplyId)
    if (!pending || pending.pageId !== pageId) return
    this.pendingHistory.delete(supplyId)
    if (pending.cancelMode === 'failover') {
      pending.reject(new Error('History supplier timed out'))
    } else if (pending.cancelMode === 'replacement') {
      pending.resolve(null)
    } else {
      this.removePage(pageId)
      pending.reject(new Error(reason))
    }
    pending.confirmSettled()
  }

  pendingHistoryCountForTest() {
    return this.pendingHistory.size
  }

  dispose() {
    const pageIds = new Set([
      ...this.inbound.keys(),
      ...this.sessionEvents.keys(),
      ...this.provisionalSessionEvents.keys(),
      ...this.worldPresences.keys(),
      ...this.runtimeErrors.keys(),
      ...this.historyFeedbacks.keys(),
      ...this.historyProviders.keys()
    ])
    pageIds.forEach((pageId) => this.removePage(pageId))
  }
}

export const createPagePortImpl = (port: PagePort) => PagePortExtern.impl(port)
