import type { ReadinessState } from '@/domain/externs/Readiness'
import {
  HostUnavailableError,
  type Channel,
  type HostLocator,
  type PageService,
  type RuntimeService
} from '@/runtime/core/Contract'
import { connectServices, PAGE_NAMESPACE, RUNTIME_NAMESPACE } from '@/runtime/core/Rpc'

const RETRY_MIN_MS = 100
const RETRY_MAX_MS = 5000
const READY_TIMEOUT_MS = 10000

export interface RuntimeClientOptions {
  locator: HostLocator
  service: PageService
  /** The connection to the host ended; anything derived from it is stale. */
  onDisconnect: () => void
}

/**
 * The page's connection to the Runtime. It holds no chat state: when the host goes away it
 * reconnects (waking the host), and the application replays its join once this reports ready.
 */
export const createRuntimeClient = ({ locator, service, onDisconnect }: RuntimeClientOptions) => {
  const listeners = new Set<(state: ReadinessState) => void>()
  let state: ReadinessState = 'connecting'
  let remote: RuntimeService | null = null
  let channel: Channel | null = null
  /** Bumped by start and stop; a loop from an older run stops at its next step. */
  let run = 0

  const setState = (next: ReadinessState) => {
    if (state === next) return
    state = next
    listeners.forEach((listener) => listener(next))
  }

  const onState = (listener: (state: ReadinessState) => void) => {
    listeners.add(listener)
    listener(state)
    return () => listeners.delete(listener)
  }

  const disconnect = () => {
    if (!channel) return
    channel = null
    remote = null
    onDisconnect()
  }

  const loop = async (id: number) => {
    let delay = RETRY_MIN_MS
    while (id === run) {
      const startedAt = Date.now()
      try {
        const connected = await locator.connect()
        if (id !== run) return connected.close()
        const closed = new Promise<void>((resolve) => connected.onClose(resolve))
        channel = connected
        remote = connectServices<PageService, RuntimeService>(
          connected,
          { namespace: PAGE_NAMESPACE, service },
          RUNTIME_NAMESPACE
        )
        setState('ready')
        await closed
        if (id !== run) return
        disconnect()
        setState('connecting')
      } catch (error) {
        if (id !== run) return
        if (error instanceof HostUnavailableError) return setState('unavailable')
      }
      // A host that is still starting drops the port at once; back off until a connection lasts.
      delay = Date.now() - startedAt > RETRY_MAX_MS ? RETRY_MIN_MS : Math.min(delay * 2, RETRY_MAX_MS)
      await new Promise((resolve) => setTimeout(resolve, delay))
    }
  }

  const settled = (timeoutMs?: number) =>
    new Promise<ReadinessState>((resolve) => {
      let timeout: ReturnType<typeof setTimeout> | undefined
      const stop = onState((next) => {
        if (next === 'connecting') return
        clearTimeout(timeout)
        queueMicrotask(() => stop())
        resolve(next)
      })
      if (timeoutMs !== undefined) {
        timeout = setTimeout(() => {
          stop()
          resolve('connecting')
        }, timeoutMs)
      }
    })

  return {
    onState,
    /** Resolves true once connected, or null when the host can never be reached. */
    start: async (): Promise<boolean | null> => {
      if (!channel) {
        run += 1
        setState('connecting')
        void loop(run)
      }
      return (await settled()) === 'ready' ? true : null
    },
    stop: () => {
      run += 1
      const open = channel
      disconnect()
      open?.close()
      setState('connecting')
    },
    runtime: async (): Promise<RuntimeService> => {
      if (remote) return remote
      await settled(READY_TIMEOUT_MS)
      if (!remote) throw new Error('Shared runtime unavailable')
      return remote
    }
  }
}

export type RuntimeClient = ReturnType<typeof createRuntimeClient>
