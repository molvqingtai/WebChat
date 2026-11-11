import { defineProxy } from 'comctx'
import type { Channel } from './Contract'

export const RUNTIME_NAMESPACE = 'WEB_CHAT_RUNTIME_V3'
export const PAGE_NAMESPACE = 'WEB_CHAT_PAGE_V3'

const proxyOptions = { heartbeatCheck: false } as const

/** comctx over one Channel: each side provides its service and injects the other's. */
export const connectServices = <Local extends object, Remote extends object>(
  channel: Channel,
  local: { namespace: string; service: Local },
  remoteNamespace: string
): Remote => {
  const adapter = {
    sendMessage: (message: unknown) => channel.post(message),
    onMessage: (callback: (message: never) => void) => channel.onMessage((frame) => callback(frame as never))
  }
  const [provide] = defineProxy(() => local.service, { ...proxyOptions, namespace: local.namespace })
  provide(adapter)
  const [, inject] = defineProxy(() => ({}) as Remote, { ...proxyOptions, namespace: remoteNamespace })
  const remote = inject(adapter)
  // A call still pending when the channel closes would never settle; fail it instead.
  const closed = new Promise<never>((_, reject) =>
    channel.onClose(() => reject(new DOMException('Runtime channel closed', 'AbortError')))
  )
  closed.catch(() => {})
  return new Proxy({} as Remote, {
    get: (_, key) =>
      // Not thenable: an async function may return this proxy.
      key === 'then'
        ? undefined
        : (...args: unknown[]) =>
            Promise.race([(remote as Record<PropertyKey, (...args: unknown[]) => unknown>)[key]!(...args), closed])
  })
}
