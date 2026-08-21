import { browser } from '#imports'
import { defineProxy } from 'comctx'
import { nanoid } from 'nanoid'
import { InjectAdapter, ownInjectRejections } from '@/service/adapter/runtime'
import type { RuntimeCoordinator, RuntimeServer, RuntimeSnapshot } from '@/runtime/Contract'
import { COORDINATOR_NAMESPACE, RUNTIME_NAMESPACE_PREFIX } from '@/runtime/Contract'
import { ClientLease } from '@/runtime/ClientLease'

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
export const coordinator = injectCoordinator(new InjectAdapter())
const rawServer = injectServer(new InjectAdapter())

const client = new ClientLease({ coordinator, pageId, domain: pageDomain })
ownInjectRejections((error) => client.observeTransportRejection(error))

const bindPage = <Payload extends object>(payload: Payload) => ({
  ...payload,
  pageId,
  runtimeHostId: client.runtimeHostId()
})

/** Every Page-facing Runtime call carries its current logical binding. Browser caller facts are added by Provider. */
export const server: RuntimeServer = {
  attachPage: (payload) => rawServer.attachPage(bindPage(payload)),
  detachPage: (payload) => rawServer.detachPage(bindPage(payload)),
  getSnapshot: () => rawServer.getSnapshot(),
  joinChatRoom: (payload) => rawServer.joinChatRoom(bindPage(payload)),
  leaveChatRoom: (payload) => rawServer.leaveChatRoom(bindPage(payload)),
  allocateTextMessage: (payload) => rawServer.allocateTextMessage(bindPage(payload)),
  allocateReactionMessage: (payload) => rawServer.allocateReactionMessage(bindPage(payload)),
  sendChatMessage: (payload) => rawServer.sendChatMessage(bindPage(payload)),
  ackInbound: (payload) => rawServer.ackInbound(bindPage(payload)),
  replayInbound: (payload) => rawServer.replayInbound(bindPage(payload)),
  reconnectDomain: (payload) => rawServer.reconnectDomain(bindPage(payload)),
  onInbound: (payload, callback) => rawServer.onInbound(bindPage(payload), callback),
  onSessionEvent: (payload, callback) => rawServer.onSessionEvent(bindPage(payload), callback),
  onWorldPresence: (payload, callback) => rawServer.onWorldPresence(bindPage(payload), callback),
  onError: (payload, callback) => rawServer.onError(bindPage(payload), callback),
  onHistoryFeedback: (payload, callback) => rawServer.onHistoryFeedback(bindPage(payload), callback),
  provideHistory: (payload, callback) => rawServer.provideHistory(bindPage(payload), callback),
  resolveHistorySupply: (payload) => rawServer.resolveHistorySupply(bindPage(payload)),
  rejectHistorySupply: (payload) => rawServer.rejectHistorySupply(bindPage(payload))
}

browser.runtime.onMessage.addListener((message: unknown) => {
  if (
    !message ||
    typeof message !== 'object' ||
    (message as { type?: unknown }).type !== 'runtime:sessions-rebind' ||
    (message as { pageId?: unknown }).pageId !== pageId
  ) {
    return
  }
  return client.rebind()
})

export const whenReady = (callback: () => void) => client.whenReady(callback)
/** Page-internal attachment phase: ChatRoom/WorldRoom register here; their tasks settle before ready. */
export const whenAttach = (callback: () => void | Promise<void>) => client.whenAttach(callback)
export const whenHostPhase = (callback: Parameters<typeof client.whenHostPhase>[0]) => client.whenHostPhase(callback)
export const whenFailure = (callback: Parameters<typeof client.whenFailure>[0]) => client.whenFailure(callback)
export const initClient = (): Promise<RuntimeSnapshot | null> => client.init()
export const detachClient = () => client.detach()
export const getSnapshot = (): RuntimeSnapshot => client.snapshot()
