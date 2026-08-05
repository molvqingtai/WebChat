import { browser } from '#imports'
import { defineProxy } from 'comctx'
import { nanoid } from 'nanoid'
import { InjectAdapter } from '@/service/adapter/runtime'
import type { RuntimeCoordinator, RuntimeServer, RuntimeSnapshot } from '@/runtime/Contract'
import { COORDINATOR_NAMESPACE, RUNTIME_NAMESPACE_PREFIX } from '@/runtime/Contract'
import { ClientLease } from '@/runtime/ClientLease'
import { runtimeLifecycleLog } from '@/runtime/Debug'

const HEARTBEAT_TIMEOUT_MS = 5000

const proxyOptions = {
  heartbeatTimeout: HEARTBEAT_TIMEOUT_MS,
  debug: import.meta.env.DEV ? ('event' as const) : false
}

const [, injectCoordinator] = defineProxy(() => ({}) as RuntimeCoordinator, {
  ...proxyOptions,
  namespace: `${COORDINATOR_NAMESPACE}:${browser.runtime.id}`
})

const [, injectServer] = defineProxy(() => ({}) as RuntimeServer, {
  ...proxyOptions,
  namespace: `${RUNTIME_NAMESPACE_PREFIX}:${browser.runtime.id}`
})

export const pageId = nanoid()
export const pageDomain = document.location.origin
runtimeLifecycleLog('content.generation.start', { pageId })
export const coordinator = injectCoordinator(new InjectAdapter())
export const server = injectServer(new InjectAdapter())

const client = new ClientLease({
  coordinator,
  pageId,
  domain: pageDomain,
  debug: (event, details) => runtimeLifecycleLog(`content.lease.${event}`, { pageId, ...details })
})

export const whenReady = (callback: () => void) => client.whenReady(callback)
export const whenHostPhase = (callback: Parameters<typeof client.whenHostPhase>[0]) => client.whenHostPhase(callback)
export const initClient = (): Promise<RuntimeSnapshot | null> => client.init()
export const detachClient = () => client.detach()
export const getSnapshot = (): RuntimeSnapshot => client.snapshot()
