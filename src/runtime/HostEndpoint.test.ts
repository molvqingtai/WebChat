import { describe, expect, it, vi } from 'vitest'
import { HostEndpoint } from '@/runtime/HostEndpoint'
import type { HistorySupplyEvent, RuntimeServer, RuntimeSnapshot } from '@/runtime/Contract'
import type { HostPush, HostRequest } from '@/runtime/Link'

const snapshot = (hostId = 'host-1'): RuntimeSnapshot => ({
  hostId,
  hostPhase: 'ready',
  peerId: 'peer-1',
  domains: [],
  world: { joined: false, peerId: 'peer-1', presences: [] },
  failures: []
})

const createServer = () => {
  const attachPage = vi.fn(async () => snapshot())
  const getSnapshot = vi.fn(async () => snapshot())
  const provideHistory = vi.fn(async (_payload: unknown, _callback: (event: HistorySupplyEvent) => void) => {})
  const server = { attachPage, getSnapshot, provideHistory } as unknown as RuntimeServer
  return { server, attachPage, getSnapshot, provideHistory }
}

const call = (pageId: string, method: string, args: unknown[] = [], domain = 'https://a.test'): HostRequest => ({
  scope: 'WEB_CHAT_HOST_V3',
  type: 'call',
  tabId: 7,
  url: 'https://a.test/',
  message: {
    scope: 'WEB_CHAT_PAGE_V3',
    type: 'call',
    pageId,
    callId: `call-${pageId}`,
    domain,
    method: method as never,
    args
  }
})

const flush = () => new Promise<void>((resolve) => queueMicrotask(resolve))

describe('HostEndpoint', () => {
  it('registers a page from the browser facts carried by its own message', async () => {
    const { server, attachPage } = createServer()
    const pushes: HostPush[] = []
    const endpoint = new HostEndpoint(server, (push) => pushes.push(push))

    const response = await endpoint.handle(call('page-1', 'attachPage', [{ domain: 'https://a.test' }]))

    expect(response.ok).toBe(true)
    expect(attachPage).toHaveBeenCalledWith({
      domain: 'https://a.test',
      caller: { tab: { id: 7, url: 'https://a.test/' } }
    })
  })

  it('re-registers an unknown page on getSnapshot after a host restart', async () => {
    const { server, getSnapshot } = createServer()
    const endpoint = new HostEndpoint(server, () => {})

    const response = await endpoint.handle(call('fresh-page', 'getSnapshot', [{ domain: 'https://a.test' }]))

    expect(response.ok).toBe(true)
    expect(getSnapshot).toHaveBeenCalledWith({
      domain: 'https://a.test',
      caller: { tab: { id: 7, url: 'https://a.test/' } }
    })
  })

  it('detaches the tab only after its last page says goodbye', async () => {
    const { server } = createServer()
    const detach = vi.fn()
    const endpoint = new HostEndpoint(server, () => {}, detach)
    await endpoint.handle(call('page-1', 'attachPage', [{ domain: 'https://a.test' }]))
    await endpoint.handle(call('page-2', 'attachPage', [{ domain: 'https://a.test' }]))

    await endpoint.handle({
      scope: 'WEB_CHAT_HOST_V3',
      type: 'call',
      tabId: 7,
      message: { scope: 'WEB_CHAT_PAGE_V3', type: 'bye', pageId: 'page-1' }
    })
    expect(detach).not.toHaveBeenCalled()

    await endpoint.handle({
      scope: 'WEB_CHAT_HOST_V3',
      type: 'call',
      tabId: 7,
      message: { scope: 'WEB_CHAT_PAGE_V3', type: 'bye', pageId: 'page-2' }
    })
    await flush()
    expect(detach).toHaveBeenCalledWith(7)
  })

  it('drops every page of a removed tab', async () => {
    const { server } = createServer()
    const detach = vi.fn()
    const endpoint = new HostEndpoint(server, () => {}, detach)
    await endpoint.handle(call('page-1', 'attachPage', [{ domain: 'https://a.test' }]))
    await endpoint.handle(call('page-2', 'attachPage', [{ domain: 'https://a.test' }]))

    await endpoint.handle({ scope: 'WEB_CHAT_HOST_V3', type: 'tab-gone', tabId: 7 })
    await flush()

    expect(detach).toHaveBeenCalledWith(7)
  })

  it('coalesces invalidations into one push with unique tabs', async () => {
    const { server } = createServer()
    const pushes: HostPush[] = []
    const endpoint = new HostEndpoint(server, (push) => pushes.push(push))
    await endpoint.handle(call('page-1', 'attachPage', [{ domain: 'https://a.test' }]))
    await endpoint.handle(call('page-2', 'attachPage', [{ domain: 'https://a.test' }]))

    endpoint.invalidate()
    endpoint.invalidate()
    await flush()

    expect(pushes).toEqual([{ scope: 'WEB_CHAT_HOST_PUSH_V3', type: 'state-changed', tabIds: [7] }])
  })

  it('routes a History supply event to the tab that registered the provider', async () => {
    const { server, provideHistory } = createServer()
    const pushes: HostPush[] = []
    const endpoint = new HostEndpoint(server, (push) => pushes.push(push))
    await endpoint.handle(call('page-1', 'provideHistory', [{ domain: 'https://a.test' }]))

    const callback = provideHistory.mock.calls[0]?.[1] as (event: HistorySupplyEvent) => void
    callback({ type: 'cancel', supplyId: 'supply-1' })

    expect(pushes).toEqual([
      {
        scope: 'WEB_CHAT_HOST_PUSH_V3',
        type: 'history',
        tabId: 7,
        event: { type: 'cancel', supplyId: 'supply-1' }
      }
    ])
  })
})