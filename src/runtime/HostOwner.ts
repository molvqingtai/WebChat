import type { RuntimeServer } from '@/runtime/Contract'

export interface HostHandle {
  server: RuntimeServer
  dispose: () => void
}

/** Owns the one logical Runtime for the current Background execution context. */
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
