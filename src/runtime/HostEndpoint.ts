import type { HistorySupplyEvent, RuntimeServer } from '@/runtime/Contract'
import { removeServerTab } from '@/runtime/Server'
import {
  HOST_PUSH_SCOPE,
  errorMessage,
  type HostPush,
  type HostRequest,
  type HostResponse,
  type PageCall
} from '@/runtime/Link'

interface HostedPage {
  pageId: string
  tabId: number
  domain: string
  url: string
}

const pageCaller = (payload: unknown, page: HostedPage): Record<string, unknown> => {
  const value = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {}
  return { ...value, caller: { tab: { id: page.tabId, url: page.url } } }
}

/**
 * Host-side address book and dispatcher.
 *
 * The host owns the only durable identity (its Runtime). Pages are ephemeral callers keyed by a
 * per-document id and addressed by the browser tab that delivered the message. A Page that
 * reconnects after a Background restart simply calls again: an unknown page id is re-registered
 * from the browser facts carried by this very message, and the return value is current state.
 */
export class HostEndpoint {
  private readonly pages = new Map<string, HostedPage>()
  private stateChangedScheduled = false

  constructor(
    private readonly server: RuntimeServer,
    private readonly sendPush: (push: HostPush) => void
  ) {}

  private pageIdsForTab(tabId: number) {
    return [...this.pages.values()].filter((page) => page.tabId === tabId).map((page) => page.pageId)
  }

  private removePage(pageId: string) {
    const page = this.pages.get(pageId)
    if (!page) return null
    this.pages.delete(pageId)
    return page
  }

  private removeTab(tabId: number) {
    for (const pageId of this.pageIdsForTab(tabId)) this.pages.delete(pageId)
    void removeServerTab(this.server, tabId).catch((error) => console.error(error))
  }

  private register(pageId: string, tabId: number, domain: string, url: string): HostedPage {
    const existing = this.pages.get(pageId)
    if (existing && existing.tabId === tabId && existing.domain === domain) {
      existing.url = url
      return existing
    }
    if (existing) this.pages.delete(pageId)
    // A tab has one top-level document. A new document replaces the old page route even before
    // the browser reports the navigation.
    for (const other of this.pageIdsForTab(tabId)) this.pages.delete(other)
    const page: HostedPage = { pageId, tabId, domain, url }
    this.pages.set(pageId, page)
    return page
  }

  private historyCallback(page: HostedPage): (event: HistorySupplyEvent) => void {
    return (event) => this.sendPush({ scope: HOST_PUSH_SCOPE, type: 'history', tabId: page.tabId, event })
  }

  private async invoke(message: PageCall, tabId: number, url: string): Promise<unknown> {
    const page = this.register(message.pageId, tabId, message.domain, url)
    const payload = message.args[0]
    const args = [pageCaller(payload, page), ...message.args.slice(1)]
    switch (message.method) {
      case 'attachPage':
        return this.server.attachPage(args[0] as Parameters<RuntimeServer['attachPage']>[0])
      case 'getSnapshot':
        return this.server.getSnapshot(args[0] as Parameters<RuntimeServer['getSnapshot']>[0])
      case 'joinChatRoom':
        return this.server.joinChatRoom(args[0] as Parameters<RuntimeServer['joinChatRoom']>[0])
      case 'leaveChatRoom':
        return this.server.leaveChatRoom(args[0] as Parameters<RuntimeServer['leaveChatRoom']>[0])
      case 'allocateTextMessage':
        return this.server.allocateTextMessage(args[0] as Parameters<RuntimeServer['allocateTextMessage']>[0])
      case 'allocateReactionMessage':
        return this.server.allocateReactionMessage(
          args[0] as Parameters<RuntimeServer['allocateReactionMessage']>[0]
        )
      case 'sendChatMessage':
        return this.server.sendChatMessage(args[0] as Parameters<RuntimeServer['sendChatMessage']>[0])
      case 'ackInbound':
        return this.server.ackInbound(args[0] as Parameters<RuntimeServer['ackInbound']>[0])
      case 'reconnectDomain':
        return this.server.reconnectDomain(args[0] as Parameters<RuntimeServer['reconnectDomain']>[0])
      case 'provideHistory':
        return this.server.provideHistory(
          args[0] as Parameters<RuntimeServer['provideHistory']>[0],
          this.historyCallback(page)
        )
      case 'resolveHistorySupply':
        return this.server.resolveHistorySupply(
          args[0] as Parameters<RuntimeServer['resolveHistorySupply']>[0]
        )
      case 'rejectHistorySupply':
        return this.server.rejectHistorySupply(
          args[0] as Parameters<RuntimeServer['rejectHistorySupply']>[0]
        )
      default:
        throw new Error(`Unknown Runtime method: ${String(message.method)}`)
    }
  }

  async handle(request: HostRequest): Promise<HostResponse> {
    try {
      if (request.type === 'ping') return { ok: true, value: { host: true } }
      if (request.type === 'tab-gone') {
        if (typeof request.tabId === 'number') this.removeTab(request.tabId)
        return { ok: true }
      }
      if (request.type !== 'call' || !request.message) throw new Error('Invalid Runtime host request')
      if (typeof request.tabId !== 'number') throw new Error('Runtime call has no browser tab')
      const message = request.message
      if (message.type === 'bye') {
        const page = this.removePage(message.pageId)
        if (page && this.pageIdsForTab(page.tabId).length === 0) this.removeTab(page.tabId)
        return { ok: true }
      }
      return { ok: true, value: await this.invoke(message, request.tabId, request.url ?? '') }
    } catch (error) {
      return { ok: false, error: errorMessage(error) }
    }
  }

  /**
   * The only Background→Page signal is "your projection is stale". Coalescing is local to the
   * host and holds no payload: pages always pull the current full snapshot themselves.
   */
  invalidate() {
    if (this.stateChangedScheduled || this.pages.size === 0) return
    this.stateChangedScheduled = true
    queueMicrotask(() => {
      this.stateChangedScheduled = false
      const tabIds = [...new Set([...this.pages.values()].map((page) => page.tabId))]
      if (tabIds.length > 0) this.sendPush({ scope: HOST_PUSH_SCOPE, type: 'state-changed', tabIds })
    })
  }

  pageTabIds(): number[] {
    return [...new Set([...this.pages.values()].map((page) => page.tabId))]
  }
}