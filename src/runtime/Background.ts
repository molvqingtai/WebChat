import { browser } from '#imports'
import { defineProxy } from 'comctx'
import { ProvideAdapter } from '@/service/adapter/runtime'
import { BackgroundInjectAdapter, type MessageApi } from '@/service/adapter/runtime/Core'
import type { RuntimeCoordinator, RuntimeHostStatus, RuntimePageRegistration } from '@/runtime/Contract'
import { HostOwner } from '@/runtime/HostOwner'
import { startHost } from '@/runtime/host'
import { createBrowserPresenceStore } from '@/runtime/PresenceStore'
import { RemoteRoomTransport } from '@/runtime/RemoteRoomTransport'
import { removeServerTab, restoreServerPageBindings } from '@/runtime/Server'
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

const ensureOffscreenDocument = async (): Promise<{ phase: RuntimeHostStatus['phase']; created: boolean }> => {
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
let chromeTransport: RemoteRoomTransport | null = null

const ensureChromeTransport = async () => {
  const offscreen = await ensureOffscreenDocument()
  if (offscreen.phase !== 'ready') throw new Error('Chromium Offscreen transport is unavailable')
  if (!chromeTransport) {
    chromeTransport = new RemoteRoomTransport(injectTransport(new BackgroundInjectAdapter(messageApi)))
    await chromeTransport.rebind()
  } else if (offscreen.created) {
    await chromeTransport.rebind()
  }
  return chromeTransport
}

const admission = {
  tabs: browser.tabs,
  storage: browser.storage.session,
  rebindPage: (tabId: number, pageId: string) =>
    browser.tabs.sendMessage(tabId, { type: 'runtime:sessions-rebind', pageId }),
  ensureTransport: async () => {
    if (!import.meta.env.FIREFOX) await ensureChromeTransport()
  }
}

const ensureBackgroundHost = async (): Promise<{ status: RuntimeHostStatus; created: boolean }> => {
  if (!import.meta.env.FIREFOX) await ensureChromeTransport()
  const { host, created } = backgroundHost.ensure(() =>
    startHost(new ProvideAdapter(), presenceStore, import.meta.env.FIREFOX ? undefined : chromeTransport!, admission)
  )
  await host.server.getSnapshot()
  if (created) {
    // Stored browser bindings are only rebind targets after their live tab/navigation facts validate.
    // This side branch never delays the Page RPC that woke the Background.
    void restoreServerPageBindings(host.server)?.catch((error) => console.error(error))
  }
  return { status: { phase: 'ready', generation: 1 }, created }
}

export const ensureHost = async (): Promise<RuntimeHostStatus> => (await ensureBackgroundHost()).status

export const registerPage: RuntimeCoordinator['registerPage'] = async (payload): Promise<RuntimePageRegistration> => {
  const { status } = await ensureBackgroundHost()
  const server = backgroundHost.server
  if (!server) throw new Error('Logical Runtime background host is unavailable')
  const snapshot = await server.attachPage(payload)
  return { ...status, snapshot }
}

/** Fresh Background startup restores only validated Page rebind targets, never old callback closures or actions. */
export const restore = async () => {
  await ensureBackgroundHost()
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
