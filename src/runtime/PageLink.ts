import { browser } from '#imports'
import { nanoid } from 'nanoid'
import type {
  HistorySupplyEvent,
  HistorySupplyResult,
  RuntimeServer,
  RuntimeSnapshot
} from '@/runtime/Contract'
import {
  PAGE_SCOPE,
  isHostPush,
  isHostResponse,
  type HostResponse,
  type PageCall,
  type PageMessage,
  type RuntimeMethod
} from '@/runtime/Link'

const CALL_TIMEOUT_MS = 20000
const RETRY_DELAY_MS = 300

const delay = (ms: number) => new Promise<void>((resolve) => globalThis.setTimeout(resolve, ms))

const withTimeout = <Value>(task: Promise<Value>, ms: number): Promise<Value> =>
  new Promise<Value>((resolve, reject) => {
    const timer = globalThis.setTimeout(() => reject(new Error('WebChat runtime did not respond in time')), ms)
    task.then(
      (value) => {
        globalThis.clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        globalThis.clearTimeout(timer)
        reject(error)
      }
    )
  })

type StateListener = () => void

/**
 * The single Page-side Runtime link.
 *
 * Every call is one `runtime.sendMessage`. A suspended Chromium Background is started by the
 * browser before the message is delivered, so the Page never owns a connection that can silently
 * die: there is no port, no heartbeat, and no reconnect state machine. A failed delivery is
 * retried once, because the first message is exactly what starts the Background.
 */
export class PageLink implements RuntimeServer {
  readonly pageId = nanoid()
  private historyListener: ((event: HistorySupplyEvent) => void) | null = null
  private readonly stateListeners = new Set<StateListener>()

  constructor(private readonly domain: string) {
    browser.runtime.onMessage.addListener((message: unknown) => {
      if (!isHostPush(message)) return
      if (message.type === 'state-changed') {
        this.stateListeners.forEach((listener) => listener())
        return
      }
      this.historyListener?.(message.event)
    })
  }

  onStateChanged(listener: StateListener) {
    this.stateListeners.add(listener)
    return () => this.stateListeners.delete(listener)
  }

  private async send(message: PageMessage): Promise<HostResponse> {
    let lastError: unknown
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const response: unknown = await withTimeout(browser.runtime.sendMessage(message), CALL_TIMEOUT_MS)
        if (isHostResponse(response)) return response
        lastError = new Error('WebChat runtime is unavailable')
      } catch (error) {
        lastError = error
      }
      if (attempt === 0) await delay(RETRY_DELAY_MS)
    }
    throw lastError instanceof Error ? lastError : new Error('WebChat runtime is unavailable')
  }

  private async call<Value>(method: RuntimeMethod, args: unknown[]): Promise<Value> {
    const message: PageCall = {
      scope: PAGE_SCOPE,
      type: 'call',
      pageId: this.pageId,
      callId: nanoid(),
      domain: this.domain,
      method,
      args
    }
    const response = await this.send(message)
    if (!response.ok) throw new Error(response.error ?? 'WebChat runtime call failed')
    return response.value as Value
  }

  attachPage(payload: { domain: string }): Promise<RuntimeSnapshot> {
    return this.call<RuntimeSnapshot>('attachPage', [payload])
  }

  getSnapshot(payload: { domain?: string }): Promise<RuntimeSnapshot> {
    return this.call<RuntimeSnapshot>('getSnapshot', [payload])
  }

  joinChatRoom(payload: Parameters<RuntimeServer['joinChatRoom']>[0]): Promise<RuntimeSnapshot | null> {
    return this.call<RuntimeSnapshot | null>('joinChatRoom', [payload])
  }

  leaveChatRoom(payload: { domain: string }): Promise<void> {
    return this.call<void>('leaveChatRoom', [payload])
  }

  allocateTextMessage(
    payload: Parameters<RuntimeServer['allocateTextMessage']>[0]
  ): ReturnType<RuntimeServer['allocateTextMessage']> {
    return this.call('allocateTextMessage', [payload])
  }

  allocateReactionMessage(
    payload: Parameters<RuntimeServer['allocateReactionMessage']>[0]
  ): ReturnType<RuntimeServer['allocateReactionMessage']> {
    return this.call('allocateReactionMessage', [payload])
  }

  sendChatMessage(
    payload: Parameters<RuntimeServer['sendChatMessage']>[0]
  ): ReturnType<RuntimeServer['sendChatMessage']> {
    return this.call('sendChatMessage', [payload])
  }

  ackInbound(payload: { domain: string; sequence: number; inserted: boolean }): Promise<void> {
    return this.call<void>('ackInbound', [payload])
  }

  reconnectDomain(payload: { domain: string }): Promise<void | null> {
    return this.call<void | null>('reconnectDomain', [payload])
  }

  async provideHistory(payload: { domain: string }, callback: (event: HistorySupplyEvent) => void): Promise<void> {
    // The callback is a Page-local function, so it stays here; the host only receives the
    // registration and later pushes supply events back to this exact tab.
    this.historyListener = callback
    await this.call<void>('provideHistory', [payload])
  }

  resolveHistorySupply(payload: { supplyId: string; result: HistorySupplyResult }): Promise<void> {
    return this.call<void>('resolveHistorySupply', [payload])
  }

  rejectHistorySupply(payload: { supplyId: string; reason: string }): Promise<void> {
    return this.call<void>('rejectHistorySupply', [payload])
  }

  /** Fire-and-forget departure; the host also learns it from the browser tab lifecycle. */
  bye() {
    const message: PageMessage = { scope: PAGE_SCOPE, type: 'bye', pageId: this.pageId }
    void browser.runtime.sendMessage(message).catch(() => {})
  }
}