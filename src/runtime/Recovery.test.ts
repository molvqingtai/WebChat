import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Clock } from '@/domain/runtime/externs/Clock'
import { ChatRoom } from '@/domain/impls/runtime/ChatRoom'
import { createMemoryMessageDatabase } from '@/domain/impls/database/Memory'
import { createMessageStore } from '@/domain/MessageStore'
import { MESSAGE_RECORD_TYPE } from '@/domain/Message'
import { MESSAGE_TYPE, NativeWireCodec } from '@/protocol'
import type { RuntimeCoordinator, RuntimeServer, RuntimeSnapshot } from '@/runtime/Contract'
import { ClientLease } from '@/runtime/ClientLease'
import { COORDINATOR_HEALTH_INTERVAL_MS, COORDINATOR_SESSION_KEY, Coordinator } from '@/runtime/Coordinator'
import { createServer, getChatRoomId } from '@/runtime/Server'

const DOMAIN = 'https://example.com'
const PAGE_URL = `${DOMAIN}/topic`
const USER = { id: 'user-1', name: 'User', avatar: '' }
const SITE = { origin: DOMAIN, title: 'Example' }

const pageSnapshot = (pageId: string): RuntimeSnapshot => ({
  hostId: 'restored-host',
  hostPhase: 'ready',
  peerId: 'restored-peer',
  domains: [{ domain: DOMAIN, phase: 'active', pageIds: [pageId], chatRoomJoined: false, sessions: [] }],
  world: { joined: false, peerId: 'restored-peer', presences: [] }
})

class FakeClock implements Clock {
  current = 1000

  now = () => this.current
  advance(ms: number) {
    this.current += ms
    vi.advanceTimersByTime(ms)
  }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

const createTransport = (peerId: string) => {
  const sentFrames: { roomId: string; payload: string; to?: string | string[] }[] = []
  let messageListener: ((roomId: string, sourcePeerId: string, rawPayload: string) => void) | undefined
  return {
    transport: {
      peerIdOf: () => peerId,
      join: async () => {},
      leave: () => {},
      peers: () => [],
      send: async (roomId: string, payload: string, to?: string | string[]) => {
        sentFrames.push({ roomId, payload, to })
      },
      onMessage: (callback: (roomId: string, sourcePeerId: string, rawPayload: string) => void) => {
        messageListener = callback
        return () => {
          messageListener = undefined
        }
      },
      onPeerJoin: () => () => {},
      onPeerLeave: () => () => {},
      onRoomClose: () => () => {},
      onError: () => () => {},
      dispose: () => {}
    },
    sentFrames,
    messageListener: () => messageListener
  }
}

const createCoordinatorFixture = () => {
  const clock = new FakeClock()
  const storageState: Record<string, unknown> = {}
  const detached: { domain: string; pageId: string }[] = []
  let hostDocumentExists = false
  let providerAlive = false
  let destroyedDocuments = 0
  let hostNumber = 0
  let currentServer: RuntimeServer | null = null
  let currentTransport: ReturnType<typeof createTransport> | null = null
  const tabs = new Map([[1, { id: 1, url: PAGE_URL }]])

  const coordinator = new Coordinator({
    storage: {
      get: async (key) => ({ [key]: storageState[key] }),
      set: async (items) => {
        Object.assign(storageState, items)
      }
    },
    ensureHostDocument: async () => {
      if (hostDocumentExists) return { phase: 'ready', created: false }
      hostDocumentExists = true
      providerAlive = true
      hostNumber += 1
      currentTransport = createTransport(`peer-${hostNumber}`)
      currentServer = createServer({ transport: currentTransport.transport, clock })
      return { phase: 'ready', created: true }
    },
    probeHost: async () => {
      if (!providerAlive || !currentServer) throw new Error('Runtime provider is unavailable')
      const snapshot = await currentServer.getSnapshot()
      return { hostId: snapshot.hostId, phase: snapshot.hostPhase }
    },
    destroyHostDocument: async () => {
      destroyedDocuments += 1
      hostDocumentExists = false
      providerAlive = false
      currentServer = null
      currentTransport = null
    },
    tabs: {
      get: async (tabId) => {
        const tab = tabs.get(tabId)
        if (!tab) throw new Error('Browser tab is unavailable')
        return tab
      }
    },
    attachPage: async (lease) => {
      if (!currentServer) throw new Error('Runtime host is absent')
      return currentServer.attachPage(lease)
    },
    detachPage: async (lease) => {
      detached.push(lease)
      await currentServer?.detachPage(lease)
    }
  })

  const coordinatorApi: RuntimeCoordinator = {
    ensureHost: () => coordinator.ensureHost(),
    registerPage: (lease) => coordinator.registerPage({ ...lease, tab: tabs.get(1) })
  }
  const serverProxy = new Proxy({} as RuntimeServer, {
    get:
      (_target, property: keyof RuntimeServer) =>
      (...args: unknown[]) => {
        if (!providerAlive || !currentServer) throw new Error('Runtime host is absent')
        const method = currentServer[property] as (...methodArgs: unknown[]) => unknown
        return method(...args)
      }
  })

  return {
    clock,
    coordinator,
    coordinatorApi,
    serverProxy,
    detached,
    storageState,
    replaceHost: () => {
      hostDocumentExists = false
      providerAlive = false
      currentServer = null
      currentTransport = null
    },
    killProvider: () => {
      providerAlive = false
    },
    replaceProvider: () => {
      providerAlive = true
      hostNumber += 1
      currentTransport = createTransport(`peer-${hostNumber}`)
      currentServer = createServer({ transport: currentTransport.transport, clock })
    },
    destroyedDocuments: () => destroyedDocuments,
    hostNumber: () => hostNumber,
    currentServer: () => currentServer!,
    currentTransport: () => currentTransport!,
    registerPage: (pageId: string) =>
      coordinator.registerPage({ domain: DOMAIN, pageId, tab: { id: 1, url: PAGE_URL } })
  }
}

describe('Runtime host recovery and coordinator liveness', () => {
  it('reattaches to a newly created empty Server without an outbound recovery scan', async () => {
    const fixture = createCoordinatorFixture()
    const hostPhases: RuntimeSnapshot['hostPhase'][] = []
    const client = new ClientLease({
      coordinator: fixture.coordinatorApi,
      pageId: 'page-a',
      domain: DOMAIN
    })
    client.whenHostPhase((phase) => hostPhases.push(phase))
    const messageStore = createMessageStore(createMemoryMessageDatabase('recovery-no-outbox'))
    const room = new ChatRoom({
      server: fixture.serverProxy,
      messageStore,
      pageDomain: DOMAIN,
      pageId: 'page-a',
      getSnapshot: () => client.snapshot(),
      whenReady: (callback) => client.whenReady(callback)
    })
    room.onError(() => {})
    const recoveredSessions: { sessionId: string; user: typeof USER }[][] = []
    room.onSessions((sessions) => recoveredSessions.push([...sessions]))
    let pageJoinTask = Promise.resolve()
    client.whenReady(() => {
      pageJoinTask = pageJoinTask.catch(() => {}).then(() => room.joinRoom({ user: USER, site: SITE }))
      void pageJoinTask.catch(() => {})
    })

    const firstSnapshot = await client.init()
    expect(firstSnapshot).not.toBeNull()
    await pageJoinTask
    recoveredSessions.length = 0

    fixture.replaceHost()
    await client.checkNow()

    await vi.waitFor(async () => {
      const next = await fixture.currentServer().getSnapshot()
      expect(next.hostId).not.toBe(firstSnapshot!.hostId)
      expect(next.domains[0]).toMatchObject({ domain: DOMAIN, pageIds: ['page-a'], chatRoomJoined: true })
      expect(fixture.currentTransport().sentFrames).toEqual([])
      expect(recoveredSessions).toEqual([[{ sessionId: expect.any(String), user: USER }]])
      await expect(messageStore.query({ type: MESSAGE_RECORD_TYPE.CHAT_MESSAGE })).resolves.toEqual([])
    })
    expect(fixture.coordinator.snapshotForTest().generation).toBe(2)
    expect(hostPhases).toContain('connecting')
    expect(hostPhases.at(-1)).toBe('ready')

    // A real peer joins the recovered Chat room through the real codec, so the local send has
    // one genuine wire target.
    const remote = { id: 'peer-user', name: 'Peer', avatar: '' }
    const chatRoomId = getChatRoomId(DOMAIN)
    const encodedSession = await NativeWireCodec.encode({
      type: MESSAGE_TYPE.SESSION,
      sessionId: 'peer-session',
      presenceId: 'peer-presence',
      joinedAt: 0,
      user: remote
    })
    fixture.currentTransport().messageListener()!(chatRoomId, 'peer-a', encodedSession)
    await vi.waitFor(() =>
      expect(recoveredSessions.at(-1)).toEqual([
        { sessionId: expect.any(String), user: USER },
        { sessionId: expect.any(String), user: remote }
      ])
    )

    // The Chat delivery boundary on the recovered host: one valid local send reaches the wire
    // once (the transport send is the wire) and persists once; one schema-invalid local send
    // adds zero wire frames and zero persisted records (the delivery rejects before either
    // side effect).
    // Registering the peer announces the local session once; the send observations below are
    // deltas against that baseline.
    const baseline = fixture.currentTransport().sentFrames.length
    const valid = await room.sendMessage({ type: 'text', body: 'hello', mentions: [] })
    await vi.waitFor(async () => {
      expect(fixture.currentTransport().sentFrames.length).toBe(baseline + 1)
      expect(fixture.currentTransport().sentFrames.at(-1)).toMatchObject({ roomId: chatRoomId, to: ['peer-a'] })
      const persisted = await messageStore.query({ type: MESSAGE_RECORD_TYPE.CHAT_MESSAGE })
      expect(persisted.map((record) => record.id)).toEqual([valid.id])
    })

    await expect(room.sendMessage({ type: 'text', body: 'x'.repeat(192 * 1024 + 1), mentions: [] })).rejects.toThrow(
      'Chat message does not match the protocol schema'
    )
    await vi.waitFor(async () => {
      expect(fixture.currentTransport().sentFrames.length).toBe(baseline + 1)
      const persisted = await messageStore.query({ type: MESSAGE_RECORD_TYPE.CHAT_MESSAGE })
      expect(persisted.map((record) => record.id)).toEqual([valid.id])
    })
  })

  it('restores persisted coordinator lease and host generation without duplicate pages', async () => {
    const storageState: Record<string, unknown> = {}
    const storage = {
      get: async (key: string) => ({ [key]: storageState[key] }),
      set: async (items: Record<string, unknown>) => {
        Object.assign(storageState, items)
      }
    }
    const tabs = { get: async () => ({ id: 1, url: PAGE_URL }) }
    const create = () =>
      new Coordinator({
        storage,
        tabs,
        ensureHostDocument: async () => ({ phase: 'ready', created: false }),
        probeHost: async () => ({ hostId: 'restored-host', phase: 'ready' }),
        destroyHostDocument: async () => {},
        attachPage: async ({ pageId }) => pageSnapshot(pageId),
        detachPage: async () => {}
      })

    const original = create()
    await original.registerPage({ domain: DOMAIN, pageId: 'page-a', tab: { id: 1, url: PAGE_URL } })
    const restarted = create()
    await restarted.restore()
    await restarted.restore()
    await restarted.registerPage({ domain: DOMAIN, pageId: 'page-a', tab: { id: 1, url: PAGE_URL } })

    expect(restarted.snapshotForTest()).toMatchObject({
      generation: 1,
      hostPhase: 'ready',
      tabs: [{ tabId: 1, domain: DOMAIN, pageId: 'page-a' }]
    })
  })

  it('rebuilds a stale Offscreen provider from the background health sweep without a page watchdog', async () => {
    const fixture = createCoordinatorFixture()
    await fixture.registerPage('page-a')
    const firstHostId = (await fixture.currentServer().getSnapshot()).hostId

    fixture.killProvider()
    fixture.clock.advance(COORDINATOR_HEALTH_INTERVAL_MS)

    await vi.waitFor(async () => {
      const next = await fixture.currentServer().getSnapshot()
      expect(next.hostId).not.toBe(firstHostId)
      expect(next.hostPhase).toBe('ready')
      expect(fixture.coordinator.snapshotForTest()).toMatchObject({
        generation: 2,
        hostPhase: 'ready',
        tabs: [{ tabId: 1, domain: DOMAIN, pageId: 'page-a' }]
      })
    })
    expect(fixture.destroyedDocuments()).toBe(1)
    expect(fixture.hostNumber()).toBe(2)
  })

  it('detects a new provider identity behind an existing host document', async () => {
    const fixture = createCoordinatorFixture()
    await fixture.registerPage('page-a')
    const firstHostId = (await fixture.currentServer().getSnapshot()).hostId

    fixture.replaceProvider()
    fixture.clock.advance(COORDINATOR_HEALTH_INTERVAL_MS)

    await vi.waitFor(async () => {
      expect((await fixture.currentServer().getSnapshot()).hostId).not.toBe(firstHostId)
      expect(fixture.coordinator.snapshotForTest()).toMatchObject({ generation: 2, hostPhase: 'ready' })
    })
    expect(fixture.destroyedDocuments()).toBe(0)
    expect(fixture.hostNumber()).toBe(2)
  })

  it('reports unavailable when a stale provider cannot be replaced', async () => {
    let ensureCount = 0
    let destroyed = 0
    const coordinator = new Coordinator({
      storage: { get: async () => ({}), set: async () => {} },
      tabs: { get: async () => ({ id: 1, url: PAGE_URL }) },
      ensureHostDocument: async () =>
        ++ensureCount === 1 ? { phase: 'ready', created: false } : { phase: 'unavailable', created: false },
      probeHost: async () => {
        throw new Error('stale provider')
      },
      destroyHostDocument: async () => {
        destroyed += 1
      },
      attachPage: async ({ pageId }) => pageSnapshot(pageId),
      detachPage: async () => {}
    })

    await expect(
      coordinator.registerPage({ domain: DOMAIN, pageId: 'page-a', tab: { id: 1, url: PAGE_URL } })
    ).rejects.toThrow('Runtime host unavailable: unavailable')
    expect(coordinator.snapshotForTest()).toMatchObject({ hostPhase: 'unavailable', hostId: null })
    expect(destroyed).toBe(1)
  })

  it('keeps a physical tab binding and Runtime lease across page heartbeat loss', async () => {
    const fixture = createCoordinatorFixture()
    await fixture.registerPage('crashed-page')

    fixture.clock.current += 60_000
    await vi.advanceTimersByTimeAsync(60_000)

    expect(fixture.detached).toEqual([])
    expect(fixture.storageState[COORDINATOR_SESSION_KEY]).toMatchObject({
      tabs: [{ tabId: 1, domain: DOMAIN, pageId: 'crashed-page' }]
    })
    expect(fixture.coordinator.snapshotForTest()).toMatchObject({
      tabs: [{ tabId: 1, domain: DOMAIN, pageId: 'crashed-page' }]
    })
    expect((await fixture.currentServer().getSnapshot()).domains[0]?.pageIds).toEqual(['crashed-page'])
  })
})
