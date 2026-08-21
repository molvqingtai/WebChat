import { browser } from '#imports'
import { defineProxy } from 'comctx'
import { type MessageApi } from '@/service/adapter/runtime/Core'
import { ProviderAdapter } from '@/service/adapter/runtime/Provider'
import { createTransportService, TRANSPORT_NAMESPACE_PREFIX, type TransportService } from '@/runtime/TransportHost'

/**
 * Chrome/Edge Offscreen Document: physical WebRTC transport only. Logical Runtime
 * state, page callbacks, and domain lifecycle remain in the Background authority.
 */
const messageApi = browser.runtime as unknown as MessageApi
const [provideTransport] = defineProxy<() => TransportService>(() => createTransportService(), {
  namespace: `${TRANSPORT_NAMESPACE_PREFIX}:${browser.runtime.id}`
})
provideTransport(new ProviderAdapter(messageApi))
