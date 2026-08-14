import { describe, expect, it, vi } from 'vitest'
import type { RuntimeServer } from '@/runtime/Contract'
import { BackgroundInjectAdapter, MessageListenerRegistry } from '@/service/adapter/runtime/Core'
import { HostOwner, type HostHandle } from '@/runtime/HostOwner'

const createMessaging = () => {
  const listeners = new Set<(...args: unknown[]) => unknown>()
  const sendMessage = vi.fn()
  return {
    runtime: {
      id: 'test-extension',
      sendMessage,
      onMessage: {
        addListener: (listener: (...args: unknown[]) => unknown) => listeners.add(listener),
        removeListener: (listener: (...args: unknown[]) => unknown) => listeners.delete(listener)
      }
    },
    listeners,
    sendMessage
  }
}

describe('Runtime production host boundaries', () => {
  it('sends a Chrome background probe without reading a DOM location', () => {
    vi.stubGlobal('document', undefined)
    const { runtime, sendMessage } = createMessaging()
    const adapter = new BackgroundInjectAdapter(runtime)
    expect(globalThis.document).toBeUndefined()

    adapter.sendMessage({ meta: { tab: { url: 'content-only' } } } as never, [])

    expect(sendMessage).toHaveBeenCalledWith('test-extension', { meta: {} })
    vi.unstubAllGlobals()
  })

  it('disposes every comctx provider listener owned by a host adapter', () => {
    const listeners = new MessageListenerRegistry()
    const activeListeners = new Set(['runtime-provider', 'runtime-callback'])
    // functional-loop: owner-commit — ordered per-item external effects with no bulk primitive
    for (const listener of activeListeners) {
      listeners.add(() => activeListeners.delete(listener))
    }
    listeners.dispose()

    expect(activeListeners.size).toBe(0)
  })

  it('swaps one Firefox background host only after fully disposing the old owner', () => {
    const owner = new HostOwner()
    const active = { providers: 0, transports: 0, servers: 0 }
    let createdHosts = 0
    const createHost = (): HostHandle => {
      createdHosts += 1
      active.providers += 1
      active.transports += 1
      active.servers += 1
      let disposed = false
      return {
        server: {} as RuntimeServer,
        dispose: () => {
          if (disposed) return
          disposed = true
          active.providers -= 1
          active.transports -= 1
          active.servers -= 1
        }
      }
    }

    expect(owner.ensure(createHost).created).toBe(true)
    expect(owner.ensure(createHost).created).toBe(false)
    expect({ active, createdHosts }).toEqual({
      active: { providers: 1, transports: 1, servers: 1 },
      createdHosts: 1
    })

    owner.destroy()
    expect(active).toEqual({ providers: 0, transports: 0, servers: 0 })
    expect(owner.server).toBeNull()

    expect(owner.ensure(createHost).created).toBe(true)
    expect({ active, createdHosts }).toEqual({
      active: { providers: 1, transports: 1, servers: 1 },
      createdHosts: 2
    })
  })
})
