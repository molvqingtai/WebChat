import { describe, expect, it, vi } from 'vitest'
import { defineProxy, type Message } from 'comctx'
import type { HostPhase, RuntimeCoordinator, RuntimeSnapshot } from '@/runtime/Contract'
import { ClientLease } from '@/runtime/ClientLease'
import { InjectAdapter, ownInjectRejections } from '@/service/adapter/runtime'
import type { MessageApi } from '@/service/adapter/runtime/Core'

const wait = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds))

describe('content Runtime rejection ownership', () => {
  it('settles the first registration failure as unavailable without terminal classification', async () => {
    const nativeError = new Error('Extension context invalidated.')
    const listeners = new Set<(...args: unknown[]) => unknown>()
    const runtime: MessageApi = {
      id: 'test-extension',
      sendMessage: vi.fn((_extensionId: unknown, payload: unknown) => {
        const message = payload as Message
        if (message.type === 'apply') return Promise.reject(nativeError)
        const response: Message = {
          ...message,
          type: 'pong',
          sender: { type: 'provider' }
        }
        queueMicrotask(() => listeners.forEach((listener) => listener(response)))
        return Promise.resolve()
      }),
      onMessage: {
        addListener: (listener) => listeners.add(listener),
        removeListener: (listener) => listeners.delete(listener)
      }
    }
    const unhandled: unknown[] = []
    const onUnhandled = (event: PromiseRejectionEvent) => {
      event.preventDefault()
      unhandled.push(event.reason)
    }
    window.addEventListener('unhandledrejection', onUnhandled)
    const [, injectCoordinator] = defineProxy(() => ({}) as RuntimeCoordinator, {
      namespace: 'content-initial-rejection-ownership',
      heartbeatInterval: 5,
      heartbeatTimeout: 30
    })
    const coordinator = injectCoordinator(new InjectAdapter(runtime))
    const logError = vi.fn()
    const phases: HostPhase[] = []
    const client = new ClientLease({
      coordinator,
      pageId: 'page-a',
      domain: 'https://example.test',
      logError
    })
    const releaseRejectionOwner = ownInjectRejections((error) => client.observeTransportRejection(error))
    const releasePhase = client.whenHostPhase((phase) => phases.push(phase))

    try {
      await expect(client.init()).rejects.toBe(nativeError)
      await wait(0)

      expect(unhandled).toEqual([])
      expect(logError).not.toHaveBeenCalled()
      expect(phases).toEqual(['none', 'connecting', 'unavailable'])
      const replayed = vi.fn()
      client.whenHostPhase(replayed)
      expect(replayed).toHaveBeenCalledWith('unavailable')
    } finally {
      releasePhase()
      client.detach()
      releaseRejectionOwner()
      window.removeEventListener('unhandledrejection', onUnhandled)
    }
  })

  it('does not expose ignored heartbeat send failures as unhandled rejections', async () => {
    const nativeError = new Error('Extension context invalidated.')
    const listeners = new Set<(...args: unknown[]) => unknown>()
    const snapshot: RuntimeSnapshot = {
      hostId: 'host-a',
      hostPhase: 'ready',
      peerId: 'peer-a',
      domains: [
        {
          domain: 'https://example.test',
          phase: 'active',
          pageIds: ['page-a'],
          chatRoomJoined: true,
          sessions: []
        }
      ],
      world: { joined: true, peerId: 'peer-a', presences: [] }
    }
    let invalidated = false
    const runtime: MessageApi = {
      id: 'test-extension',
      sendMessage: vi.fn((_extensionId: unknown, payload: unknown) => {
        if (invalidated) return Promise.reject(nativeError)
        const message = payload as Message
        const response: Message = {
          ...message,
          type: message.type === 'ping' ? 'pong' : 'apply',
          sender: { type: 'provider' },
          data: message.type === 'apply' ? { phase: 'ready', generation: 1, snapshot } : undefined
        }
        queueMicrotask(() => listeners.forEach((listener) => listener(response)))
        return Promise.resolve()
      }),
      onMessage: {
        addListener: (listener) => listeners.add(listener),
        removeListener: (listener) => listeners.delete(listener)
      }
    }
    const unhandled: unknown[] = []
    const onUnhandled = (event: PromiseRejectionEvent) => {
      event.preventDefault()
      unhandled.push(event.reason)
    }
    window.addEventListener('unhandledrejection', onUnhandled)
    const [, injectCoordinator] = defineProxy(() => ({}) as RuntimeCoordinator, {
      namespace: 'content-rejection-ownership',
      heartbeatInterval: 5,
      heartbeatTimeout: 30
    })
    const coordinator = injectCoordinator(new InjectAdapter(runtime))
    const logError = vi.fn()
    const phases: HostPhase[] = []
    const client = new ClientLease({
      coordinator,
      pageId: 'page-a',
      domain: 'https://example.test',
      startupTimeoutMs: 200,
      startupRetryIntervalMs: 20,
      watchdogIntervalMs: 60000,
      logError
    })
    const releaseRejectionOwner = ownInjectRejections((error) => client.observeTransportRejection(error))
    client.whenHostPhase((phase) => phases.push(phase))

    try {
      await expect(client.init()).resolves.toEqual(snapshot)
      phases.length = 0
      invalidated = true

      await client.checkNow()
      await wait(0)

      expect(unhandled).toEqual([])
      expect(logError).toHaveBeenCalledOnce()
      expect((logError.mock.calls[0][0] as Error).message).toMatch(
        /Extension context invalidated\.|Runtime control-plane request timed out/
      )
      expect(phases).toEqual(['connecting', 'unavailable'])

      await expect(coordinator.registerPage({ domain: 'https://example.test', pageId: 'page-a' })).rejects.toThrow(
        'Provider unavailable: heartbeat check timeout 30ms.'
      )
      await wait(0)

      expect(unhandled).toEqual([])
      expect(logError).toHaveBeenCalledOnce()
      expect(phases).toHaveLength(2)
      const replayed = vi.fn()
      client.whenHostPhase(replayed)
      expect(replayed).toHaveBeenCalledWith('unavailable')
    } finally {
      client.detach()
      releaseRejectionOwner()
      window.removeEventListener('unhandledrejection', onUnhandled)
    }
  })
})
