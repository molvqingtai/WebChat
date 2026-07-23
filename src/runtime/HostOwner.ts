import type { RuntimeServer } from '@/runtime/Contract'

export interface HostHandle {
  server: RuntimeServer
  dispose: () => void
}

/** Owns the one in-context Runtime used by Firefox's persistent background page. */
export class HostOwner {
  private current: HostHandle | null = null

  ensure(createHost: () => HostHandle) {
    const created = this.current === null
    if (created) this.current = createHost()
    return { host: this.current!, created }
  }

  destroy() {
    const staleHost = this.current
    this.current = null
    staleHost?.dispose()
  }

  get server() {
    return this.current?.server ?? null
  }
}
