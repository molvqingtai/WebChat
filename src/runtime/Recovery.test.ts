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
import {
  COORDINATOR_HEALTH_INTERVAL_MS,
  COORDINATOR_LEASE_TTL_MS,
  COORDINATOR_SESSION_KEY,
  Coordinator
} from '@/runtime/Coordinator'
import { createServer } from '@/runtime/Server'

const DOMAIN = 'https://example.com'
const USER = { id: 'user-1', name: 'User', avatar: '' }
const SITE = { origin: DOMAIN, title: 'Example' }

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

const createTransport = (peerId: string): RoomTransport => ({
  peerId,
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

  const coordinator = new Coordinator({
    clock,
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
    detachPage: async (lease) => {
      detached.push(lease)
      await currentServer?.detachPage(lease)
    }
  })

  const coordinatorApi: RuntimeCoordinator = {
    ensureHost: () => coordinator.ensureHost(),
    registerPage: (lease) => coordinator.registerPage(lease),
    unregisterPage: (lease) => coordinator.unregisterPage(lease)
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
    currentServer: () => currentServer!
  }
}

describe('Runtime host recovery and coordinator liveness', () => {
  it('reattaches to a newly created empty Server without an outbound recovery scan', async () => {
    const fixture = createCoordinatorFixture()
    const hostPhases: RuntimeSnapshot['hostPhase'][] = []
    const client = new ClientLease({
      coordinator: fixture.coordinatorApi,
      server: fixture.serverProxy,
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
      expect(sentIds).toEqual([])
      expect(recoveredSessions).toEqual([[{ sessionId: expect.any(String), user: USER }]])
      await expect(messageStore.query({ type: MESSAGE_RECORD_TYPE.CHAT_MESSAGE })).resolves.toEqual([])
    })
    expect(fixture.coordinator.snapshotForTest().generation).toBe(2)
    expect(hostPhases).toContain('connecting')
    expect(hostPhases.at(-1)).toBe('ready')
  })

  it('restores persisted coordinator lease and host generation without duplicate pages', async () => {
    const clock = new FakeClock()
    const storageState: Record<string, unknown> = {}
    const storage = {
      get: async (key: string) => ({ [key]: storageState[key] }),
      set: async (items: Record<string, unknown>) => {
        Object.assign(storageState, items)
      }
    }
    const create = () =>
      new Coordinator({
        clock,
        storage,
        ensureHostDocument: async () => ({ phase: 'ready', created: false }),
        probeHost: async () => ({ hostId: 'restored-host', phase: 'ready' }),
        destroyHostDocument: async () => {},
        detachPage: async () => {}
      })

    const original = create()
    await original.registerPage({ domain: DOMAIN, pageId: 'page-a' })
    const restarted = create()
    await restarted.restore()
    await restarted.restore()
    await restarted.registerPage({ domain: DOMAIN, pageId: 'page-a' })

    expect(restarted.snapshotForTest()).toMatchObject({
      generation: 1,
      hostPhase: 'ready',
      pages: [{ domain: DOMAIN, pageId: 'page-a' }]
    })
  })

  it('rebuilds a stale Offscreen provider from the background health sweep without a page watchdog', async () => {
    const fixture = createCoordinatorFixture()
    await fixture.coordinator.registerPage({ domain: DOMAIN, pageId: 'page-a' })
    await fixture.currentServer().attachPage({ domain: DOMAIN, pageId: 'page-a' })
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
        pages: [{ domain: DOMAIN, pageId: 'page-a' }]
      })
    })
    expect(fixture.destroyedDocuments()).toBe(1)
    expect(fixture.hostNumber()).toBe(2)
  })

  it('detects a new provider identity behind an existing host document', async () => {
    const fixture = createCoordinatorFixture()
    await fixture.coordinator.registerPage({ domain: DOMAIN, pageId: 'page-a' })
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
      clock: new FakeClock(),
      storage: { get: async () => ({}), set: async () => {} },
      ensureHostDocument: async () =>
        ++ensureCount === 1 ? { phase: 'ready', created: false } : { phase: 'unavailable', created: false },
      probeHost: async () => {
        throw new Error('stale provider')
      },
      destroyHostDocument: async () => {
        destroyed += 1
      },
      detachPage: async () => {}
    })

    await expect(coordinator.registerPage({ domain: DOMAIN, pageId: 'page-a' })).resolves.toMatchObject({
      phase: 'unavailable'
    })
    expect(coordinator.snapshotForTest()).toMatchObject({ hostPhase: 'unavailable', hostId: null })
    expect(destroyed).toBe(1)
  })

  it('expires a crashed page heartbeat, synchronizes Runtime detach, and removes the persisted fact', async () => {
    const fixture = createCoordinatorFixture()
    await fixture.coordinator.registerPage({ domain: DOMAIN, pageId: 'crashed-page' })
    await fixture.currentServer().attachPage({ domain: DOMAIN, pageId: 'crashed-page' })

    fixture.clock.current += COORDINATOR_LEASE_TTL_MS
    vi.advanceTimersByTime(COORDINATOR_HEALTH_INTERVAL_MS)

    await vi.waitFor(() => {
      expect(fixture.detached).toEqual([{ domain: DOMAIN, pageId: 'crashed-page' }])
      expect(fixture.storageState[COORDINATOR_SESSION_KEY]).toMatchObject({ pages: [] })
    })
    expect(fixture.coordinator.snapshotForTest().pages).toEqual([])
    expect((await fixture.currentServer().getSnapshot()).domains[0]?.pageIds ?? []).toEqual([])
  })
})
