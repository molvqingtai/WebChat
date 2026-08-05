import { browser } from '#imports'
import { defineProxy } from 'comctx'
import type { PresenceStore } from '@/domain/runtime/externs/PresenceStore'
import type { RuntimeServer } from '@/runtime/Contract'
import { RUNTIME_NAMESPACE_PREFIX } from '@/runtime/Contract'
import { ProvideAdapter, relayOffscreenProviderMessages, type RelayRejection } from '@/service/adapter/runtime'
import { BackgroundInjectAdapter, type MessageApi } from '@/service/adapter/runtime/Core'
import {
  PresenceStoreProviderPortAdapter,
  type PresenceStorePortApi
} from '@/service/adapter/runtime/PresenceStorePort'
import { Coordinator, type HostEnsureResult } from '@/runtime/Coordinator'
import { HostOwner } from '@/runtime/HostOwner'
import { startHost } from '@/runtime/host'
import { createBrowserPresenceStore, presenceStoreNamespace } from '@/runtime/PresenceStore'
import poll from '@/utils/poll'
import { runtimeErrorName, runtimeLifecycleLog } from '@/runtime/Debug'

const OFFSCREEN_URL = '/offscreen.html'
const HEARTBEAT_TIMEOUT_MS = 5000
const messageApi = browser.runtime as unknown as MessageApi
const portApi = browser.runtime as unknown as PresenceStorePortApi
const runtimeNamespace = `${RUNTIME_NAMESPACE_PREFIX}:${browser.runtime.id}`
const presenceNamespace = presenceStoreNamespace(browser.runtime.id)
const presenceStore = createBrowserPresenceStore(browser.storage.session)

const [providePresenceStore] = defineProxy<() => PresenceStore>(() => presenceStore, {
  namespace: presenceNamespace
})
if (!import.meta.env.FIREFOX) {
  providePresenceStore(
    new PresenceStoreProviderPortAdapter(portApi, {
      portName: presenceNamespace,
      offscreenUrl: browser.runtime.getURL(OFFSCREEN_URL),
      onError: (error) => console.warn('[WebChat] PresenceStore port failure:', error)
    })
  )
}

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

const ensureOffscreenHost = async (): Promise<HostEnsureResult> => {
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

const destroyOffscreenHost = async () => {
  const offscreen = (globalThis as { chrome?: { offscreen?: OffscreenApi } }).chrome?.offscreen
  if (offscreen && (await offscreen.hasDocument?.())) await offscreen.closeDocument()
}

const ensureBackgroundHost = async (): Promise<HostEnsureResult> => {
  const { created } = backgroundHost.ensure(() => startHost(new ProvideAdapter(), presenceStore))
  return { phase: 'ready', created }
}

const destroyBackgroundHost = async () => {
  backgroundHost.destroy()
}

const [, injectServer] = defineProxy(() => ({}) as RuntimeServer, {
  heartbeatTimeout: HEARTBEAT_TIMEOUT_MS,
  debug: import.meta.env.DEV ? ('event' as const) : false,
  namespace: runtimeNamespace
})
const server = injectServer(new BackgroundInjectAdapter(messageApi))

const coordinator = new Coordinator({
  storage: browser.storage.session,
  ensureHostDocument: import.meta.env.FIREFOX ? ensureBackgroundHost : ensureOffscreenHost,
  probeHost: async (startup) => {
    // Only a newly created MV3 Offscreen document needs startup polling; existing hosts must answer immediately.
    const probe = async () => {
      const host = import.meta.env.FIREFOX ? backgroundHost.server : server
      if (!host) throw new Error('Runtime background host is unavailable')
      const snapshot = await host.getSnapshot()
      return { hostId: snapshot.hostId, phase: snapshot.hostPhase }
    }
    return startup && !import.meta.env.FIREFOX ? poll(probe, { timeoutMs: 15000, intervalMs: 250 }) : probe()
  },
  destroyHostDocument: import.meta.env.FIREFOX ? destroyBackgroundHost : destroyOffscreenHost,
  tabs: browser.tabs,
  attachPage: (lease) =>
    import.meta.env.FIREFOX && backgroundHost.server
      ? backgroundHost.server.attachPage(lease)
      : server.attachPage(lease),
  detachPage: (lease) =>
    import.meta.env.FIREFOX && backgroundHost.server
      ? backgroundHost.server.detachPage(lease)
      : server.detachPage(lease)
})

export const ensureHost = () => coordinator.ensureHost()
export const registerPage = async (lease: Parameters<typeof coordinator.registerPage>[0]) => {
  runtimeLifecycleLog('background.register.start', {
    pageId: lease.pageId,
    tabId: lease.tab?.id ?? null
  })
  try {
    const registration = await coordinator.registerPage(lease)
    runtimeLifecycleLog('background.register.response', {
      pageId: lease.pageId,
      generation: registration.generation,
      hostId: registration.snapshot.hostId,
      hostPhase: registration.snapshot.hostPhase
    })
    return registration
  } catch (error) {
    runtimeLifecycleLog('background.register.error', { pageId: lease.pageId, ...runtimeErrorName(error) })
    throw error
  }
}
export const restore = () => coordinator.restore()

export const watchTabs = () => {
  browser.tabs.onRemoved.addListener((tabId) => void coordinator.removeTab(tabId))
  browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (typeof changeInfo.url === 'string') void coordinator.updateTab(tabId, changeInfo.url)
  })
  browser.tabs.onActivated.addListener(() => void coordinator.reconcile())
}

/** MV3 service-worker suspension does not imply that the Offscreen document died. */
export const watchOffscreenClosed = () => coordinator.watchHost()

export const relayOffscreenMessages = () =>
  relayOffscreenProviderMessages({
    runtime: browser.runtime,
    tabs: browser.tabs,
    namespace: runtimeNamespace,
    offscreenUrl: browser.runtime.getURL(OFFSCREEN_URL),
    onRejected: (rejection: RelayRejection) => console.warn('[WebChat] Dropped Offscreen Runtime relay:', rejection)
  })
