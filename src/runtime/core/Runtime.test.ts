import { afterEach, describe, expect, it, vi } from 'vitest'
import { MESSAGE_RECORD_TYPE, type ChatMessageRecord } from '@/domain/Message'
import { DOMAIN_GRACE_MS } from './Config'
import type { Channel, PageService, RuntimeEvent, RuntimeService } from './Contract'
import { connectServices, createRuntime, PAGE_NAMESPACE, RUNTIME_NAMESPACE } from './Runtime'
import { chatRoomId } from './domain/Room'
import { worldRoomId } from './domain/Wire'
import { createMemoryHub } from './testing'

const DOMAIN = 'https://example.com'
const site = { origin: DOMAIN, title: 'Example' }

/** Two Channel ends backed by a MessageChannel: the same shape a worker host would use. */
const createChannelPair = (domain: string) => {
  const { port1, port2 } = new MessageChannel()
  const closers = new Set<() => void>()
  const wrap = (port: MessagePort): Channel => ({
    domain,
    post: (frame) => port.postMessage(frame),
    onMessage: (listener) => {
      const handler = (event: MessageEvent) => listener(event.data)
      port.addEventListener('message', handler)
      port.start()
      return () => port.removeEventListener('message', handler)
    },
    onClose: (listener) => {
      closers.add(listener)
      return () => closers.delete(listener)
    },
    close: () => close()
  })
  const close = () => {
    closers.forEach((listener) => listener())
    closers.clear()
    port1.close()
    port2.close()
  }
  return {
    host: wrap(port1),
    page: wrap(port2),
    close
  }
}

const createBrowser = (hub: ReturnType<typeof createMemoryHub>, name: string) => {
  let sequence = 0
  const transport = hub.createTransport()
  const runtime = createRuntime({ transport, nextId: () => `${name}-${++sequence}` })
  const openPage = (database = new Map<string, ChatMessageRecord>()) => {
    const events: RuntimeEvent[] = []
    const live: ChatMessageRecord[] = []
    const pair = createChannelPair(DOMAIN)
    const service: PageService = {
      persist: async (records, isLive) => {
        const fresh = records.filter((record) => !database.has(record.id))
        fresh.forEach((record) => database.set(record.id, record))
        if (isLive) live.push(...fresh)
        return fresh.length
      },
      readHistory: async (cutoff) => [...database.values()].filter((record) => record.message.hlc.timestamp >= cutoff),
      publish: (event) => void events.push(event)
    }
    runtime.attach(pair.host)
    const remote = connectServices<PageService, RuntimeService>(
      pair.page,
      { namespace: PAGE_NAMESPACE, service },
      RUNTIME_NAMESPACE
    )
    const user = { id: `user-${name}`, name, avatar: '' }
    return {
      remote,
      events,
      live,
      database,
      user,
      close: pair.close,
      join: () => remote.join({ user, site }),
      last: <Type extends RuntimeEvent['type']>(type: Type) =>
        events.findLast((event): event is Extract<RuntimeEvent, { type: Type }> => event.type === type)
    }
  }
  return { runtime, transport, openPage }
}

const record = (id: string, timestamp: number): ChatMessageRecord => ({
  type: MESSAGE_RECORD_TYPE.CHAT_MESSAGE,
  id,
  message: { type: 'text', id, hlc: { timestamp, counter: 0 }, userId: 'user-old', body: id, mentions: [] },
  user: { id: 'user-old', name: 'old', avatar: '' },
  receivedAt: timestamp
})

afterEach(() => vi.useRealTimers())

describe('Runtime over a MessagePort channel', () => {
  it('joins, lists both users and delivers a message to the other browser', async () => {
    const hub = createMemoryHub()
    const alice = createBrowser(hub, 'alice').openPage()
    const bob = createBrowser(hub, 'bob').openPage()
    const session = await alice.join()
    expect(session.user).toEqual(alice.user)
    await bob.join()
    await vi.waitFor(() => expect(alice.last('sessions')?.remote.map((item) => item.user.name)).toEqual(['bob']))
    await vi.waitFor(() =>
      expect(alice.last('world')?.sites).toEqual([{ ...site, users: [alice.user, bob.user] }])
    )
    const sent = await alice.remote.send({ type: 'text', body: 'hello', mentions: [] })
    expect(sent.user).toEqual(alice.user)
    await vi.waitFor(() => expect(bob.live.map((item) => item.id)).toEqual([sent.id]))
    expect(bob.live[0]!.user).toEqual(alice.user)
  })

  it('rejects a send before joining and a join for another origin', async () => {
    const page = createBrowser(createMemoryHub(), 'alice').openPage()
    await expect(page.remote.send({ type: 'text', body: 'x', mentions: [] })).rejects.toThrow(
      'Runtime is not ready for this site'
    )
    await expect(page.remote.join({ user: page.user, site: { origin: 'https://other.example' } })).rejects.toThrow(
      'Site does not match the page origin'
    )
  })

  it('syncs missing history in both directions and reports loading only when something is new', async () => {
    const hub = createMemoryHub()
    const now = Date.now()
    const alice = createBrowser(hub, 'alice').openPage(new Map([['a1', record('a1', now - 2000)]]))
    const stale = record('too-old', now - 40 * 24 * 60 * 60 * 1000)
    const bob = createBrowser(hub, 'bob').openPage(
      new Map([
        ['b1', record('b1', now - 1000)],
        ['too-old', stale]
      ])
    )
    await alice.join()
    await bob.join()
    await vi.waitFor(() => {
      expect([...alice.database.keys()].toSorted()).toEqual(['a1', 'b1'])
      expect([...bob.database.keys()].toSorted()).toEqual(['a1', 'b1', 'too-old'])
    })
    expect(alice.live).toEqual([])
    await vi.waitFor(() => expect(alice.last('history')?.syncIds).toEqual([]))
  })

  it('pages a large history response', async () => {
    const hub = createMemoryHub()
    const now = Date.now()
    const alice = createBrowser(hub, 'alice').openPage()
    const many = new Map(Array.from({ length: 250 }, (_, index) => [`m${index}`, record(`m${index}`, now - index)]))
    const bob = createBrowser(hub, 'bob').openPage(many)
    await alice.join()
    await bob.join()
    await vi.waitFor(() => expect(alice.database.size).toBe(250))
  })

  it('shares one room between two pages and stores a live message once', async () => {
    const hub = createMemoryHub()
    const browser = createBrowser(hub, 'alice')
    const database = new Map<string, ChatMessageRecord>()
    const first = browser.openPage(database)
    const second = browser.openPage(database)
    const bob = createBrowser(hub, 'bob').openPage()
    const one = await first.join()
    const two = await second.join()
    expect(two.presenceId).toBe(one.presenceId)
    await bob.join()
    await vi.waitFor(() => expect(bob.last('sessions')?.remote).toHaveLength(1))
    const sent = await bob.remote.send({ type: 'text', body: 'hi', mentions: [] })
    await vi.waitFor(() => expect(database.has(sent.id)).toBe(true))
    expect([...first.live, ...second.live]).toHaveLength(1)
  })

  it('keeps the room through a page reload inside the grace period and releases it after', async () => {
    const hub = createMemoryHub()
    const browser = createBrowser(hub, 'alice')
    const bob = createBrowser(hub, 'bob').openPage()
    const page = browser.openPage()
    const before = await page.join()
    await bob.join()
    await vi.waitFor(() => expect(bob.last('sessions')?.remote).toHaveLength(1))
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
    page.close()
    await vi.advanceTimersByTimeAsync(DOMAIN_GRACE_MS - 100)
    const reloaded = browser.openPage()
    vi.useRealTimers()
    const after = await reloaded.join()
    expect(after.sessionId).toBe(before.sessionId)
    expect(bob.last('sessions')?.remote).toHaveLength(1)

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
    reloaded.close()
    await vi.advanceTimersByTimeAsync(DOMAIN_GRACE_MS + 100)
    vi.useRealTimers()
    expect(browser.transport.peerIdOf(chatRoomId(DOMAIN))).toBe('')
    // The world room is left too, after a final "on no site" presence.
    await vi.waitFor(() => expect(browser.transport.peerIdOf(worldRoomId)).toBe(''))
    await vi.waitFor(() => expect(bob.last('world')?.sites).toEqual([{ ...site, users: [bob.user] }]))
  })

  it('a restarted host resumes the presence the page hands back', async () => {
    const hub = createMemoryHub()
    const bob = createBrowser(hub, 'bob').openPage()
    await bob.join()
    const firstHost = createBrowser(hub, 'alice')
    const page = firstHost.openPage()
    const before = await page.join()
    await vi.waitFor(() => expect(bob.last('sessions')?.remote).toHaveLength(1))

    // The host dies: its transport vanishes and every channel closes.
    page.close()
    firstHost.runtime.dispose()
    const restarted = createBrowser(hub, 'alice2').openPage()
    const after = await restarted.remote.join({
      user: page.user,
      site,
      resume: { presenceId: before.presenceId, joinedAt: before.joinedAt }
    })
    expect(after.presenceId).toBe(before.presenceId)
    expect(after.joinedAt).toBe(before.joinedAt)
    await vi.waitFor(() => {
      const remote = bob.last('sessions')!.remote
      expect(remote).toHaveLength(1)
      expect(remote[0]!.sessionId).toBe(after.sessionId)
    })
  })

  it('fails a pending call when the channel closes', async () => {
    const page = createBrowser(createMemoryHub(), 'alice').openPage()
    await page.join()
    page.close()
    await expect(page.remote.send({ type: 'text', body: 'x', mentions: [] })).rejects.toThrow('Runtime channel closed')
  })
})
