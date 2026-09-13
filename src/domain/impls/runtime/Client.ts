import { browser } from '#imports'
import { defineProxy } from 'comctx'
import { InjectAdapter, ownInjectRejections } from '@/service/adapter/runtime'
import type { RuntimeCoordinator, RuntimeServer, RuntimeSnapshot } from '@/runtime/Contract'
import { COORDINATOR_NAMESPACE, RUNTIME_NAMESPACE_PREFIX, STATE_CHANGED_MESSAGE_TYPE } from '@/runtime/Contract'
import { DocumentClient, type ProjectionApplier } from '@/runtime/DocumentClient'

const proxyOptions = {
  heartbeatTimeout: 5000,
  debug: import.meta.env.DEV ? ('event' as const) : false
}

// SAFETY: the proxy factory placeholder is replaced by the injected RuntimeCoordinator implementation.
const [, injectCoordinator] = defineProxy(() => ({}) as RuntimeCoordinator, {
  ...proxyOptions,
  namespace: `${COORDINATOR_NAMESPACE}:${browser.runtime.id}`
})

// SAFETY: the proxy factory placeholder is replaced by the injected RuntimeServer implementation.
const [, injectServer] = defineProxy(() => ({}) as RuntimeServer, {
  ...proxyOptions,
  namespace: `${RUNTIME_NAMESPACE_PREFIX}:${browser.runtime.id}`
})

export const pageDomain = document.location.origin
const coordinator = injectCoordinator(new InjectAdapter())
const rawServer = injectServer(new InjectAdapter())

const client = new DocumentClient({ coordinator, server: rawServer, domain: pageDomain })
// Residual inject rejections (e.g. a History-supply callback proxy) are diagnostic only; they
// never control the drain lifecycle.
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- residual inject rejections are untyped
ownInjectRejections((error) => console.error(error))

// The state-changed listener is installed at module evaluation, before any read can start. The
// notification is a content-free invalidation: it only marks the sole document-local drain dirty
// and starts or joins it. It never carries or applies state.
// SAFETY: the cast probes one optional field of the runtime message payload.
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- runtime message payloads are untyped
browser.runtime.onMessage.addListener((message: unknown) => {
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- structural discrimination of the runtime message payload
  if (!message || typeof message !== 'object' || (message as { type?: unknown }).type !== STATE_CHANGED_MESSAGE_TYPE) {
    return
  }
  client.invalidate()
})

/** Every Page-facing Runtime call is an ordinary request/response; the provider adapter adds browser caller facts. */
export const server: RuntimeServer = rawServer

export const whenReady = (callback: () => void) => client.whenReady(callback)
export const whenHostPhase = (callback: Parameters<typeof client.whenHostPhase>[0]) => client.whenHostPhase(callback)
export const whenFailure = (callback: Parameters<typeof client.whenFailure>[0]) => client.whenFailure(callback)
export const initClient = (): Promise<RuntimeSnapshot | null> => client.init()
export const checkClientVisibility = (): Promise<RuntimeSnapshot | null> => client.checkVisibility()
export const refreshClient = (): Promise<RuntimeSnapshot | null> => client.refresh()
export const detachClient = () => client.detach()
export const getSnapshot = (): RuntimeSnapshot => client.snapshot()
export const registerApplier = (stage: 'chat' | 'persistence' | 'world', applier: ProjectionApplier) =>
  client.registerApplier(stage, applier)
