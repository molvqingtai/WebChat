import { defineProxy, type Adapter } from 'comctx'
import type { Channel } from './Contract'

export const RUNTIME_NAMESPACE = 'WEB_CHAT_RUNTIME_V3'
export const PAGE_NAMESPACE = 'WEB_CHAT_PAGE_V3'

const proxyOptions = { heartbeatCheck: false } as const

/** Whatever a service method resolves to; it crosses the channel as structured-clone data. */
type RemoteResult = object | string | number | boolean | null | undefined | void
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- arguments pass through unchanged to the typed remote method
type RemoteMethod = (...args: unknown[]) => Promise<RemoteResult>

/** comctx over one Channel: each side provides its service and injects the other's. */
export const connectServices = <Local extends object, Remote extends object>(
  channel: Channel,
  local: { namespace: string; service: Local },
  remoteNamespace: string
): Remote => {
  const adapter: Adapter = {
    sendMessage: (message) => channel.post(message),
    onMessage: (callback) => channel.onMessage(callback)
  }
  const [provide] = defineProxy(() => local.service, { ...proxyOptions, namespace: local.namespace })
  provide(adapter)
  // SAFETY: the injector's factory is only used for typing; every call goes to the provider.
  const [, inject] = defineProxy(() => ({}) as Remote, { ...proxyOptions, namespace: remoteNamespace })
  const remote = inject(adapter)
  // A call still pending when the channel closes would never settle; fail it instead.
  const closed = new Promise<never>((_, reject) =>
    channel.onClose(() => reject(new DOMException('Runtime channel closed', 'AbortError')))
  )
  closed.catch(() => {})
  const call =
    (key: keyof Remote) =>
    // oxlint-disable-next-line anti-slop/no-unknown-parameters -- arguments pass through unchanged to the typed remote method
    (...args: unknown[]) => {
      // SAFETY: Remote describes a service whose members are all methods.
      const method = remote[key] as RemoteMethod
      return Promise.race([method.apply(remote, args), closed])
    }
  // SAFETY: every member of Remote is a method; this proxy returns each one wrapped by `call`.
  return new Proxy({} as Remote, {
    // Not thenable: an async function may return this proxy.
    get: (_, key) => (key === 'then' ? undefined : call(key as keyof Remote))
  })
}
