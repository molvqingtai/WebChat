import { describe, expect, it, vi } from 'vitest'
import type { Message } from 'comctx'
import { InjectAdapter, ownInjectRejections } from '@/service/adapter/runtime'
import { BackgroundInjectAdapter } from '@/service/adapter/runtime/Core'
import { ProviderAdapter, type MessageMeta } from '@/service/adapter/runtime/Provider'
import { TabsProviderAdapter } from '@/service/adapter/runtime/Tabs'

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

const providerMessage = (id: string, overrides: Partial<Message<MessageMeta>> = {}): Message<MessageMeta> => ({
  type: 'apply',
  sender: { type: 'provider' },
  id,
  path: ['getSnapshot'],
  meta: { tab: { id: 7, url: 'https://example.com/' } },
  namespace: 'WEB_CHAT_RUNTIME_V2:test-extension',
  timeStamp: 1,
  data: {},
  ...overrides
})

describe('Runtime browser adapters', () => {
  it('preserves the native Runtime rejection through the content InjectAdapter seam', async () => {
    const { runtime, sendMessage } = createMessaging()
    const nativeError = new Error('Extension context invalidated.')
    const nativePromise = Promise.reject(nativeError)
    sendMessage.mockReturnValueOnce(nativePromise)
    const owner = vi.fn()
    const releaseOwner = ownInjectRejections(owner)
    const adapter = new InjectAdapter(runtime)

    try {
      const sending = adapter.sendMessage(providerMessage('native-rejection'), [])
      expect(sending).toBe(nativePromise)
      await expect(sending).rejects.toBe(nativeError)
      expect(owner).toHaveBeenCalledOnce()
      expect(owner).toHaveBeenCalledWith(nativeError)
    } finally {
      releaseOwner()
    }
  })

  it('keeps the Offscreen transport provider on runtime messaging without a tabs capability', () => {
    const { runtime, listeners, sendMessage } = createMessaging()
    const adapter = new ProviderAdapter(runtime)
    const received = vi.fn()
    adapter.onMessage(received)

    const request = providerMessage('request', { sender: { type: 'injector' }, meta: {} })
    listeners.forEach((listener) => listener(request, { tab: { id: 7, url: 'https://example.com/' } } as never))
    adapter.sendMessage(providerMessage('response'), [])

    expect(received).toHaveBeenCalledWith({
      ...request,
      meta: { tab: { id: 7, url: 'https://example.com/' } }
    })

    const backgroundRequest = providerMessage('background-request', {
      sender: { type: 'injector' },
      meta: {}
    })
    listeners.forEach((listener) => listener(backgroundRequest, { url: 'chrome-extension://test/background.js' }))
    expect(received).toHaveBeenLastCalledWith(backgroundRequest)
    expect(sendMessage).toHaveBeenCalledWith(providerMessage('response'))

    adapter.dispose()
    expect(listeners.size).toBe(0)
  })

  it('adds extension sender metadata as the unforgeable caller for every Page RPC', () => {
    const { runtime, listeners } = createMessaging()
    const adapter = new ProviderAdapter(runtime)
    const received = vi.fn()
    adapter.onMessage(received)
    const claimedLease = {
      domain: 'https://example.com',
      pageId: 'page-a',
      tab: { id: 99, url: 'https://forged.example/' }
    }
    const request = providerMessage('register-page', {
      sender: { type: 'injector' },
      path: ['registerPage'],
      args: [claimedLease],
      meta: { tab: claimedLease.tab }
    })
    const trustedTab = { id: 7, url: 'https://example.com/' }

    listeners.forEach((listener) => listener(request, { tab: trustedTab } as never))

    expect(received).toHaveBeenCalledWith({
      ...request,
      args: [{ ...claimedLease, caller: { tab: trustedTab } }],
      meta: { tab: trustedTab }
    })

    // The caller-bearing current-state read gets the same unforgeable injection.
    const read = providerMessage('read-caller', {
      sender: { type: 'injector' },
      path: ['getSnapshot'],
      args: [{ domain: 'https://example.com' }]
    })
    listeners.forEach((listener) => listener(read, { tab: trustedTab } as never))
    expect(received).toHaveBeenLastCalledWith({
      ...read,
      args: [{ domain: 'https://example.com', caller: { tab: trustedTab } }],
      meta: { tab: trustedTab }
    })

    const mutation = providerMessage('mutation-caller', {
      sender: { type: 'injector' },
      path: ['sendChatMessage'],
      args: [{ domain: 'https://example.com', caller: { tab: claimedLease.tab } }]
    })
    listeners.forEach((listener) => listener(mutation, { tab: trustedTab } as never))
    expect(received).toHaveBeenLastCalledWith({
      ...mutation,
      args: [{ domain: 'https://example.com', caller: { tab: trustedTab } }],
      meta: { tab: trustedTab }
    })
    adapter.dispose()
  })

  it('keeps Firefox/background providers on the existing tabs-capable route', async () => {
    const { runtime, sendMessage } = createMessaging()
    const tabs = {
      query: vi.fn(),
      get: vi.fn().mockResolvedValue({ id: 7, url: 'https://example.com/' }),
      sendMessage: vi.fn()
    }
    const adapter = new TabsProviderAdapter(runtime, tabs)
    const message = providerMessage('response')

    await adapter.sendMessage(message, [])

    expect(tabs.query).not.toHaveBeenCalled()
    expect(tabs.get).toHaveBeenCalledWith(7)
    expect(tabs.sendMessage).toHaveBeenCalledWith(7, message)
    expect(sendMessage).toHaveBeenCalledWith(message)
  })

  it('routes a fragment-bearing provider response only to its exact trusted tab', async () => {
    const { runtime, sendMessage } = createMessaging()
    const tabs = {
      query: vi.fn(),
      get: vi.fn(async () => ({ id: 7, url: 'https://example.com/topic?sort=new#reply-2' })),
      sendMessage: vi.fn()
    }
    const adapter = new TabsProviderAdapter(runtime, tabs)
    const message = providerMessage('fragment-response', {
      meta: { tab: { id: 7, url: 'https://example.com/topic?sort=new#reply-1' } }
    })

    await adapter.sendMessage(message, [])

    expect(tabs.query).not.toHaveBeenCalled()
    expect(tabs.get).toHaveBeenCalledWith(7)
    expect(tabs.sendMessage).toHaveBeenCalledWith(7, message)
    expect(sendMessage).toHaveBeenCalledWith(message)
  })

  it('guards every listener on the shared Runtime bus before raw message access', () => {
    const { runtime, listeners } = createMessaging()
    const providerReceived = vi.fn()
    const injectReceived = vi.fn()

    const provider = new ProviderAdapter(runtime)
    provider.onMessage(providerReceived)
    const providerListener = [...listeners].at(-1)!

    const inject = new BackgroundInjectAdapter(runtime)
    const disposeInject = inject.onMessage(injectReceived)
    const injectListener = [...listeners].at(-1)!

    const malformedMessages: unknown[] = [
      null,
      'raw',
      0,
      false,
      [],
      {},
      { sender: { type: 'provider' } },
      providerMessage('invalid-schema', { id: '' })
    ]
    const dispatch = (message: unknown, sender: unknown) => {
      listeners.forEach((listener) => listener(message, sender))
    }

    malformedMessages.forEach((message) => {
      expect(() => dispatch(message, { url: 'chrome-extension://test-extension/offscreen.html' })).not.toThrow()
      expect(() =>
        dispatch(message, { url: 'https://example.com/', tab: { id: 7, url: 'https://example.com/' } })
      ).not.toThrow()
    })

    expect(providerReceived).not.toHaveBeenCalled()
    expect(injectReceived).not.toHaveBeenCalled()

    const providerRequest = providerMessage('provider-valid', { sender: { type: 'injector' }, meta: {} })
    providerListener(providerRequest, { tab: { id: 7, url: 'https://example.com/' } } as never)
    expect(providerReceived).toHaveBeenCalledWith({
      ...providerRequest,
      meta: { tab: { id: 7, url: 'https://example.com/' } }
    })

    const injectResponse = providerMessage('inject-valid')
    injectListener(injectResponse, { url: 'chrome-extension://test-extension/offscreen.html' })
    expect(injectReceived).toHaveBeenCalledWith(injectResponse)

    provider.dispose()
    if (typeof disposeInject === 'function') disposeInject()
    expect(listeners.size).toBe(0)
  })
})
