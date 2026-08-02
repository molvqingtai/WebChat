import { defineProxy } from 'comctx'
import type { Adapter } from 'comctx'
import { browser } from '#imports'
import type { PresenceStore } from '@/domain/runtime/externs/PresenceStore'
import { RUNTIME_NAMESPACE_PREFIX } from '@/runtime/Contract'
import type { MessageMeta } from '@/service/adapter/runtime/Provider'
import { createServer, disposeServer } from '@/runtime/Server'
import { createArticoRoomTransport } from '@/runtime/ArticoRoomTransport'
import type { HostHandle } from '@/runtime/HostOwner'

export type { HostHandle } from '@/runtime/HostOwner'

type HostAdapter = Adapter<MessageMeta> & { dispose: () => void }

/**
 * Shared host bootstrap. Both hosts (Chrome/Edge Offscreen Document and the
 * Firefox long-lived Background Page) adapt their own messaging capability
 * and expose the same headless RuntimeServer over comctx.
 */
export const startHost = (adapter: HostAdapter, presenceStore: PresenceStore): HostHandle => {
  const server = createServer({
    transport: createArticoRoomTransport(),
    presenceStore
  })
  const [provideRuntime] = defineProxy(() => server, {
    namespace: `${RUNTIME_NAMESPACE_PREFIX}:${browser.runtime.id}`
  })
  provideRuntime(adapter)

  let disposed = false
  return {
    server,
    dispose: () => {
      if (disposed) return
      disposed = true
      try {
        adapter.dispose()
      } finally {
        disposeServer(server)
      }
    }
  }
}
