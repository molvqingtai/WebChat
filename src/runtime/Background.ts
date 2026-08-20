import { browser } from '#imports'
import { defineProxy } from 'comctx'
import { ProvideAdapter } from '@/service/adapter/runtime'
import { BackgroundInjectAdapter, type MessageApi } from '@/service/adapter/runtime/Core'
import { Coordinator, type HostEnsureResult } from '@/runtime/Coordinator'
import { HostOwner } from '@/runtime/HostOwner'
import { startHost } from '@/runtime/host'
import { createBrowserPresenceStore } from '@/runtime/PresenceStore'
import { RemoteRoomTransport } from '@/runtime/RemoteRoomTransport'
import type { RoomTransport } from '@/runtime/RoomTransport'
import { TRANSPORT_NAMESPACE_PREFIX, type TransportService } from '@/runtime/TransportHost'
import { createRoomTransport } from '@/runtime/RoomTransportProvider'

const OFFSCREEN_URL = '/offscreen.html'
const messageApi = browser.runtime as unknown as MessageApi
const presenceStore = createBrowserPresenceStore(browser.storage.session)

interface OffscreenApi {
  hasDocument?: () => Promise<boolean>
  createDocument: (options: { url: string; reasons: string[]; justification: string }) => Promise<void>
  closeDocument: () => Promise<void>
}

/**
 * MV3 workers cannot reliably own long-lived WebRTC, so Chromium uses Offscreen while Firefox MV2 uses its
 * persistent Background Page.
 * @see https://github.com/w3c/webextensions/issues/72
 * @see https://issues.chromium.org/issues/40251342
 * @see https://github.com/w3c/webrtc-extensions/issues/77
 */
const backgroundHost = new HostOwner()

const ensureOffscreenDocument = async (): Promise<HostEnsureResult> => {
  const offscreen = (globalThis as { chrome?: { offscreen?: OffscreenApi } }).chrome?.offscreen
  if (!offscreen) return { phase: 'unavailable', created: false }
  if (await offscreen.hasDocument?.()) return { phase: 'ready', created: false }
  await offscreen.createDocument({
    url: OFFSCREEN_URL,
    reasons: ['WEB_RTC'],
    justification: 'Maintain shared WebRTC connections across tabs'
  })
  return { phase: 'ready', created: true }
}

const destroyOffscreenDocument = async () => {
  const offscreen = (globalThis as { chrome?: { offscreen?: OffscreenApi } }).chrome?.offscreen
  if (offscreen && (await offscreen.hasDocument?.())) await offscreen.closeDocument()
}

const [, injectTransport] = defineProxy(() => ({}) as TransportService, {
  namespace: `${TRANSPORT_NAMESPACE_PREFIX}:${browser.runtime.id}`
})
let chromeTransport: RemoteRoomTransport | null = null

const ensureBackgroundHost = async (): Promise<HostEnsureResult> => {
  let transport: RoomTransport
  if (!import.meta.env.FIREFOX) {
    const offscreen = await ensureOffscreenDocument()
    if (offscreen.phase !== 'ready') return offscreen
    if (!chromeTransport) {
      chromeTransport = new RemoteRoomTransport(injectTransport(new BackgroundInjectAdapter(messageApi)))
      await chromeTransport.rebind()
    } else if (offscreen.created) {
      await chromeTransport.rebind()
    }
    transport = chromeTransport
  } else {
    transport = createRoomTransport()
  }
  const { created } = backgroundHost.ensure(() => startHost(new ProvideAdapter(), presenceStore, transport))
  return { phase: 'ready', created }
}

const destroyBackgroundHost = async () => {
  backgroundHost.destroy()
  chromeTransport?.dispose()
  chromeTransport = null
  if (!import.meta.env.FIREFOX) await destroyOffscreenDocument()
}

const coordinator = new Coordinator({
  storage: browser.storage.session,
  ensureHostDocument: ensureBackgroundHost,
  probeHost: async () => {
    const host = backgroundHost.server
    if (!host) throw new Error('Logical Runtime background host is unavailable')
    const snapshot = await host.getSnapshot()
    return { hostId: snapshot.hostId, phase: snapshot.hostPhase }
  },
  destroyHostDocument: destroyBackgroundHost,
  tabs: browser.tabs,
  attachPage: (lease) =>
    backgroundHost.server?.attachPage(lease) ?? Promise.reject(new Error('Runtime is unavailable')),
  detachPage: (lease) => backgroundHost.server?.detachPage(lease) ?? Promise.resolve()
})

export const ensureHost = () => coordinator.ensureHost()
export const registerPage = (lease: Parameters<typeof coordinator.registerPage>[0]) => coordinator.registerPage(lease)
export const restore = () => coordinator.restore()

export const watchTabs = () => {
  browser.tabs.onRemoved.addListener((tabId) => {
    void coordinator.removeTab(tabId).catch((error) => console.error(error))
  })
  browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (typeof changeInfo.url === 'string') {
      void coordinator.updateTab(tabId, changeInfo.url).catch((error) => console.error(error))
    }
  })
  browser.tabs.onActivated.addListener(() => {
    void coordinator.reconcile().catch((error) => console.error(error))
  })
}

/** MV3 service-worker suspension does not imply that the Offscreen document died. */
export const watchOffscreenClosed = () => coordinator.watchHost()
