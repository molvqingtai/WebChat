import { browser } from '#imports'
import { defineProxy } from 'comctx'
import type { PresenceStore } from '@/domain/runtime/externs/PresenceStore'
import { type MessageApi } from '@/service/adapter/runtime/Core'
import { PresenceStoreInjectPortAdapter, type PresenceStorePortApi } from '@/service/adapter/runtime/PresenceStorePort'
import { ProviderAdapter } from '@/service/adapter/runtime/Provider'
import { startHost } from '@/runtime/host'
import { presenceStoreNamespace } from '@/runtime/PresenceStore'

/**
 * Chrome/Edge Offscreen Document host: lifecycle-only wrapper around the
 * shared headless Runtime. Created single-flight by the background coordinator.
 */
const messageApi = browser.runtime as unknown as MessageApi
const presenceNamespace = presenceStoreNamespace(browser.runtime.id)
const presenceStoreAdapter = new PresenceStoreInjectPortAdapter(
  browser.runtime as unknown as PresenceStorePortApi,
  presenceNamespace
)
const [, injectPresenceStore] = defineProxy<() => PresenceStore>(
  () => {
    throw new Error('PresenceStore is provided by the background context')
  },
  { namespace: presenceNamespace }
)
const presenceStore = injectPresenceStore(presenceStoreAdapter)

startHost(new ProviderAdapter(messageApi), presenceStore)
