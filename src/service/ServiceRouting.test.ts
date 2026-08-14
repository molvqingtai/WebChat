import type { Message } from 'comctx'
import { describe, expect, it, vi } from 'vitest'
import type { ProjectedTextMessage } from '@/domain/Message'
import { BackgroundInjectAdapter } from '@/service/adapter/runtime/Core'
import { TabsProviderAdapter } from '@/service/adapter/runtime/Tabs'
import {
  APP_ACTION_NAMESPACE_V1,
  NOTIFICATION_NAMESPACE_V1,
  defineAppActionProxy,
  defineNotificationProxy
} from '@/service/Contract'

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

const createBus = () => {
  const listeners = new Set<(...args: unknown[]) => unknown>()
  const messages: Message[] = []
  const runtime = {
    id: 'test-extension',
    sendMessage: (...args: unknown[]) => {
      const message = args.at(-1) as Message
      messages.push(structuredClone(message))
      const sender = args.length === 2 ? { tab: { id: 7, url: 'https://example.com/' } } : {}
      // functional-loop: owner-commit — ordered per-item emission with no bulk primitive
      for (const listener of listeners) listener(message, sender)
    },
    onMessage: {
      addListener: (listener: (...args: unknown[]) => unknown) => listeners.add(listener),
      removeListener: (listener: (...args: unknown[]) => unknown) => listeners.delete(listener)
    }
  }
  const tabs = {
    query: vi.fn(async () => []),
    get: vi.fn(async (id: number) => ({ id, url: 'https://example.com/' })),
    sendMessage: vi.fn()
  }
  return { listeners, messages, runtime, tabs }
}

const providerResponses = (messages: Message[]) =>
  messages.filter((message) => message.type === 'apply' && message.sender.type === 'provider')

const heartbeat = (messages: Message[]) => ({
  pings: messages.filter((message) => message.type === 'ping' && message.sender.type === 'injector').length,
  pongs: messages.filter((message) => message.type === 'pong' && message.sender.type === 'provider').length
})

describe('background service routing', () => {
  it('routes Notification and AppAction through disjoint heartbeat-checked providers', async () => {
    const bus = createBus()
    const push = vi.fn(async () => 'notification-id')
    const openOptionsPage = vi.fn(async () => {})
    const [provideNotification, injectNotification] = defineNotificationProxy(() => ({ push }), bus.runtime.id)
    const [provideAppAction, injectAppAction] = defineAppActionProxy(() => ({ openOptionsPage }), bus.runtime.id)
    const notificationProvider = new TabsProviderAdapter(bus.runtime, bus.tabs)
    const appActionProvider = new TabsProviderAdapter(bus.runtime, bus.tabs)
    provideNotification(notificationProvider)
    provideAppAction(appActionProvider)
    const baselineListeners = bus.listeners.size
    expect(baselineListeners).toBe(2)

    const notification = injectNotification(new BackgroundInjectAdapter(bus.runtime))
    await expect(notification.push({ body: 'probe' } as ProjectedTextMessage)).resolves.toBe('notification-id')
    await settle()

    expect(push).toHaveBeenCalledTimes(1)
    expect(openOptionsPage).not.toHaveBeenCalled()
    expect(heartbeat(bus.messages)).toEqual({ pings: 1, pongs: 1 })
    expect(providerResponses(bus.messages)).toMatchObject([
      { namespace: `${NOTIFICATION_NAMESPACE_V1}:${bus.runtime.id}`, path: ['push'], error: undefined }
    ])
    expect(bus.listeners.size).toBe(baselineListeners)

    bus.messages.length = 0
    const appAction = injectAppAction(new BackgroundInjectAdapter(bus.runtime))
    await expect(appAction.openOptionsPage()).resolves.toBeUndefined()
    await settle()

    expect(push).toHaveBeenCalledTimes(1)
    expect(openOptionsPage).toHaveBeenCalledTimes(1)
    expect(heartbeat(bus.messages)).toEqual({ pings: 1, pongs: 1 })
    expect(providerResponses(bus.messages)).toMatchObject([
      { namespace: `${APP_ACTION_NAMESPACE_V1}:${bus.runtime.id}`, path: ['openOptionsPage'], error: undefined }
    ])
    expect(bus.listeners.size).toBe(baselineListeners)

    notificationProvider.dispose()
    appActionProvider.dispose()
    expect(bus.listeners.size).toBe(0)
  })
})
