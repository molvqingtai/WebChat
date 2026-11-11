import { browser } from '#imports'
import {
  HOST_SCOPE,
  errorMessage,
  isHostRequest,
  isHostResponse,
  isPageMessage,
  type HostPush,
  type HostRequest,
  type HostResponse,
  type PageMessage
} from '@/runtime/Link'

const OFFSCREEN_URL = '/offscreen.html'
const HOST_START_TIMEOUT_MS = 5000
const HOST_POLL_INTERVAL_MS = 100

interface OffscreenApi {
  hasDocument?: () => Promise<boolean>
  createDocument: (options: { url: string; reasons: string[]; justification: string }) => Promise<void>
}

const delay = (ms: number) => new Promise<void>((resolve) => globalThis.setTimeout(resolve, ms))

const offscreenApi = (): OffscreenApi | undefined =>
  (globalThis as { chrome?: { offscreen?: OffscreenApi } }).chrome?.offscreen

interface LocalHost {
  handle: (request: HostRequest) => Promise<HostResponse>
}

let localHost: LocalHost | null = null
let hostReady: Promise<void> | null = null
let hostSendPush: ((push: HostPush) => void) | null = null

const createLocalHost = async (): Promise<LocalHost> => {
  if (localHost) return localHost
  const { createHost } = await import('@/runtime/Host')
  const host = createHost({
    sendPush: (push) => hostSendPush?.(push)
  })
  localHost = host
  return host
}

const ensureOffscreen = async () => {
  const offscreen = offscreenApi()
  if (!offscreen) throw new Error('WebChat Offscreen transport is unavailable')
  if (await offscreen.hasDocument?.()) return
  await offscreen.createDocument({
    url: OFFSCREEN_URL,
    reasons: ['WEB_RTC'],
    justification: 'Keep peer connections alive while pages are open'
  })
}

const pingHost = async (): Promise<boolean> => {
  try {
    const response: unknown = await browser.runtime.sendMessage({
      scope: HOST_SCOPE,
      type: 'ping'
    } satisfies HostRequest)
    return isHostResponse(response) && response.ok
  } catch {
    return false
  }
}

const ensureHost = async (): Promise<void> => {
  if (hostReady) return hostReady
  hostReady = (async () => {
    if (import.meta.env.FIREFOX) {
      await createLocalHost()
      return
    }
    await ensureOffscreen()
    const deadline = Date.now() + HOST_START_TIMEOUT_MS
    while (!(await pingHost())) {
      if (Date.now() > deadline) throw new Error('WebChat runtime host did not start')
      await delay(HOST_POLL_INTERVAL_MS)
    }
  })().catch((error) => {
    hostReady = null
    throw error
  })
  return hostReady
}

const callHost = async (request: HostRequest): Promise<HostResponse> => {
  if (import.meta.env.FIREFOX) {
    const host = await createLocalHost()
    return host.handle(request)
  }
  const response: unknown = await browser.runtime.sendMessage(request)
  if (!isHostResponse(response)) throw new Error('WebChat runtime host returned no response')
  return response
}

/**
 * One page message is one delivery attempt. The message itself starts a suspended Background;
 * a missing or restarted host is recreated and the same call is retried exactly once.
 */
const dispatch = async (message: PageMessage, tabId: number, url?: string): Promise<HostResponse> => {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await ensureHost()
      return await callHost({
        scope: HOST_SCOPE,
        type: 'call',
        tabId,
        url,
        message
      })
    } catch (error) {
      hostReady = null
      if (attempt === 1) return { ok: false, error: errorMessage(error) }
    }
  }
  return { ok: false, error: 'WebChat runtime is unavailable' }
}

/** Browser→Page delivery. The host addresses pushes by tab id and never owns a Page port. */
const forwardPush = (push: HostPush) => {
  if (push.type === 'history') {
    void browser.tabs.sendMessage(push.tabId, push).catch(() => {})
    return
  }
  for (const tabId of push.tabIds) {
    void browser.tabs.sendMessage(tabId, push).catch(() => {})
  }
}

hostSendPush = forwardPush

const notifyTabGone = async (tabId: number) => {
  try {
    await ensureHost()
    await callHost({ scope: HOST_SCOPE, type: 'tab-gone', tabId })
  } catch {
    // A host that is not running has no page bindings to clean up.
  }
}

/**
 * The Background is a stateless browser-event router. It owns no Rooms, Sessions, pages, retries,
 * or generations; its only job is to hand current browser facts to the host and to route the
 * host's content-free invalidations back to the exact tabs.
 */
export const installRuntimeRouter = () => {
  browser.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
    // Host-directed messages are answered by the Offscreen host, never by the router.
    if (isHostRequest(message)) return false
    if (!isPageMessage(message)) return
    if (typeof sender.tab?.id !== 'number') return false

    if (message.type === 'bye') {
      void dispatch(message, sender.tab.id, sender.tab.url)
      return false
    }

    void dispatch(message, sender.tab.id, sender.tab.url).then(sendResponse)
    return true
  })

  browser.tabs.onRemoved.addListener((tabId) => {
    void notifyTabGone(tabId)
  })

  browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (typeof changeInfo.url !== 'string') return
    void notifyTabGone(tabId)
  })
}