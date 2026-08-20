import { defineProxy } from 'comctx'
import type { Adapter } from 'comctx'
import { browser } from '#imports'
import type { PresenceStore } from '@/domain/runtime/externs/PresenceStore'
import { RUNTIME_NAMESPACE_PREFIX } from '@/runtime/Contract'
import type { MessageMeta } from '@/service/adapter/runtime/Provider'
import { createServer, disposeServer, type RuntimeAdmission } from '@/runtime/Server'
import { createRoomTransport } from '@/runtime/RoomTransportProvider'
import type { RoomTransport } from '@/runtime/RoomTransport'
import type { HostHandle } from '@/runtime/HostOwner'

export type { HostHandle } from '@/runtime/HostOwner'

type HostAdapter = Adapter<MessageMeta> & { dispose: () => void }

/**
 * Starts the Background-owned logical Runtime and exposes its headless server over comctx.
 * Chromium receives an injected Offscreen transport; Firefox uses its local transport directly.
 */
export const startHost = (
  adapter: HostAdapter,
  presenceStore: PresenceStore,
  transport: RoomTransport = createRoomTransport(),
  admission?: RuntimeAdmission
): HostHandle => {
  const server = createServer({
    transport,
    presenceStore,
    admission
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
