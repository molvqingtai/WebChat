import { afterEach, describe, expect, it, vi } from 'vitest'
import { MESSAGE_RECORD_TYPE, type MessageRecord } from '@/domain/Message'
import { createMessageStore } from '@/domain/MessageStore'
import type { ReadinessState } from '@/domain/externs/Readiness'
import { createMemoryMessageDatabase } from '@/domain/impls/database/Memory'
import type { ChatSession } from '@/protocol'
import { HostUnavailableError, type HostLocator } from '@/runtime/core/Contract'
import { createRuntime, type Runtime } from '@/runtime/core/Runtime'
import { createChannelPair, createMemoryHub } from '@/runtime/core/testing'
import { createRuntimePorts } from './ChatRoom'

const DOMAIN = 'https://example.com'
const site = { origin: DOMAIN }
let databases = 0

/** A browser whose host can be killed; the locator starts a new one on demand, like ensure-host. */
const createBrowser = (hub: ReturnType<typeof createMemoryHub>, name: string) => {
  let host: { runtime: Runtime; close: Set<() => void> } | null = null
  let hosts = 0
  const locator: HostLocator = {
    connect: async () => {
      if (!host) {
        const id = ++hosts
        let sequence = 0
        host = {
          runtime: createRuntime({ transport: hub.createTransport(), nextId: () => `${name}${id}-${++sequence}` }),
          close: new Set()
        }
      }
      const pair = createChannelPair(DOMAIN)
      host.close.add(pair.close)
      host.runtime.attach(pair.host)
      return pair.page
    }
  }
  const openPage = (store = createMessageStore(createMemoryMessageDatabase(`db-${++databases}`))) => {
    const ports = createRuntimePorts(locator, store)
    const user = { id: `user-${name}`, name, avatar: '' }
    const seen = {
      sessions: [] as (readonly ChatSession[])[],
      joins: [] as string[],
      leaves: [] as string[],
      messages: [] as string[],
      errors: [] as string[],
      states: [] as ReadinessState[]
    }
    ports.chatRoom.onSessions((sessions) => seen.sessions.push(sessions))
    ports.chatRoom.onJoinRoom((session) => seen.joins.push(session.user.name))
    ports.chatRoom.onLeaveRoom((session) => seen.leaves.push(session.user.name))
    ports.chatRoom.onMessage((message) => seen.messages.push(message.id))
    ports.chatRoom.onError((error) => seen.errors.push(error.message))
    ports.readiness.onState((state) => seen.states.push(state))
    return {
      ...ports,
      user,
      store,
      seen,
      join: () => ports.chatRoom.joinRoom({ user, site }),
      online: () => seen.sessions.at(-1)?.map((session) => session.user.name)
    }
  }
  return {
    openPage,
    hosts: () => hosts,
    /** The host document dies: its network connections and every page port go with it. */
    killHost: () => {
      const dead = host!
      host = null
      dead.runtime.dispose()
      dead.close.forEach((close) => close())
    }
  }
}

const notices = async (store: { query: () => Promise<readonly MessageRecord[]> }) =>
  (await store.query())
    .filter((record) => record.type === MESSAGE_RECORD_TYPE.SYSTEM_NOTICE)
    .map((record) => (record.type === MESSAGE_RECORD_TYPE.SYSTEM_NOTICE ? record.notice.body : ''))

afterEach(() => vi.useRealTimers())

describe('page Runtime ports', () => {
  it('reports readiness, joins and writes one self-join notice however often the join is replayed', async () => {
    const page = createBrowser(createMemoryHub(), 'alice').openPage()
    expect(page.seen.states).toEqual(['connecting'])
    expect(await page.start()).toBe(true)
    expect(page.seen.states).toEqual(['connecting', 'ready'])
    await page.join()
    await page.join()
    expect(page.online()).toEqual(['alice'])
    expect(await notices(page.store)).toEqual(['"alice" joined the chat'])
  })

  it('raises a join notice only for users who arrive after us, and a leave when they go', async () => {
    const hub = createMemoryHub()
    const aliceBrowser = createBrowser(hub, 'alice')
    const alice = aliceBrowser.openPage()
    const bob = createBrowser(hub, 'bob').openPage()
    await alice.start()
    await bob.start()
    await alice.join()
    await new Promise((resolve) => setTimeout(resolve, 5))
    await bob.join()
    await vi.waitFor(() => {
      expect(alice.online()).toEqual(['alice', 'bob'])
      expect(bob.online()).toEqual(['bob', 'alice'])
    })
    expect(alice.seen.joins).toEqual(['bob'])
    expect(bob.seen.joins).toEqual([])

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
    aliceBrowser.killHost()
    alice.stop()
    await vi.advanceTimersByTimeAsync(6000)
    vi.useRealTimers()
    await vi.waitFor(() => expect(bob.seen.leaves).toEqual(['alice']))
    expect(bob.online()).toEqual(['bob'])
  })

  it('sends text and reactions, stores them locally and delivers them live to the other browser', async () => {
    const hub = createMemoryHub()
    const alice = createBrowser(hub, 'alice').openPage()
    const bob = createBrowser(hub, 'bob').openPage()
    await Promise.all([alice.start(), bob.start()])
    await alice.join()
    await bob.join()
    await vi.waitFor(() => expect(alice.online()).toEqual(['alice', 'bob']))
    const text = await alice.chatRoom.sendMessage({ type: 'text', body: 'hello', mentions: [] })
    expect(text.body).toBe('hello')
    await vi.waitFor(() => expect(bob.seen.messages).toEqual([text.id]))
    const reaction = await bob.chatRoom.sendMessage({ type: 'reaction', targetId: text.id, reaction: 'like', active: true })
    await vi.waitFor(() => expect(alice.seen.messages).toEqual([reaction.id]))
    const stored = (await alice.store.query({ type: MESSAGE_RECORD_TYPE.CHAT_MESSAGE })).map((record) => record.id)
    expect(stored.toSorted()).toEqual([text.id, reaction.id].toSorted())
    // Our own message is stored but is not a "received" message.
    expect(alice.seen.messages).not.toContain(text.id)
  })

  it('wakes a new host after the old one dies and resumes the same presence without notices', async () => {
    const hub = createMemoryHub()
    const aliceBrowser = createBrowser(hub, 'alice')
    const alice = aliceBrowser.openPage()
    const bob = createBrowser(hub, 'bob').openPage()
    await Promise.all([alice.start(), bob.start()])
    await bob.join()
    await new Promise((resolve) => setTimeout(resolve, 5))
    await alice.join()
    await vi.waitFor(() => expect(bob.online()).toEqual(['bob', 'alice']))
    expect(bob.seen.joins).toEqual(['alice'])
    const sessionBefore = bob.seen.sessions.at(-1)![1]!.sessionId

    aliceBrowser.killHost()
    // No refresh, no user action: the page notices, a new host is started, and it reports ready.
    await vi.waitFor(() => expect(alice.seen.states).toEqual(['connecting', 'ready', 'connecting', 'ready']))
    expect(aliceBrowser.hosts()).toBe(2)
    // The application replays its join on "ready" (ChatRoomDomain's HostRecoveryEffect).
    await alice.join()

    await vi.waitFor(() => {
      const current = bob.seen.sessions.at(-1)!
      expect(current.map((session) => session.user.name)).toEqual(['bob', 'alice'])
      expect(current[1]!.sessionId).not.toBe(sessionBefore)
    })
    await vi.waitFor(() => expect(alice.online()).toEqual(['alice', 'bob']))
    expect(bob.seen.leaves).toEqual([])
    expect(bob.seen.joins).toEqual(['alice'])
    expect(alice.seen.joins).toEqual([])
    expect(alice.seen.leaves).toEqual([])
    expect(await notices(alice.store)).toEqual(['"alice" joined the chat'])

    const text = await alice.chatRoom.sendMessage({ type: 'text', body: 'still here', mentions: [] })
    await vi.waitFor(() => expect(bob.seen.messages).toEqual([text.id]))
  })

  it('cancels a call that is cut off by the host dying, instead of failing it', async () => {
    const browser = createBrowser(createMemoryHub(), 'alice')
    const page = browser.openPage()
    await page.start()
    await page.join()
    const sending = page.chatRoom.sendMessage({ type: 'text', body: 'x'.repeat(100000), mentions: [] })
    browser.killHost()
    const outcome = await sending.then(
      () => 'sent',
      (error) => error.name
    )
    expect(['sent', 'AbortError']).toContain(outcome)
  })

  it('stays connecting while stopped and reconnects on start', async () => {
    const browser = createBrowser(createMemoryHub(), 'alice')
    const page = browser.openPage()
    await page.start()
    page.stop()
    expect(page.seen.states.at(-1)).toBe('connecting')
    expect(await page.start()).toBe(true)
    await page.join()
    expect(page.online()).toEqual(['alice'])
  })

  it('becomes unavailable when the extension context is gone', async () => {
    const ports = createRuntimePorts(
      { connect: async () => Promise.reject(new HostUnavailableError('Extension context invalidated')) },
      createMessageStore(createMemoryMessageDatabase(`db-${++databases}`))
    )
    expect(await ports.start()).toBeNull()
    const states: ReadinessState[] = []
    ports.readiness.onState((state) => states.push(state))
    expect(states).toEqual(['unavailable'])
  })

  it('shows history loading only while a sync brings something new', async () => {
    const hub = createMemoryHub()
    const alice = createBrowser(hub, 'alice').openPage()
    const bob = createBrowser(hub, 'bob').openPage()
    const feedback: string[] = []
    bob.onHistoryFeedback((event) => feedback.push(event.type))
    await Promise.all([alice.start(), bob.start()])
    await alice.join()
    const text = await alice.chatRoom.sendMessage({ type: 'text', body: 'before bob', mentions: [] })
    await vi.waitFor(async () => expect(await alice.store.query({ type: MESSAGE_RECORD_TYPE.CHAT_MESSAGE })).toHaveLength(1))
    await bob.join()
    await vi.waitFor(async () =>
      expect((await bob.store.query({ type: MESSAGE_RECORD_TYPE.CHAT_MESSAGE })).map((record) => record.id)).toEqual([text.id])
    )
    // History is merged silently: no live message event.
    expect(bob.seen.messages).toEqual([])
    await vi.waitFor(() => expect(feedback.at(-1) ?? 'dismiss').toBe('dismiss'))
    expect(feedback.filter((type) => type === 'loading').length).toBeLessThanOrEqual(1)
  })
})
