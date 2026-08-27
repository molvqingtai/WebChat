import type { PagePort as PagePortContract } from '@/domain/runtime/externs/PagePort'
import { PagePortExtern } from '@/domain/runtime/externs/PagePort'
import type {
  HistorySupplyEvent,
  HistorySupplyRequest,
  HistorySupplyResult,
  HistorySyncCompletedEvent
} from '@/runtime/Contract'

const providerId = (tabId: number) => `tab:${tabId}`

/**
 * Runtime-side owner of the Page History-supply surface. This is the only remaining
 * Background-to-Page operation callback: a genuine History-domain request/response keyed by
 * the browser tab fact, never a state notification or delivery receipt.
 */
export class PagePort implements PagePortContract {
  private readonly historyProviders = new Map<
    string,
    { tabId: number; domain: string; callback: (event: HistorySupplyEvent) => void }
  >()
  private readonly pendingHistory = new Map<
    string,
    {
      providerId: string
      tabId: number
      resolve: (result: HistorySupplyResult | null) => void
      reject: (error: Error) => void
      cancelMode: 'none' | 'failover' | 'replacement'
      settled: Promise<void>
      confirmSettled: () => void
    }
  >()

  provideHistory(tabId: number, domain: string, callback: (event: HistorySupplyEvent) => void) {
    const id = providerId(tabId)
    // Replacing a provider cancels its work but resolves null after physical settlement so the caller may fail over.
    const previous = this.historyProviders.get(id)
    if (previous) {
      for (const [supplyId, pending] of this.pendingHistory) {
        if (pending.providerId !== id) continue
        this.requestHistoryCancellation(supplyId, 'replacement', previous.callback)
      }
    }
    this.historyProviders.set(id, { tabId, domain, callback })
  }

  historyPageIds(domain: string) {
    return [...this.historyProviders].filter(([, provider]) => provider.domain === domain).map(([id]) => id)
  }

  isHistoryProvider(tabId: number, domain: string) {
    return this.historyProviders.get(providerId(tabId))?.domain === domain
  }

  historySyncCompleted(completion: HistorySyncCompletedEvent) {
    for (const provider of this.historyProviders.values()) {
      if (provider.domain !== completion.domain) continue
      provider.callback({ type: 'sync-completed', completion })
    }
  }

  removePage(tabId: number) {
    const id = providerId(tabId)
    const historyProvider = this.historyProviders.get(id)
    for (const [supplyId, pending] of this.pendingHistory) {
      if (pending.providerId !== id) continue
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
    this.historyProviders.delete(id)
  }

  supplyHistory(provider: string, request: HistorySupplyRequest): Promise<HistorySupplyResult | null> {
    // settled is distinct from the result promise: timeout ownership cannot move until the page confirms cancellation exit.
    const entry = this.historyProviders.get(provider)
    if (!entry || entry.domain !== request.domain) return Promise.resolve(null)
    return new Promise<HistorySupplyResult | null>((resolve, reject) => {
      let confirmSettled = () => {}
      const settled = new Promise<void>((confirm) => {
        confirmSettled = confirm
      })
      this.pendingHistory.set(request.supplyId, {
        providerId: provider,
        tabId: entry.tabId,
        resolve,
        reject,
        cancelMode: 'none',
        settled,
        confirmSettled
      })
      try {
        entry.callback({ type: 'request', request })
      } catch (error) {
        this.pendingHistory.delete(request.supplyId)
        this.removePage(entry.tabId)
        reject(error as Error)
        confirmSettled()
      }
    })
  }

  /** Cancellation is idempotent; every caller joins the same physical-settlement promise. */
  private requestHistoryCancellation(
    supplyId: string,
    mode: 'failover' | 'replacement',
    callback = this.historyProviders.get(this.pendingHistory.get(supplyId)?.providerId ?? '')?.callback
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
        this.historyProviders.delete(pending.providerId)
        this.removePage(pending.tabId)
      }
    }
    return pending.settled
  }

  cancelHistorySupply(supplyId: string) {
    return this.requestHistoryCancellation(supplyId, 'failover')
  }

  resolveHistorySupply(tabId: number, supplyId: string, result: HistorySupplyResult) {
    const pending = this.pendingHistory.get(supplyId)
    if (!pending || pending.providerId !== providerId(tabId)) return
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

  rejectHistorySupply(tabId: number, supplyId: string, reason: string) {
    const pending = this.pendingHistory.get(supplyId)
    if (!pending || pending.providerId !== providerId(tabId)) return
    this.pendingHistory.delete(supplyId)
    if (pending.cancelMode === 'failover') {
      pending.reject(new Error('History supplier timed out'))
    } else if (pending.cancelMode === 'replacement') {
      pending.resolve(null)
    } else {
      this.removePage(tabId)
      pending.reject(new Error(reason))
    }
    pending.confirmSettled()
  }

  dispose() {
    const tabIds = new Set([...this.historyProviders.values()].map((provider) => provider.tabId))
    tabIds.forEach((tabId) => this.removePage(tabId))
  }
}

export const createPagePortImpl = (port: PagePort) => PagePortExtern.impl(port)
