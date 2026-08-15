import { describe, expect, it, vi } from 'vitest'
import type { Message } from 'comctx'
import { InjectAdapter, ownInjectRejections } from '@/service/adapter/runtime'
import { BackgroundInjectAdapter } from '@/service/adapter/runtime/Core'
import { ProviderAdapter, type MessageMeta } from '@/service/adapter/runtime/Provider'
import { relayOffscreenProviderMessages } from '@/service/adapter/runtime/Relay'
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

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

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

  it('keeps the Offscreen provider on runtime messaging without a tabs capability', () => {
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

  it('replaces forged registerPage tab claims with extension sender metadata', () => {
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
      args: [{ ...claimedLease, tab: trustedTab }],
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

  it('relays only trusted Offscreen provider messages to their exact live tab', async () => {
    const { runtime, listeners } = createMessaging()
    const tabs = {
      query: vi.fn(),
      get: vi.fn(async (tabId: number) => {
        if (tabId === 8) return { id: tabId, url: 'https://elsewhere.example/' }
        if (tabId === 9) throw new Error('No tab')
        return { id: tabId, url: 'https://example.com/' }
      }),
      sendMessage: vi.fn()
    }
    const rejected = vi.fn()
    const dispose = relayOffscreenProviderMessages({
      runtime: runtime as never,
      tabs,
      namespace: 'WEB_CHAT_RUNTIME_V2:test-extension',
      offscreenUrl: 'chrome-extension://test-extension/offscreen.html',
      onRejected: rejected
    })
    const listener = [...listeners][0]!
    const offscreen = { url: 'chrome-extension://test-extension/offscreen.html' } as never
    const content = { url: 'https://example.com/' } as never
    const malformedMessages: unknown[] = [null, 'raw', 0, false, [], {}, { sender: { type: 'provider' } }]

    malformedMessages.forEach((message) => {
      expect(() => listener(message, offscreen)).not.toThrow()
      expect(() => listener(message, content)).not.toThrow()
    })
    listener(providerMessage('valid'), offscreen)
    listener(providerMessage('forged'), { url: 'chrome-extension://test-extension/options.html' } as never)
    listener(providerMessage('namespace', { namespace: 'UNKNOWN' }), offscreen)
    listener(providerMessage('direction', { sender: { type: 'injector' } }), offscreen)
    listener(
      providerMessage('presence-request', {
        sender: { type: 'injector' },
        namespace: 'WEB_CHAT_RUNTIME_PRESENCE_STORE_V1:test-extension',
        meta: {}
      }),
      offscreen
    )
    listener(
      providerMessage('presence-response', {
        namespace: 'WEB_CHAT_RUNTIME_PRESENCE_STORE_V1:test-extension',
        meta: {}
      }),
      { url: 'chrome-extension://test-extension/background.js' } as never
    )
    listener(providerMessage('schema', { id: '' }), offscreen)
    listener(providerMessage('background', { meta: {} }), offscreen)
    listener(providerMessage('target', { meta: { tab: { id: 7, url: 'http://example.com/' } } }), offscreen)
    listener(providerMessage('mismatch', { meta: { tab: { id: 8, url: 'https://example.com/' } } }), offscreen)
    listener(providerMessage('missing', { meta: { tab: { id: 9, url: 'https://example.com/' } } }), offscreen)
    listener(providerMessage('normal-injector', { sender: { type: 'injector' } }), content)
    await settle()

    expect(tabs.sendMessage).toHaveBeenCalledTimes(1)
    expect(tabs.sendMessage).toHaveBeenCalledWith(7, providerMessage('valid'))
    expect(rejected.mock.calls.map(([result]) => result)).toEqual([
      ...malformedMessages.map(() => ({ reason: 'invalid-message' })),
      { reason: 'untrusted-source', targetId: 7 },
      { reason: 'invalid-namespace', targetId: 7 },
      { reason: 'invalid-direction', targetId: 7 },
      { reason: 'invalid-message' },
      { reason: 'invalid-target' },
      { reason: 'target-mismatch', targetId: 8 },
      { reason: 'target-unavailable', targetId: 9 }
    ])

    dispose()
    expect(listeners.size).toBe(0)
  })

  it('keeps hash-only navigation routable while fencing real navigation', async () => {
    const { runtime, listeners } = createMessaging()
    let currentUrl = 'https://example.com/topic?sort=new#reply-2'
    const tabs = {
      query: vi.fn(),
      get: vi.fn(async (tabId: number) => ({ id: tabId, url: currentUrl })),
      sendMessage: vi.fn()
    }
    const rejected = vi.fn()
    relayOffscreenProviderMessages({
      runtime: runtime as never,
      tabs,
      namespace: 'WEB_CHAT_RUNTIME_V2:test-extension',
      offscreenUrl: 'chrome-extension://test-extension/offscreen.html',
      onRejected: rejected
    })
    const listener = [...listeners][0]!
    const offscreen = { url: 'chrome-extension://test-extension/offscreen.html' } as never
    const response = providerMessage('hash-in-flight', {
      meta: { tab: { id: 7, url: 'https://example.com/topic?sort=new#reply-1' } }
    })

    listener(response, offscreen)
    await settle()
    expect(tabs.sendMessage).toHaveBeenCalledWith(7, response)

    tabs.sendMessage.mockClear()
    currentUrl = 'https://example.com/other?sort=new#reply-1'
    listener(response, offscreen)
    await settle()
    expect(tabs.sendMessage).not.toHaveBeenCalled()
    expect(rejected).toHaveBeenLastCalledWith({ reason: 'target-mismatch', targetId: 7 })
  })

  it('guards every listener on the shared Runtime bus before raw message access', async () => {
    const { runtime, listeners } = createMessaging()
    const providerReceived = vi.fn()
    const injectReceived = vi.fn()

    const provider = new ProviderAdapter(runtime)
    provider.onMessage(providerReceived)
    const providerListener = [...listeners].at(-1)!

    const inject = new BackgroundInjectAdapter(runtime)
    const disposeInject = inject.onMessage(injectReceived)
    const injectListener = [...listeners].at(-1)!

    const tabs = {
      query: vi.fn(),
      get: vi.fn().mockResolvedValue({ id: 7, url: 'https://example.com/' }),
      sendMessage: vi.fn()
    }
    const rejected = vi.fn()
    const disposeRelay = relayOffscreenProviderMessages({
      runtime: runtime as never,
      tabs,
      namespace: 'WEB_CHAT_RUNTIME_V2:test-extension',
      offscreenUrl: 'chrome-extension://test-extension/offscreen.html',
      onRejected: rejected
    })
    const relayListener = [...listeners].at(-1)!

    const offscreen = { url: 'chrome-extension://test-extension/offscreen.html' }
    const content = { url: 'https://example.com/', tab: { id: 7, url: 'https://example.com/' } }
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
      expect(() => dispatch(message, offscreen)).not.toThrow()
      expect(() => dispatch(message, content)).not.toThrow()
    })

    expect(providerReceived).not.toHaveBeenCalled()
    expect(injectReceived).not.toHaveBeenCalled()
    expect(tabs.get).not.toHaveBeenCalled()
    expect(tabs.sendMessage).not.toHaveBeenCalled()
    expect(rejected.mock.calls.map(([value]) => value)).toEqual(
      malformedMessages.map(() => ({ reason: 'invalid-message' }))
    )

    const providerRequest = providerMessage('provider-valid', { sender: { type: 'injector' }, meta: {} })
    providerListener(providerRequest, content)
    expect(providerReceived).toHaveBeenCalledWith({
      ...providerRequest,
      meta: { tab: { id: 7, url: 'https://example.com/' } }
    })

    const injectResponse = providerMessage('inject-valid')
    injectListener(injectResponse, offscreen)
    expect(injectReceived).toHaveBeenCalledWith(injectResponse)

    const relayResponse = providerMessage('relay-valid')
    relayListener(relayResponse, offscreen)
    await settle()
    expect(tabs.sendMessage).toHaveBeenCalledWith(7, relayResponse)

    disposeRelay()
    provider.dispose()
    if (typeof disposeInject === 'function') disposeInject()
    expect(listeners.size).toBe(0)
  })
})
