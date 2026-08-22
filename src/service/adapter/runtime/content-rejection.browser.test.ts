import { describe, expect, it, vi } from 'vitest'
import { defineProxy, type Message } from 'comctx'
import type { HostPhase, RuntimeCoordinator, RuntimeServer, RuntimeSnapshot } from '@/runtime/Contract'
import { DocumentClient } from '@/runtime/DocumentClient'
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
    const failures: Error[] = []
    const phases: HostPhase[] = []
    const client = new DocumentClient({
      coordinator,
      server: {
        getSnapshot: async () => {
          throw new Error('not used')
        }
      } as never,
      domain: 'https://example.test'
    })
    const releaseRejectionOwner = ownInjectRejections(() => {})
    const releasePhase = client.whenHostPhase((phase) => phases.push(phase))
    const releaseFailure = client.whenFailure((error) => failures.push(error))

    try {
      await expect(client.init()).rejects.toBe(nativeError)
      await wait(0)

      expect(unhandled).toEqual([])
      expect(failures).toEqual([nativeError])
      expect(phases).toEqual(['none', 'connecting', 'unavailable'])
      const replayed = vi.fn()
      client.whenHostPhase(replayed)
      expect(replayed).toHaveBeenCalledWith('unavailable')
    } finally {
      releasePhase()
      releaseFailure()
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
          tabIds: [1],
          inbound: [],
          historyFeedback: [],
          chatRoomJoined: true,
          sessions: []
        }
      ],
      world: { joined: true, peerId: 'peer-a', presences: [] },
      failures: []
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
          data: message.type === 'apply' ? { snapshot } : undefined
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
    const failures: string[] = []
    const phases: HostPhase[] = []
    const [, injectServer] = defineProxy(() => ({}) as RuntimeServer, {
      namespace: 'content-heartbeat-rejection-server',
      heartbeatInterval: 5,
      heartbeatTimeout: 30
    })
    const server = injectServer(new InjectAdapter(runtime))
    const client = new DocumentClient({
      coordinator,
      server,
      domain: 'https://example.test'
    })
    const releaseRejectionOwner = ownInjectRejections(() => {})
    client.whenHostPhase((phase) => phases.push(phase))
    const releaseFailure = client.whenFailure((error) => failures.push(error.message))

    try {
      await expect(client.init()).resolves.toEqual(snapshot)
      phases.length = 0
      invalidated = true

      client.invalidate()
      await vi.waitFor(() => expect(phases).toEqual(['unavailable']))
      await wait(0)

      expect(unhandled).toEqual([])
      expect(failures).toHaveLength(1)
      expect(failures[0]).toMatch(
        /Extension context invalidated\.|Runtime control-plane request timed out|Provider unavailable: heartbeat check timeout 30ms\./
      )
      expect(phases).toEqual(['unavailable'])

      await expect(coordinator.registerPage({ domain: 'https://example.test' })).rejects.toThrow(
        'Provider unavailable: heartbeat check timeout 30ms.'
      )
      await wait(0)

      expect(unhandled).toEqual([])
      expect(failures).toHaveLength(1)
      expect(phases).toEqual(['unavailable'])
      const replayed = vi.fn()
      client.whenHostPhase(replayed)
      expect(replayed).toHaveBeenCalledWith('unavailable')
    } finally {
      releaseFailure()
      client.detach()
      releaseRejectionOwner()
      window.removeEventListener('unhandledrejection', onUnhandled)
    }
  })
})
