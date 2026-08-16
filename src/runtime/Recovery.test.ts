import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Clock } from '@/domain/runtime/externs/Clock'
import type { RoomTransport } from '@/runtime/RoomTransport'
import { ChatRoom } from '@/domain/impls/runtime/ChatRoom'
import { createMemoryMessageDatabase } from '@/domain/impls/database/Memory'
import { createMessageStore } from '@/domain/MessageStore'
import { MESSAGE_RECORD_TYPE } from '@/domain/Message'
import type { ChatMessage } from '@/protocol'
import type { RuntimeCoordinator, RuntimeServer, RuntimeSnapshot } from '@/runtime/Contract'
import { ClientLease } from '@/runtime/ClientLease'
import { COORDINATOR_HEALTH_INTERVAL_MS, COORDINATOR_SESSION_KEY, Coordinator } from '@/runtime/Coordinator'
import { createServer } from '@/runtime/Server'

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
  async sleep() {
    await Promise.resolve()
    await Promise.resolve()
  }
  advance(ms: number) {
    this.current += ms
    vi.advanceTimersByTime(ms)
  }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

const createTransport = (peerId: string): RoomTransport => ({
  peerIdOf: () => peerId,
  join: async () => {},
  leave: () => {},
  send: async () => {},
  onMessage: () => () => {},
  onPeerJoin: () => () => {},
  onPeerLeave: () => () => {},
  onRoomClose: () => () => {},
  onError: () => () => {},
  dispose: () => {}
})

const createCoordinatorFixture = () => {
  const clock = new FakeClock()
  const storageState: Record<string, unknown> = {}
  const detached: { domain: string; pageId: string }[] = []
  let hostDocumentExists = false
  let providerAlive = false
  let destroyedDocuments = 0
  let hostNumber = 0
  let currentServer: RuntimeServer | null = null
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
      currentServer = createServer({ transport: createTransport(`peer-${hostNumber}`), clock })
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
    },
    killProvider: () => {
      providerAlive = false
    },
    replaceProvider: () => {
      providerAlive = true
      hostNumber += 1
      currentServer = createServer({ transport: createTransport(`peer-${hostNumber}`), clock })
    },
    destroyedDocuments: () => destroyedDocuments,
    hostNumber: () => hostNumber,
    currentServer: () => currentServer!,
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
    const sentIds: string[] = []
    const serverWithSendEvidence = new Proxy(fixture.serverProxy, {
      get: (target, property: keyof RuntimeServer) => {
        if (property !== 'sendChatMessage') return target[property]
        return async (payload: { domain: string; event: ChatMessage }) => {
          sentIds.push(payload.event.id)
          return target.sendChatMessage(payload)
        }
      }
    })
    const room = new ChatRoom({
      server: serverWithSendEvidence,
      messageStore,
      pageDomain: DOMAIN,
      pageId: 'page-a',
      getSnapshot: () => client.snapshot(),
      whenReady: (callback) => client.whenReady(callback)
    })
    const roomErrors: unknown[] = []
    room.onError((error) => roomErrors.push(error))
    const recoveredSessions: { sessionId: string; user: typeof USER }[][] = []
    room.onSessions((sessions) => recoveredSessions.push([...sessions]))
    let pageJoinTask = Promise.resolve()
    const joinRejections: unknown[] = []
    client.whenReady(() => {
      const joinAfterTail = () => room.joinRoom({ user: USER, site: SITE })
      pageJoinTask = pageJoinTask.then(joinAfterTail, (error: unknown) => {
        // The prior attempt remains caller-owned; only this exact transient permits the serialized
        // recovery tail to continue.
        expect(error).toEqual(new Error('Runtime host unavailable: connecting'))
        joinRejections.push(error)
        return joinAfterTail()
      })
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
      expect(sentIds).toEqual([])
      expect(recoveredSessions).toEqual([[{ sessionId: expect.any(String), user: USER }]])
      await expect(messageStore.query({ type: MESSAGE_RECORD_TYPE.CHAT_MESSAGE })).resolves.toEqual([])
    })
    await pageJoinTask
    expect(fixture.coordinator.snapshotForTest().generation).toBe(2)
    expect(hostPhases).toContain('connecting')
    expect(hostPhases.at(-1)).toBe('ready')
    // The healthy recovery flow emits no page errors and no unexpected join rejections.
    expect(roomErrors).toEqual([])
    expect(joinRejections).toEqual([])
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

  it('preserves a host creation provider Error for the registering page', async () => {
    const providerError = new Error('offscreen creation refused')
    const coordinator = new Coordinator({
      storage: { get: async () => ({}), set: async () => {} },
      tabs: { get: async () => ({ id: 1, url: PAGE_URL }) },
      ensureHostDocument: async () => Promise.reject(providerError),
      probeHost: async () => ({ hostId: 'unreachable', phase: 'ready' }),
      destroyHostDocument: async () => {},
      attachPage: async ({ pageId }) => pageSnapshot(pageId),
      detachPage: async () => {}
    })

    await expect(
      coordinator.registerPage({ domain: DOMAIN, pageId: 'page-a', tab: { id: 1, url: PAGE_URL } })
    ).rejects.toBe(providerError)
    expect(coordinator.snapshotForTest()).toMatchObject({ hostPhase: 'unavailable', hostId: null })
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
