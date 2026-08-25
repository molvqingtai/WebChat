import { browser } from '#imports'
import { defineProxy } from 'comctx'
import { ProvideAdapter } from '@/service/adapter/runtime'
import { BackgroundInjectAdapter, type MessageApi } from '@/service/adapter/runtime/Core'
import type { RuntimeCoordinator } from '@/runtime/Contract'
import { HostOwner } from '@/runtime/HostOwner'
import { ChromiumTransportOwner } from '@/runtime/ChromiumTransportOwner'
import { selectBackgroundTransport } from '@/runtime/BackgroundTransport'
import { startHost } from '@/runtime/host'
import { createBrowserPresenceStore } from '@/runtime/PresenceStore'
import { RemoteRoomTransport } from '@/runtime/RemoteRoomTransport'
import { notifyServerTabs, readServerSnapshot, removeServerTab } from '@/runtime/Server'
import { TRANSPORT_NAMESPACE_PREFIX, type TransportService } from '@/runtime/TransportHost'

const OFFSCREEN_URL = '/offscreen.html'
const messageApi = browser.runtime as unknown as MessageApi
const presenceStore = createBrowserPresenceStore(browser.storage.session)

interface OffscreenApi {
  hasDocument?: () => Promise<boolean>
  createDocument: (options: { url: string; reasons: string[]; justification: string }) => Promise<void>
}

/**
 * Chromium owns its logical Runtime in Background and keeps only physical WebRTC in Offscreen.
 * Firefox has no independent transport document, so the same Background owns both layers.
 */
const backgroundHost = new HostOwner()

const ensureOffscreenDocument = async (): Promise<{ phase: 'ready' | 'unavailable'; created: boolean }> => {
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

const [, injectTransport] = defineProxy(() => ({}) as TransportService, {
  namespace: `${TRANSPORT_NAMESPACE_PREFIX}:${browser.runtime.id}`
})
const chromeTransportOwner = new ChromiumTransportOwner(
  ensureOffscreenDocument,
  () => new RemoteRoomTransport(injectTransport(new BackgroundInjectAdapter(messageApi)))
)

const ensureChromeTransport = () => chromeTransportOwner.ensure()

const admission = {
  tabs: browser.tabs,
  ensureTransport: async () => {
    if (!import.meta.env.FIREFOX) await ensureChromeTransport()
  }
}

const ensureBackgroundHost = async () => {
  const transport = await selectBackgroundTransport(import.meta.env.FIREFOX, ensureChromeTransport)
  const { host } = backgroundHost.ensure(() => startHost(new ProvideAdapter(), presenceStore, transport, admission))
  readServerSnapshot(host.server)
}

export const registerPage: RuntimeCoordinator['registerPage'] = async (payload) => {
  await ensureBackgroundHost()
  const server = backgroundHost.server
  if (!server) throw new Error('Logical Runtime background host is unavailable')
  return server.attachPage(payload)
}

/**
 * Fresh Background startup rebuilds the logical shell, then issues one best-effort content-free
 * invalidation. Recovery never depends on the hint: a surviving Page registers on its next
 * invalidation and pulls the current full projection.
 */
export const restore = async () => {
  await ensureBackgroundHost()
  const server = backgroundHost.server
  if (server) notifyServerTabs(server)
}

export const watchTabs = () => {
  browser.tabs.onRemoved.addListener((tabId) => {
    const server = backgroundHost.server
    if (server) void removeServerTab(server, tabId).catch((error) => console.error(error))
  })
  browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (typeof changeInfo.url !== 'string') return
    const server = backgroundHost.server
    if (server) void removeServerTab(server, tabId, changeInfo.url).catch((error) => console.error(error))
  })
  browser.tabs.onActivated.addListener(() => {
    // Browser ingress, not Page polling, notices a lost Chromium transport while Background survives.
    void ensureBackgroundHost().catch((error) => console.error(error))
  })
}
