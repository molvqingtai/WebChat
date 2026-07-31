import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createServer, disposeServer, getChatRoomId, getWorldRoomId } from '@/runtime/Server'
import type { Clock } from '@/domain/runtime/externs/Clock'
import type { RoomTransport } from '@/runtime/RoomTransport'
import type { UserInfo } from '@/domain/UserInfo'
import type { WireCodec } from '@/protocol'
import {
  MESSAGE_TYPE,
  type ChatRoomMessage,
  type ChatUser,
  type TextMessage,
  type ChatSite,
  type WorldRoomMessage
} from '@/protocol'
import { MESSAGE_RECORD_TYPE, type TextMessageRecord } from '@/domain/Message'
import type {
  HistorySupplyRequest,
  HistorySupplyResult,
  RuntimeServer,
  RuntimeSession,
  RuntimeSessionEvent,
  WorldPresenceEvent
} from '@/runtime/Contract'
import { HISTORY_WINDOW_DAYS, RUNTIME_DOMAIN_GRACE_MS } from '@/constants/config'
import { createArticoRoomTransport } from '@/runtime/ArticoRoomTransport'
import { PagePort } from '@/runtime/PagePort'
import type { PresenceStore } from '@/domain/runtime/externs/PresenceStore'
import { createBrowserPresenceStore, createMemoryPresenceStore } from '@/runtime/PresenceStore'

const NOW = 1_800_000_000_000
const PHYSICAL_ROOM_JOIN_TIMEOUT_MS = 10000
const DOMAIN = 'https://example.com'
const OTHER_DOMAIN = 'https://other.example'
const USER: ChatUser = { id: 'local-user', name: 'Local', avatar: '' }
const USER_INFO: UserInfo = {
  ...USER,
  createTime: NOW,
  themeMode: 'system',
  danmakuEnabled: true,
  notificationEnabled: true,
  notificationType: 'all'
}
const REMOTE_USER: ChatUser = { id: 'remote-user', name: 'Remote', avatar: '' }
const SITE = { origin: DOMAIN, title: 'Example', icon: 'https://example.com/favicon.ico' }

interface RuntimeArticoRoom {
  open(peerId: string): void
  loseReadiness(peerId: string): void
  closeUnexpectedly(): void
  readonly attempts: { peerId: string; payload: string }[]
  readonly sent: { peerId: string; payload: string }[]
}

interface RuntimeArticoJoinPlan {
  peers: string[]
  closing: string[]
}

const runtimeArticoFixture = vi.hoisted(() => ({
  rooms: new Map<string, RuntimeArticoRoom>(),
  nextJoins: new Map<string, RuntimeArticoJoinPlan>()
}))

vi.mock('@rtco/client', () => {
  class Emitter {
    private readonly listeners = new Map<string, Set<(...args: unknown[]) => void>>()

    on(event: string, listener: (...args: unknown[]) => void) {
      const listeners = this.listeners.get(event) ?? new Set()
      listeners.add(listener)
      this.listeners.set(event, listeners)
      return this
    }

    emit(event: string, ...args: unknown[]) {
      this.listeners.get(event)?.forEach((listener) => listener(...args))
    }
  }

  class FakeRoom extends Emitter implements RuntimeArticoRoom {
    private readonly peers = new Map<string, boolean>()
    readonly attempts: { peerId: string; payload: string }[] = []
    readonly sent: { peerId: string; payload: string }[] = []

    send(payload: string, target?: string | string[]) {
      const targets = target ? (Array.isArray(target) ? target : [target]) : null
      this.peers.forEach((ready, peerId) => {
        if (targets && !targets.includes(peerId)) return
        this.attempts.push({ peerId, payload })
        if (!ready) throw new Error('Connection is not established yet.')
        this.sent.push({ peerId, payload })
      })
    }

    open(peerId: string) {
      this.peers.set(peerId, true)
      this.emit('join', peerId)
    }

    loseReadiness(peerId: string) {
      this.peers.set(peerId, false)
    }

    closeUnexpectedly() {
      this.emit('close')
    }

    leave() {
      this.emit('close')
    }
  }

  class FakeArtico extends Emitter {
    readonly id = 'local-peer'
    readonly state = 'ready'

    join(roomId: string) {
      const room = new FakeRoom()
      runtimeArticoFixture.rooms.set(roomId, room)
      const plan = runtimeArticoFixture.nextJoins.get(roomId)
      runtimeArticoFixture.nextJoins.delete(roomId)
      if (plan) {
        void Promise.resolve().then(() => {
          plan.peers.forEach((peerId) => room.open(peerId))
          plan.closing.forEach((peerId) => room.loseReadiness(peerId))
        })
      }
      return room
    }

    close() {}
  }

  return { Artico: FakeArtico }
})

type TestWireMessage = ChatRoomMessage | (WorldRoomMessage & { type?: never })
const isWorldPresence = (message: TestWireMessage): message is WorldRoomMessage & { type?: never } => 'sites' in message

interface ObservedLocalSession {
  domain: string
  session: Omit<RuntimeSession, 'sourcePeerId'>
}

interface SessionObservers {
  local: Set<(event: ObservedLocalSession) => void | Promise<void>>
  remote: Set<(event: { domain: string; session: RuntimeSession }) => void | Promise<void>>
  registered: boolean
}

const observersByServer = new WeakMap<RuntimeServer, Map<string, SessionObservers>>()

const sessionObservers = (server: RuntimeServer, pageId: string): SessionObservers => {
  let byPage = observersByServer.get(server)
  if (!byPage) {
    byPage = new Map()
    observersByServer.set(server, byPage)
  }
  let observers = byPage.get(pageId)
  if (!observers) {
    observers = { local: new Set(), remote: new Set(), registered: false }
    byPage.set(pageId, observers)
  }
  return observers
}

const registerSessionObservers = async (server: RuntimeServer, pageId: string, observers: SessionObservers) => {
  if (observers.registered) return
  observers.registered = true
  await server.onSessionEvent({ pageId }, async (event: RuntimeSessionEvent) => {
    if (event.type === 'snapshot' && event.snapshot.localSession) {
      for (const listener of observers.local) {
        await listener({ domain: event.domain, session: event.snapshot.localSession })
      }
    }
    const sessions = event.type === 'replace' || event.type === 'join' ? [event.session] : []
    for (const session of sessions) {
      for (const listener of observers.remote) await listener({ domain: event.domain, session })
    }
  })
}

const observeLocalSessions = async (
  server: RuntimeServer,
  { pageId }: { pageId: string },
  listener: (event: ObservedLocalSession) => void | Promise<void>
) => {
  const observers = sessionObservers(server, pageId)
  observers.local.add(listener)
  await registerSessionObservers(server, pageId, observers)
}

const observeRemoteSessions = async (
  server: RuntimeServer,
  { pageId }: { pageId: string },
  listener: (event: { domain: string; session: RuntimeSession }) => void | Promise<void>
) => {
  const observers = sessionObservers(server, pageId)
  observers.remote.add(listener)
  await registerSessionObservers(server, pageId, observers)
}

class FakeClock implements Clock {
  constructor(private current = NOW) {}

  now() {
    return this.current
  }

  advance(ms: number) {
    this.current += ms
    vi.advanceTimersByTime(ms)
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  runtimeArticoFixture.rooms.clear()
  runtimeArticoFixture.nextJoins.clear()
})
afterEach(() => {
  runtimeArticoFixture.rooms.clear()
  runtimeArticoFixture.nextJoins.clear()
  vi.useRealTimers()
})

const jsonCodec: WireCodec = {
  encode: async (value) => JSON.stringify(value),
  decode: async (payload) => JSON.parse(payload)
}

const createFakeTransport = ({ physicalReady = true }: { physicalReady?: boolean } = {}) => {
  const desired = new Set<string>()
  const joined = new Set<string>()
  const joinCalls: string[] = []
  const physicalJoinCalls: string[] = []
  const sent: { roomId: string; payload: string; to?: string | string[] }[] = []
  const sendAttempts: { roomId: string; payload: string; to?: string | string[] }[] = []
  const sendAttemptWaiters: {
    roomId?: string
    resolve: (attempt: (typeof sendAttempts)[number]) => void
  }[] = []
  const pendingJoins = new Map<
    string,
    { promise: Promise<void>; resolve: () => void; reject: (error: Error) => void }
  >()
  const desiredWaiters: { count: number; resolve: () => void }[] = []
  const joinCallWaiters: { count: number; resolve: () => void }[] = []
  const messageListeners = new Set<(roomId: string, sourcePeerId: string, rawPayload: string) => void>()
  const joinListeners = new Set<(roomId: string, peerId: string) => void>()
  const leaveListeners = new Set<(roomId: string, peerId: string) => void>()
  const closeListeners = new Set<(roomId: string) => void>()
  let sendError: Error | null = null
  let blockedSendRoomId: string | null = null
  let sendGate: Promise<void> | null = null
  let releaseSendGate = () => {}
  let historySendGate: Promise<void> | null = null
  let releaseHistorySendGate = () => {}
  let activeHistorySends = 0
  let maxActiveHistorySends = 0
  let disposeCount = 0

  const createPendingJoin = () => {
    let resolve!: () => void
    let reject!: (error: Error) => void
    const promise = new Promise<void>((onResolve, onReject) => {
      resolve = onResolve
      reject = onReject
    })
    return { promise, resolve, reject }
  }
  const resolveDesiredWaiters = () => {
    desiredWaiters.forEach((waiter) => {
      if (desired.size >= waiter.count) waiter.resolve()
    })
    desiredWaiters.splice(0, desiredWaiters.length, ...desiredWaiters.filter((waiter) => desired.size < waiter.count))
  }
  const resolveJoinCallWaiters = () => {
    joinCallWaiters.forEach((waiter) => {
      if (joinCalls.length >= waiter.count) waiter.resolve()
    })
    joinCallWaiters.splice(
      0,
      joinCallWaiters.length,
      ...joinCallWaiters.filter((waiter) => joinCalls.length < waiter.count)
    )
  }

  const transport: RoomTransport = {
    peerId: 'local-peer',
    join: (roomId) => {
      joinCalls.push(roomId)
      resolveJoinCallWaiters()
      desired.add(roomId)
      resolveDesiredWaiters()
      if (joined.has(roomId)) return Promise.resolve()
      if (physicalReady) {
        joined.add(roomId)
        physicalJoinCalls.push(roomId)
        return Promise.resolve()
      }
      const pending = pendingJoins.get(roomId) ?? createPendingJoin()
      pendingJoins.set(roomId, pending)
      return pending.promise
    },
    leave: (roomId) => {
      desired.delete(roomId)
      joined.delete(roomId)
      pendingJoins.get(roomId)?.reject(new Error(`Room "${roomId}" join cancelled`))
      pendingJoins.delete(roomId)
    },
    send: async (roomId, payload, to) => {
      const attempt = { roomId, payload, to }
      sendAttempts.push(attempt)
      const matchingWaiters = sendAttemptWaiters.filter((waiter) => !waiter.roomId || waiter.roomId === roomId)
      sendAttemptWaiters.splice(
        0,
        sendAttemptWaiters.length,
        ...sendAttemptWaiters.filter((waiter) => !matchingWaiters.includes(waiter))
      )
      matchingWaiters.forEach((waiter) => waiter.resolve(attempt))
      if (!joined.has(roomId)) throw new Error(`Room "${roomId}" not joined`)
      if (sendError) throw sendError
      sent.push(attempt)
      if (sendGate && roomId === blockedSendRoomId) await sendGate
      const message = JSON.parse(payload) as TestWireMessage
      if (!('type' in message) || message.type !== MESSAGE_TYPE.HISTORY_RESPONSE) return
      if (!historySendGate) return
      activeHistorySends += 1
      maxActiveHistorySends = Math.max(maxActiveHistorySends, activeHistorySends)
      try {
        await historySendGate
      } finally {
        activeHistorySends -= 1
      }
    },
    onMessage: (callback) => {
      messageListeners.add(callback)
      return () => messageListeners.delete(callback)
    },
    onPeerJoin: (callback) => {
      joinListeners.add(callback)
      return () => joinListeners.delete(callback)
    },
    onPeerLeave: (callback) => {
      leaveListeners.add(callback)
      return () => leaveListeners.delete(callback)
    },
    onRoomClose: (callback) => {
      closeListeners.add(callback)
      return () => closeListeners.delete(callback)
    },
    onError: () => () => {},
    dispose: () => {
      disposeCount += 1
      desired.clear()
      joined.clear()
      pendingJoins.forEach((pending, roomId) => pending.reject(new Error(`Room "${roomId}" join cancelled`)))
      pendingJoins.clear()
      releaseSendGate()
      sendGate = null
      blockedSendRoomId = null
      desiredWaiters.splice(0).forEach((waiter) => waiter.resolve())
      joinCallWaiters.splice(0).forEach((waiter) => waiter.resolve())
      sendAttemptWaiters.length = 0
      messageListeners.clear()
      joinListeners.clear()
      leaveListeners.clear()
      closeListeners.clear()
    }
  }

  return {
    transport,
    desired,
    joined,
    joinCalls,
    physicalJoinCalls,
    sent,
    sendAttempts,
    waitForSendAttempt: (roomId?: string) =>
      new Promise<(typeof sendAttempts)[number]>((resolve) => sendAttemptWaiters.push({ roomId, resolve })),
    waitForDesiredRooms: (count: number) =>
      desired.size >= count
        ? Promise.resolve()
        : new Promise<void>((resolve) => desiredWaiters.push({ count, resolve })),
    waitForJoinCalls: (count: number) =>
      joinCalls.length >= count
        ? Promise.resolve()
        : new Promise<void>((resolve) => joinCallWaiters.push({ count, resolve })),
    open: () => {
      physicalReady = true
      desired.forEach((roomId) => {
        if (!joined.has(roomId)) physicalJoinCalls.push(roomId)
        joined.add(roomId)
        pendingJoins.get(roomId)?.resolve()
        pendingJoins.delete(roomId)
      })
    },
    makeNotReady: () => {
      physicalReady = false
    },
    failSend: (error: Error | null) => {
      sendError = error
    },
    hangSendsTo: (roomId: string) => {
      blockedSendRoomId = roomId
      sendGate = new Promise<void>((resolve) => {
        releaseSendGate = resolve
      })
    },
    releaseSends: () => {
      releaseSendGate()
      sendGate = null
      blockedSendRoomId = null
    },
    hangHistoryResponseSends: () => {
      historySendGate = new Promise<void>((resolve) => {
        releaseHistorySendGate = resolve
      })
    },
    releaseHistoryResponseSends: () => {
      releaseHistorySendGate()
      historySendGate = null
    },
    activeHistorySends: () => activeHistorySends,
    maxActiveHistorySends: () => maxActiveHistorySends,
    disposeCount: () => disposeCount,
    receive: (roomId: string, sourcePeerId: string, message: unknown) => {
      if (!joined.has(roomId)) return
      messageListeners.forEach((listener) => listener(roomId, sourcePeerId, JSON.stringify(message)))
    },
    peerJoin: (roomId: string, peerId: string) => {
      if (!joined.has(roomId)) return
      joinListeners.forEach((listener) => listener(roomId, peerId))
    },
    peerLeave: (roomId: string, peerId: string) => leaveListeners.forEach((listener) => listener(roomId, peerId)),
    roomClose: (roomId: string) => {
      joined.delete(roomId)
      closeListeners.forEach((listener) => listener(roomId))
    },
    messages: (roomId: string) =>
      sent.filter((item) => item.roomId === roomId).map((item) => JSON.parse(item.payload) as TestWireMessage)
  }
}

const settle = async () => {
  await vi.advanceTimersByTimeAsync(0)
}

const articoRoom = (roomId: string) => {
  const room = runtimeArticoFixture.rooms.get(roomId)
  if (!room) throw new Error(`Artico test room "${roomId}" missing`)
  return room
}

const articoMessagesTo = (room: RuntimeArticoRoom, peerId: string) =>
  room.sent.filter((item) => item.peerId === peerId).map((item) => JSON.parse(item.payload) as TestWireMessage)

const createArticoTestServer = async (roomIds: string[], codec: WireCodec = jsonCodec) => {
  const transport = createArticoRoomTransport()
  await Promise.all(roomIds.map((roomId) => transport.join(roomId)))
  return createServer({ transport, clock: new FakeClock(), codec })
}

const deferred = <T>() => {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((next, fail) => {
    resolve = next
    reject = fail
  })
  return { promise, resolve, reject }
}

const sentToPeer = (fake: ReturnType<typeof createFakeTransport>, roomId: string, peerId: string) =>
  fake.sent
    .filter((message) => {
      const recipients = typeof message.to === 'string' ? [message.to] : message.to
      return message.roomId === roomId && recipients?.includes(peerId)
    })
    .map((message) => JSON.parse(message.payload) as TestWireMessage)

const broadcastsToRoom = (fake: ReturnType<typeof createFakeTransport>, roomId: string) =>
  fake.sent
    .filter((message) => message.roomId === roomId && message.to === undefined)
    .map((message) => JSON.parse(message.payload) as TestWireMessage)

const session = (user = REMOTE_USER) => ({
  type: MESSAGE_TYPE.SESSION,
  sessionId: `session-${user.id}`,
  presenceId: `presence-${user.id}`,
  joinedAt: NOW + 1,
  user
})

const text = (id: string, userId = REMOTE_USER.id, timestamp = NOW): TextMessage => ({
  type: MESSAGE_TYPE.TEXT,
  id,
  hlc: { timestamp, counter: 0 },
  userId,
  body: 'hello',
  mentions: []
})

const textRecord = (id: string, timestamp = NOW): TextMessageRecord => ({
  type: MESSAGE_RECORD_TYPE.CHAT_MESSAGE,
  id,
  message: text(id, USER.id, timestamp),
  user: USER,
  receivedAt: timestamp
})

const setup = async (domain = DOMAIN, now = NOW) => {
  const clock = new FakeClock(now)
  const fake = createFakeTransport()
  const server = createServer({ transport: fake.transport, clock, codec: jsonCodec })
  await server.attachPage({ domain, pageId: 'page-a' })
  await server.joinChatRoom({ domain, user: USER, site: { ...SITE, origin: domain } })
  await settle()
  return { clock, fake, server, roomId: getChatRoomId(domain) }
}

const registerHistoryProvider = (
  server: RuntimeServer,
  payload: { domain: string; pageId: string },
  supply: (request: HistorySupplyRequest, signal: AbortSignal) => Promise<HistorySupplyResult>
) => {
  const active = new Map<string, AbortController>()
  return server.provideHistory(payload, (event) => {
    if (event.type === 'cancel') {
      active.get(event.supplyId)?.abort(new DOMException('History supply cancelled', 'AbortError'))
      return
    }
    const controller = new AbortController()
    active.set(event.request.supplyId, controller)
    void Promise.resolve()
      .then(() => supply(event.request, controller.signal))
      .then((result) => {
        controller.signal.throwIfAborted()
        if (active.get(event.request.supplyId) !== controller) return
        return server.resolveHistorySupply({
          pageId: payload.pageId,
          supplyId: event.request.supplyId,
          result
        })
      })
      .catch((error) => {
        if (active.get(event.request.supplyId) !== controller) return
        return server.rejectHistorySupply({
          pageId: payload.pageId,
          supplyId: event.request.supplyId,
          reason: (error as Error).message
        })
      })
      .finally(() => {
        if (active.get(event.request.supplyId) === controller) active.delete(event.request.supplyId)
      })
  })
}

describe('RuntimeServer lifecycle', () => {
  it('returns the committed local snapshot without awaiting active Presence persistence', async () => {
    const values: Record<string, unknown> = {}
    const activeStarted = deferred<void>()
    const releaseActive = deferred<void>()
    let writeCount = 0
    const presenceStore = createBrowserPresenceStore({
      get: async (key) => ({ [key]: values[key] }),
      set: async (items) => {
        writeCount += 1
        if (writeCount === 2) {
          activeStarted.resolve()
          await releaseActive.promise
        }
        Object.assign(values, items)
      }
    })
    const clock = new FakeClock()
    const fake = createFakeTransport()
    const server = createServer({ transport: fake.transport, clock, codec: jsonCodec, presenceStore })
    await server.attachPage({ domain: DOMAIN, pageId: 'page-a' })
    let joinedSnapshot: Awaited<ReturnType<RuntimeServer['joinChatRoom']>> | undefined
    const join = server.joinChatRoom({ domain: DOMAIN, user: USER, site: SITE }).then((snapshot) => {
      joinedSnapshot = snapshot
      return snapshot
    })
    await activeStarted.promise
    await settle()

    try {
      expect(joinedSnapshot?.domains[0]).toMatchObject({
        domain: DOMAIN,
        chatRoomJoined: true,
        localSession: { user: USER }
      })
    } finally {
      releaseActive.resolve()
      await join
      disposeServer(server)
    }
  })

  it('drains final release past a timed-out active Presence write and fences its late completion', async () => {
    const durable = createMemoryPresenceStore()
    const activeStarted = deferred<void>()
    const releaseActive = deferred<void>()
    let heldActive = false
    const presenceStore: PresenceStore = {
      load: (domain) => durable.load(domain),
      save: async (record) => {
        if (record.local?.status === 'active' && !heldActive) {
          heldActive = true
          activeStarted.resolve()
          await releaseActive.promise
        }
        await durable.save(record)
      }
    }
    const clock = new FakeClock()
    const fake = createFakeTransport()
    const server = createServer({ transport: fake.transport, clock, codec: jsonCodec, presenceStore })
    await server.attachPage({ domain: DOMAIN, pageId: 'page-a' })
    const join = server.joinChatRoom({ domain: DOMAIN, user: USER, site: SITE })
    await activeStarted.promise
    await join

    try {
      await server.detachPage({ domain: DOMAIN, pageId: 'page-a' })
      clock.advance(RUNTIME_DOMAIN_GRACE_MS + 1)
      await settle()
      clock.advance(5001)
      await settle()

      await vi.waitFor(async () => expect((await server.getSnapshot()).domains).toEqual([]))
      expect(fake.joined.size).toBe(0)

      releaseActive.resolve()
      await vi.waitFor(async () => {
        const stored = await durable.load(DOMAIN)
        expect(stored?.local).toBeUndefined()
        expect(stored?.inflightEnd).toBeUndefined()
        expect(stored?.pendingEnd).toBeUndefined()
        expect(stored?.settledEnd).toBeUndefined()
      })
    } finally {
      releaseActive.resolve()
      await settle()
      disposeServer(server)
    }
  })

  it('projects the production page user shape to the wire identity before joining', async () => {
    const clock = new FakeClock()
    const fake = createFakeTransport()
    const server = createServer({ transport: fake.transport, clock, codec: jsonCodec })
    await server.attachPage({ domain: DOMAIN, pageId: 'page-a' })

    const snapshot = await server.joinChatRoom({ domain: DOMAIN, user: USER_INFO, site: SITE })
    if (!snapshot) throw new Error('Join was cancelled')

    expect(fake.joinCalls).toEqual([getChatRoomId(DOMAIN), getWorldRoomId()])
    expect(fake.physicalJoinCalls).toEqual([getChatRoomId(DOMAIN), getWorldRoomId()])
    expect(
      fake.messages(getChatRoomId(DOMAIN)).filter((message) => message.type === MESSAGE_TYPE.SESSION)
    ).toHaveLength(1)
    expect(snapshot.domains[0].localSession?.user).toEqual(USER)
    const presence = fake.messages(getWorldRoomId()).find(isWorldPresence)
    expect(presence?.user).toEqual(USER)
    expect(Object.keys(presence?.user ?? {})).toEqual(['id', 'name', 'avatar'])
  })

  it('keeps an existing-user join provisional until cold physical rooms are ready', async () => {
    const clock = new FakeClock()
    const fake = createFakeTransport({ physicalReady: false })
    const server = createServer({ transport: fake.transport, clock, codec: jsonCodec })
    const roomId = getChatRoomId(DOMAIN)
    const worldRoomId = getWorldRoomId()
    const localSessions: ObservedLocalSession[] = []
    const remoteSessions: string[] = []
    const worldPresences: WorldPresenceEvent[] = []
    const localSessionSeen = deferred<void>()
    const localPresenceSeen = deferred<void>()
    const remoteSessionSeen = deferred<void>()
    const remotePresenceSeen = deferred<void>()
    await server.attachPage({ domain: DOMAIN, pageId: 'page-a' })
    await observeLocalSessions(server, { pageId: 'page-a' }, (event) => {
      localSessions.push(event)
      localSessionSeen.resolve()
    })
    await observeRemoteSessions(server, { pageId: 'page-a' }, (event) => {
      remoteSessions.push(event.session.sourcePeerId)
      remoteSessionSeen.resolve()
    })
    await server.onWorldPresence({ pageId: 'page-a' }, (event) => {
      worldPresences.push(event)
      if (event.sourcePeerId === 'local-peer') localPresenceSeen.resolve()
      if (event.sourcePeerId === 'remote-peer') remotePresenceSeen.resolve()
    })

    const desiredRoomsRegistered = fake.waitForDesiredRooms(2)
    let joinResult: 'pending' | 'resolved' | 'rejected' = 'pending'
    const joinTask = server.joinChatRoom({ domain: DOMAIN, user: USER, site: SITE }).then(
      (snapshot) => {
        joinResult = 'resolved'
        return snapshot
      },
      (error: Error) => {
        joinResult = 'rejected'
        throw error
      }
    )
    await desiredRoomsRegistered

    expect(joinResult).toBe('pending')
    expect(fake.desired).toEqual(new Set([roomId, worldRoomId]))
    expect(fake.joined).toEqual(new Set())
    expect(fake.sendAttempts).toEqual([])
    expect(localSessions).toEqual([])
    expect(worldPresences).toEqual([])
    const provisional = await server.getSnapshot()
    expect(provisional.domains[0]).toMatchObject({ chatRoomJoined: false, localSession: undefined })
    expect(provisional.world).toMatchObject({ joined: false, localPresence: undefined })

    fake.open()
    const [snapshot] = await Promise.all([joinTask, localSessionSeen.promise, localPresenceSeen.promise])
    if (!snapshot) throw new Error('Join was cancelled')

    expect(joinResult).toBe('resolved')
    expect(fake.joined).toEqual(fake.desired)
    expect(fake.joinCalls).toEqual([roomId, worldRoomId])
    expect(fake.messages(roomId).filter((message) => message.type === MESSAGE_TYPE.SESSION)).toHaveLength(1)
    expect(fake.messages(worldRoomId).filter(isWorldPresence)).toHaveLength(1)
    expect(localSessions).toHaveLength(1)
    expect(worldPresences.map((event) => event.sourcePeerId)).toEqual(['local-peer'])
    expect(snapshot.domains[0]).toMatchObject({ chatRoomJoined: true, localSession: { user: USER } })
    expect(snapshot.world).toMatchObject({ joined: true, localPresence: { user: USER } })

    fake.receive(roomId, 'remote-peer', session())
    fake.receive(worldRoomId, 'remote-peer', {
      sessionId: 'remote-world-session',
      user: REMOTE_USER,
      sites: [SITE]
    })
    await Promise.all([remoteSessionSeen.promise, remotePresenceSeen.promise])

    expect(fake.messages(worldRoomId).filter(isWorldPresence)).toHaveLength(1)
    expect(localSessions).toHaveLength(1)
    expect(worldPresences.map((event) => event.sourcePeerId)).toEqual(['local-peer', 'remote-peer'])
    expect(remoteSessions).toEqual(['remote-peer'])
    const converged = await server.getSnapshot()
    expect(converged.domains[0]).toMatchObject({
      chatRoomJoined: true,
      localSession: { user: USER },
      sessions: [{ sourcePeerId: 'remote-peer', user: REMOTE_USER }]
    })
    expect(converged.world).toMatchObject({
      joined: true,
      localPresence: { user: USER },
      presences: [{ sourcePeerId: 'remote-peer', presence: { user: REMOTE_USER } }]
    })
  })

  it('buffers late remote membership until a cold local join commits', async () => {
    const clock = new FakeClock()
    const fake = createFakeTransport({ physicalReady: false })
    const server = createServer({ transport: fake.transport, clock, codec: jsonCodec })
    const roomId = getChatRoomId(DOMAIN)
    const worldRoomId = getWorldRoomId()
    const localSessions: ObservedLocalSession[] = []
    const remoteSessions: string[] = []
    const worldPresences: string[] = []
    const localSessionSeen = deferred<void>()
    const localPresenceSeen = deferred<void>()
    const remotePresenceSeen = deferred<void>()
    await server.attachPage({ domain: DOMAIN, pageId: 'page-a' })
    await observeLocalSessions(server, { pageId: 'page-a' }, (event) => {
      localSessions.push(event)
      localSessionSeen.resolve()
    })
    await observeRemoteSessions(server, { pageId: 'page-a' }, (event) => {
      remoteSessions.push(event.session.sourcePeerId)
    })
    await server.onWorldPresence({ pageId: 'page-a' }, (event) => {
      worldPresences.push(event.sourcePeerId)
      if (event.sourcePeerId === 'local-peer') localPresenceSeen.resolve()
      if (event.sourcePeerId === 'remote-peer') remotePresenceSeen.resolve()
    })
    fake.hangSendsTo(roomId)
    const firstSendAttempt = fake.waitForSendAttempt()
    const join = server.joinChatRoom({ domain: DOMAIN, user: USER, site: SITE })
    await fake.waitForDesiredRooms(2)

    fake.open()
    await expect(firstSendAttempt).resolves.toMatchObject({ roomId })
    fake.receive(roomId, 'remote-peer', session())
    fake.receive(worldRoomId, 'remote-peer', {
      sessionId: 'remote-world-session',
      user: REMOTE_USER,
      sites: [SITE]
    })
    await settle()

    expect(localSessions).toEqual([])
    expect(remoteSessions).toEqual([])
    expect(worldPresences).toEqual([])
    expect((await server.getSnapshot()).domains[0]).toMatchObject({
      chatRoomJoined: false,
      localSession: undefined
    })
    fake.releaseSends()
    const [snapshot] = await Promise.all([
      join,
      localSessionSeen.promise,
      localPresenceSeen.promise,
      remotePresenceSeen.promise
    ])
    if (!snapshot) throw new Error('Join was cancelled')

    expect(localSessions).toHaveLength(1)
    expect(remoteSessions).toEqual(['remote-peer'])
    expect(worldPresences).toEqual(['local-peer', 'remote-peer'])
    expect(fake.messages(roomId).filter((message) => message.type === MESSAGE_TYPE.SESSION)).toHaveLength(1)
    expect(fake.messages(worldRoomId).filter(isWorldPresence)).toHaveLength(1)
    expect(snapshot.domains[0]).toMatchObject({
      chatRoomJoined: true,
      localSession: { user: USER },
      sessions: [{ sourcePeerId: 'remote-peer', user: REMOTE_USER }]
    })
    expect(snapshot.world).toMatchObject({
      joined: true,
      localPresence: { user: USER },
      presences: [{ sourcePeerId: 'remote-peer', presence: { user: REMOTE_USER } }]
    })
  })

  it('projects a strictly later remote join received while the local join is provisional', async () => {
    const clock = new FakeClock()
    const fake = createFakeTransport({ physicalReady: false })
    const server = createServer({ transport: fake.transport, clock, codec: jsonCodec })
    const roomId = getChatRoomId(DOMAIN)
    const remoteSessions: RuntimeSession[] = []
    await server.attachPage({ domain: DOMAIN, pageId: 'page-a' })
    await observeRemoteSessions(server, { pageId: 'page-a' }, ({ session }) => {
      remoteSessions.push(session)
    })
    fake.hangSendsTo(roomId)
    const firstSendAttempt = fake.waitForSendAttempt(roomId)
    const join = server.joinChatRoom({ domain: DOMAIN, user: USER, site: SITE })
    await fake.waitForDesiredRooms(2)
    fake.open()
    await firstSendAttempt

    fake.receive(roomId, 'later-peer', {
      ...session(),
      joinedAt: NOW + 1
    })
    await settle()
    expect(remoteSessions).toEqual([])

    fake.releaseSends()
    await join
    expect(remoteSessions).toEqual([expect.objectContaining({ sourcePeerId: 'later-peer', user: REMOTE_USER })])
  })

  it('converges a refreshed logical projection across every physical binding', async () => {
    const { fake, server, roomId } = await setup()
    const presenceId = 'shared-remote-presence'
    const originalUser = { ...REMOTE_USER, name: 'Before', avatar: 'before.png' }
    const refreshedUser = { ...REMOTE_USER, name: 'After', avatar: 'after.png' }
    fake.receive(roomId, 'remote-peer-a', {
      type: MESSAGE_TYPE.SESSION,
      sessionId: 'remote-session-a',
      presenceId,
      joinedAt: NOW + 1,
      user: originalUser
    })
    fake.receive(roomId, 'remote-peer-b', {
      type: MESSAGE_TYPE.SESSION,
      sessionId: 'remote-session-b',
      presenceId,
      joinedAt: NOW + 1,
      user: originalUser
    })
    await settle()

    fake.receive(roomId, 'remote-peer-a', {
      type: MESSAGE_TYPE.SESSION,
      sessionId: 'remote-session-a',
      presenceId,
      joinedAt: NOW + 1,
      user: refreshedUser
    })
    await settle()

    const sessions = (await server.getSnapshot()).domains[0].sessions.filter((item) =>
      ['remote-peer-a', 'remote-peer-b'].includes(item.sourcePeerId)
    )
    expect(sessions).toHaveLength(2)
    expect(sessions.map((item) => item.user)).toEqual([refreshedUser, refreshedUser])
  })

  it('lets only the newest generation complete a superseded cold join', async () => {
    const clock = new FakeClock()
    const fake = createFakeTransport({ physicalReady: false })
    const server = createServer({ transport: fake.transport, clock, codec: jsonCodec })
    const roomId = getChatRoomId(DOMAIN)
    const worldRoomId = getWorldRoomId()
    const localSessions: ObservedLocalSession[] = []
    const worldPresences: WorldPresenceEvent[] = []
    const localSessionSeen = deferred<void>()
    const localPresenceSeen = deferred<void>()
    await server.attachPage({ domain: DOMAIN, pageId: 'page-a' })
    await observeLocalSessions(server, { pageId: 'page-a' }, (event) => {
      localSessions.push(event)
      localSessionSeen.resolve()
    })
    await server.onWorldPresence({ pageId: 'page-a' }, (event) => {
      worldPresences.push(event)
      if (event.sourcePeerId === 'local-peer') localPresenceSeen.resolve()
    })

    const firstJoin = server.joinChatRoom({ domain: DOMAIN, user: USER, site: SITE }).then(
      () => null,
      (error: Error) => error
    )
    await fake.waitForDesiredRooms(2)
    const refreshedUser = { ...USER, name: 'Refreshed' }
    const secondJoin = server.joinChatRoom({ domain: DOMAIN, user: refreshedUser, site: SITE })

    await expect(firstJoin).resolves.toBeNull()
    expect(localSessions).toEqual([])
    expect(worldPresences).toEqual([])
    fake.open()
    const [snapshot] = await Promise.all([secondJoin, localSessionSeen.promise, localPresenceSeen.promise])
    if (!snapshot) throw new Error('Join was cancelled')

    expect(fake.joinCalls).toEqual([roomId, worldRoomId, roomId, worldRoomId])
    expect(fake.physicalJoinCalls).toEqual([roomId, worldRoomId])
    expect(fake.messages(roomId).filter((message) => message.type === MESSAGE_TYPE.SESSION)).toEqual([
      expect.objectContaining({ user: refreshedUser })
    ])
    expect(fake.messages(worldRoomId).filter(isWorldPresence)).toEqual([
      expect.objectContaining({ user: refreshedUser })
    ])
    expect(localSessions).toHaveLength(1)
    expect(localSessions[0]).toMatchObject({ session: { user: refreshedUser } })
    expect(worldPresences.map((event) => event.sourcePeerId)).toEqual(['local-peer'])
    expect(snapshot.domains[0]).toMatchObject({ chatRoomJoined: true, localSession: { user: refreshedUser } })
  })

  it('cancels a cold join on grace release and ignores a late physical open', async () => {
    const clock = new FakeClock()
    const fake = createFakeTransport({ physicalReady: false })
    const server = createServer({ transport: fake.transport, clock, codec: jsonCodec })
    const localSessions: ObservedLocalSession[] = []
    const worldPresences: WorldPresenceEvent[] = []
    await server.attachPage({ domain: DOMAIN, pageId: 'page-a' })
    await observeLocalSessions(server, { pageId: 'page-a' }, (event) => {
      localSessions.push(event)
    })
    await server.onWorldPresence({ pageId: 'page-a' }, (event) => {
      worldPresences.push(event)
    })
    const joinResult = server.joinChatRoom({ domain: DOMAIN, user: USER, site: SITE }).then(
      () => null,
      (error: Error) => error
    )
    await fake.waitForDesiredRooms(2)

    await server.detachPage({ domain: DOMAIN, pageId: 'page-a' })
    clock.advance(RUNTIME_DOMAIN_GRACE_MS + 1)
    await expect(joinResult).resolves.toEqual(new Error('Domain released during join'))
    expect(fake.desired).toEqual(new Set())
    expect(fake.joined).toEqual(new Set())

    fake.open()
    expect(fake.physicalJoinCalls).toEqual([])
    expect(fake.sendAttempts).toEqual([])
    expect(localSessions).toEqual([])
    expect(worldPresences).toEqual([])
    expect((await server.getSnapshot()).domains).toEqual([])
  })

  it('rolls back a bounded cold join timeout before a late physical open', async () => {
    const clock = new FakeClock()
    const fake = createFakeTransport({ physicalReady: false })
    const server = createServer({ transport: fake.transport, clock, codec: jsonCodec })
    await server.attachPage({ domain: DOMAIN, pageId: 'page-a' })
    const joinResult = server.joinChatRoom({ domain: DOMAIN, user: USER, site: SITE }).then(
      () => null,
      (error: Error) => error
    )
    await fake.waitForDesiredRooms(2)

    clock.advance(PHYSICAL_ROOM_JOIN_TIMEOUT_MS + 1)
    await expect(joinResult).resolves.toEqual(new Error('Physical room join timed out'))
    expect(fake.desired).toEqual(new Set())
    expect(fake.joined).toEqual(new Set())
    expect(fake.sendAttempts).toEqual([])
    expect((await server.getSnapshot()).domains[0]).toMatchObject({
      chatRoomJoined: false,
      localSession: undefined
    })

    fake.open()
    expect(fake.physicalJoinCalls).toEqual([])
    expect(fake.sendAttempts).toEqual([])
  })

  it('disposes a pending host join before a replacement host can converge', async () => {
    const oldClock = new FakeClock()
    const oldFake = createFakeTransport({ physicalReady: false })
    const oldServer = createServer({ transport: oldFake.transport, clock: oldClock, codec: jsonCodec })
    await oldServer.attachPage({ domain: DOMAIN, pageId: 'page-a' })
    void oldServer.joinChatRoom({ domain: DOMAIN, user: USER, site: SITE }).catch(() => {})
    await oldFake.waitForDesiredRooms(2)

    disposeServer(oldServer)
    oldFake.open()
    expect(oldFake.desired).toEqual(new Set())
    expect(oldFake.physicalJoinCalls).toEqual([])
    expect(oldFake.sendAttempts).toEqual([])

    const replacementFake = createFakeTransport()
    const replacement = createServer({ transport: replacementFake.transport, clock: oldClock, codec: jsonCodec })
    await replacement.attachPage({ domain: DOMAIN, pageId: 'page-a' })
    const snapshot = await replacement.joinChatRoom({ domain: DOMAIN, user: USER, site: SITE })
    if (!snapshot) throw new Error('Join was cancelled')
    expect(snapshot.domains[0]).toMatchObject({ chatRoomJoined: true, localSession: { user: USER } })
    expect(replacementFake.physicalJoinCalls).toEqual([getChatRoomId(DOMAIN), getWorldRoomId()])
  })

  it('keeps a reconnect provisional and commits one replacement session after physical recovery', async () => {
    const { fake, server, roomId } = await setup()
    const worldRoomId = getWorldRoomId()
    const before = await server.getSnapshot()
    const localSessions: ObservedLocalSession[] = []
    const localSessionSeen = deferred<void>()
    await observeLocalSessions(server, { pageId: 'page-a' }, (event) => {
      localSessions.push(event)
      localSessionSeen.resolve()
    })
    fake.makeNotReady()

    let reconnectResult: 'pending' | 'resolved' = 'pending'
    const reconnect = server.reconnectDomain({ domain: DOMAIN }).then(() => {
      reconnectResult = 'resolved'
    })
    await fake.waitForJoinCalls(4)

    expect(reconnectResult).toBe('pending')
    expect(fake.joined).toEqual(new Set([worldRoomId]))
    expect((await server.getSnapshot()).domains[0].localSession).toEqual(before.domains[0].localSession)
    fake.open()
    await Promise.all([reconnect, localSessionSeen.promise])

    const after = await server.getSnapshot()
    expect(reconnectResult).toBe('resolved')
    expect(after.domains[0].localSession?.sessionId).not.toBe(before.domains[0].localSession?.sessionId)
    expect(localSessions).toHaveLength(1)
    expect(fake.physicalJoinCalls.filter((id) => id === roomId)).toHaveLength(2)
    expect(fake.physicalJoinCalls.filter((id) => id === worldRoomId)).toHaveLength(1)
    expect(fake.messages(roomId).filter((message) => message.type === MESSAGE_TYPE.SESSION)).toHaveLength(2)
    expect(fake.messages(worldRoomId).filter(isWorldPresence)).toHaveLength(2)
  })

  it('fans authoritative local identity to every same-domain page without replacing remote sessions', async () => {
    const clock = new FakeClock()
    const fake = createFakeTransport()
    const server = createServer({ transport: fake.transport, clock, codec: jsonCodec })
    await server.attachPage({ domain: DOMAIN, pageId: 'page-a' })
    await server.attachPage({ domain: DOMAIN, pageId: 'page-b' })
    const localA: ObservedLocalSession[] = []
    const localB: ObservedLocalSession[] = []
    const remoteA: string[] = []
    const remoteB: string[] = []
    await Promise.all([
      observeLocalSessions(server, { pageId: 'page-a' }, (event) => {
        localA.push(event)
      }),
      observeLocalSessions(server, { pageId: 'page-b' }, (event) => {
        localB.push(event)
      }),
      observeRemoteSessions(server, { pageId: 'page-a' }, (event) => {
        remoteA.push(event.session.sourcePeerId)
      }),
      observeRemoteSessions(server, { pageId: 'page-b' }, (event) => {
        remoteB.push(event.session.sourcePeerId)
      })
    ])

    await server.joinChatRoom({ domain: DOMAIN, user: USER, site: SITE })
    await settle()
    expect(localA).toHaveLength(1)
    expect(localB).toEqual(localA)
    expect(localA[0]).toMatchObject({ domain: DOMAIN, session: { user: USER, joinedAt: NOW } })
    expect(remoteA).toEqual([])
    expect(remoteB).toEqual([])

    // A later same-domain page join replays one authoritative identity to every already-attached page.
    await server.joinChatRoom({ domain: DOMAIN, user: USER, site: SITE })
    await settle()
    expect(localA).toHaveLength(2)
    expect(localB).toEqual(localA)
    expect(localA[1]).toEqual(localA[0])

    const roomId = getChatRoomId(DOMAIN)
    fake.receive(roomId, 'remote-peer', session())
    await settle()
    expect(remoteA).toEqual(['remote-peer'])
    expect(remoteB).toEqual(['remote-peer'])

    const refreshedUser = { ...USER, name: 'Refreshed', avatar: 'refreshed-avatar' }
    clock.advance(1)
    await server.joinChatRoom({ domain: DOMAIN, user: refreshedUser, site: SITE })
    await settle()
    expect(localA).toHaveLength(3)
    expect(localB).toEqual(localA)
    expect(localA[2]).toMatchObject({ domain: DOMAIN, session: { user: refreshedUser, joinedAt: NOW } })
    expect(localA[2].session.sessionId).toBe(localA[1].session.sessionId)
    expect((await server.getSnapshot()).domains[0].sessions.map((item) => item.sourcePeerId)).toEqual(['remote-peer'])
    expect(remoteA).toEqual(['remote-peer'])
    expect(remoteB).toEqual(['remote-peer'])
    expect([...fake.joined].filter((id) => id === roomId)).toHaveLength(1)
  })

  it('rehydrates F5, manual reconnect, and transport rejoin from the current local session', async () => {
    const { clock, fake, server, roomId } = await setup()
    await server.detachPage({ domain: DOMAIN, pageId: 'page-a' })
    clock.advance(RUNTIME_DOMAIN_GRACE_MS - 1)
    await server.attachPage({ domain: DOMAIN, pageId: 'page-f5' })
    const local: ObservedLocalSession[] = []
    await observeLocalSessions(server, { pageId: 'page-f5' }, (event) => {
      local.push(event)
    })

    await server.joinChatRoom({ domain: DOMAIN, user: USER, site: SITE })
    await settle()
    expect(local).toHaveLength(1)

    await server.reconnectDomain({ domain: DOMAIN })
    await settle()
    expect(local).toHaveLength(2)
    expect(local[1].session.sessionId).not.toBe(local[0].session.sessionId)

    fake.roomClose(roomId)
    await settle()
    expect(local).toHaveLength(3)
    expect(local[2].session.sessionId).not.toBe(local[1].session.sessionId)
    expect(fake.joined.has(roomId)).toBe(true)
  })

  it('keeps the page lease when its local identity callback rejects', async () => {
    const clock = new FakeClock()
    const fake = createFakeTransport()
    const server = createServer({ transport: fake.transport, clock, codec: jsonCodec })
    await server.attachPage({ domain: DOMAIN, pageId: 'page-a' })
    await observeLocalSessions(server, { pageId: 'page-a' }, async () => {
      throw new Error('page port closed')
    })

    await server.joinChatRoom({ domain: DOMAIN, user: USER, site: SITE })
    await settle()
    expect((await server.getSnapshot()).domains[0]).toMatchObject({ phase: 'active', pageIds: ['page-a'] })
  })

  it('rejects invalid projected identity fields before joining transport', async () => {
    const clock = new FakeClock()
    const fake = createFakeTransport()
    const server = createServer({ transport: fake.transport, clock, codec: jsonCodec })
    await server.attachPage({ domain: DOMAIN, pageId: 'page-a' })

    await expect(
      server.joinChatRoom({
        domain: DOMAIN,
        user: { ...USER_INFO, name: 1 } as unknown as ChatUser,
        site: SITE
      })
    ).rejects.toThrow('Invalid local identity or site metadata')
    expect(fake.joinCalls).toEqual([])
  })

  it('disposes the Remesh host and physical transport exactly once', async () => {
    const { fake, server } = await setup()

    disposeServer(server)
    disposeServer(server)

    expect(fake.disposeCount()).toBe(1)
    expect(fake.joined.size).toBe(0)
  })

  it('shares one domain room and releases it with the inbound buffer after grace', async () => {
    const { clock, fake, server, roomId } = await setup()
    await server.attachPage({ domain: DOMAIN, pageId: 'page-b' })
    expect([...fake.joined].filter((id) => id === roomId)).toHaveLength(1)

    fake.receive(roomId, 'remote-peer', session())
    fake.receive(roomId, 'remote-peer', text('message-1'))
    await settle()
    expect(await server.replayInbound({ domain: DOMAIN, after: 0 })).toHaveLength(1)

    await server.detachPage({ domain: DOMAIN, pageId: 'page-a' })
    clock.advance(RUNTIME_DOMAIN_GRACE_MS + 1)
    expect(fake.joined.has(roomId)).toBe(true)

    await server.detachPage({ domain: DOMAIN, pageId: 'page-b' })
    clock.advance(RUNTIME_DOMAIN_GRACE_MS + 1)
    await vi.waitFor(() => expect(fake.joined.has(roomId)).toBe(false))
    expect(await server.replayInbound({ domain: DOMAIN, after: 0 })).toEqual([])
  })

  it('keeps a page owner after callback loss until an explicit detach releases it', async () => {
    const { clock, fake, server, roomId } = await setup()
    await server.onInbound({ pageId: 'page-a' }, async () => {
      throw new Error('page port closed')
    })
    fake.receive(roomId, 'remote-peer', session())
    fake.receive(roomId, 'remote-peer', text('message-1'))
    await settle()

    expect((await server.getSnapshot()).domains[0]).toMatchObject({ phase: 'active', pageIds: ['page-a'] })
    clock.advance(RUNTIME_DOMAIN_GRACE_MS + 1)
    expect(fake.joined.has(roomId)).toBe(true)

    await server.detachPage({ domain: DOMAIN, pageId: 'page-a' })
    expect((await server.getSnapshot()).domains[0].phase).toBe('grace')
    clock.advance(RUNTIME_DOMAIN_GRACE_MS + 1)
    await vi.waitFor(() => expect(fake.joined.has(roomId)).toBe(false))
  })

  it('reattaches inside grace without recreating the room or losing buffered events', async () => {
    const { clock, fake, server, roomId } = await setup()
    fake.receive(roomId, 'remote-peer', session())
    fake.receive(roomId, 'remote-peer', text('message-1'))
    await settle()

    await server.detachPage({ domain: DOMAIN, pageId: 'page-a' })
    clock.advance(RUNTIME_DOMAIN_GRACE_MS - 1)
    const snapshot = await server.attachPage({ domain: DOMAIN, pageId: 'page-f5' })
    clock.advance(RUNTIME_DOMAIN_GRACE_MS + 1)

    expect(snapshot.domains[0].phase).toBe('active')
    expect(fake.joined.has(roomId)).toBe(true)
    expect((await server.replayInbound({ domain: DOMAIN, after: 0 }))[0].record.message.id).toBe('message-1')
  })

  it('reconnects only one Chat room and keeps World joined', async () => {
    const { fake, server, roomId } = await setup()
    await server.attachPage({ domain: OTHER_DOMAIN, pageId: 'other-page' })
    await server.joinChatRoom({
      domain: OTHER_DOMAIN,
      user: USER,
      site: { origin: OTHER_DOMAIN }
    })
    const worldRoomId = getWorldRoomId()
    const presenceCount = fake.messages(worldRoomId).filter(isWorldPresence).length

    await server.reconnectDomain({ domain: DOMAIN })

    expect(fake.messages(worldRoomId).filter(isWorldPresence)).toHaveLength(presenceCount + 1)
    expect(fake.joined.has(roomId)).toBe(true)
    expect(fake.joined.has(getChatRoomId(OTHER_DOMAIN))).toBe(true)
    expect(fake.joined.has(worldRoomId)).toBe(true)
  })

  it('self-recovers an unexpectedly closed World room independently from Chat rooms', async () => {
    const { fake, roomId } = await setup()
    const worldRoomId = getWorldRoomId()

    fake.roomClose(worldRoomId)
    await settle()

    expect(fake.joined.has(worldRoomId)).toBe(true)
    expect(fake.joined.has(roomId)).toBe(true)
  })

  it('self-recovers an unexpectedly closed domain room without rebuilding World', async () => {
    const { fake, roomId } = await setup()
    const worldRoomId = getWorldRoomId()

    fake.roomClose(roomId)
    await settle()

    expect(fake.joined.has(roomId)).toBe(true)
    expect(fake.joined.has(worldRoomId)).toBe(true)
  })
})

describe('RuntimeServer provisional recovery races', () => {
  it('catches up only peers that miss provisional initial identity broadcasts', async () => {
    const clock = new FakeClock()
    const fake = createFakeTransport({ physicalReady: false })
    const server = createServer({ transport: fake.transport, clock, codec: jsonCodec })
    const roomId = getChatRoomId(DOMAIN)
    const worldRoomId = getWorldRoomId()
    const localSessions: ObservedLocalSession[] = []
    const localPresences: WorldPresenceEvent[] = []
    await server.attachPage({ domain: DOMAIN, pageId: 'page-a' })
    await observeLocalSessions(server, { pageId: 'page-a' }, (event) => {
      localSessions.push(event)
    })
    await server.onWorldPresence({ pageId: 'page-a' }, (event) => {
      if (event.sourcePeerId === fake.transport.peerId) localPresences.push(event)
    })
    fake.hangSendsTo(worldRoomId)
    const worldBroadcastStarted = fake.waitForSendAttempt(worldRoomId)
    const join = server.joinChatRoom({ domain: DOMAIN, user: USER, site: SITE })
    await fake.waitForDesiredRooms(2)

    fake.open()
    fake.peerJoin(roomId, 'covered-peer')
    fake.peerJoin(worldRoomId, 'covered-peer')
    fake.peerJoin(roomId, 'world-missed-peer')
    fake.peerJoin(worldRoomId, 'chat-missed-peer')
    await expect(worldBroadcastStarted).resolves.toMatchObject({ roomId: worldRoomId, to: undefined })
    fake.peerJoin(worldRoomId, 'world-missed-peer')
    fake.peerJoin(roomId, 'chat-missed-peer')
    fake.peerJoin(roomId, 'both-missed-peer')
    fake.peerJoin(worldRoomId, 'both-missed-peer')
    fake.peerJoin(roomId, 'both-missed-peer')
    fake.peerJoin(worldRoomId, 'both-missed-peer')
    await settle()

    for (const peerId of ['covered-peer', 'world-missed-peer', 'chat-missed-peer', 'both-missed-peer']) {
      expect(sentToPeer(fake, roomId, peerId)).toEqual([])
      expect(sentToPeer(fake, worldRoomId, peerId)).toEqual([])
    }
    expect((await server.getSnapshot()).domains[0].chatRoomJoined).toBe(false)
    fake.releaseSends()
    const snapshot = await join
    if (!snapshot) throw new Error('Join was cancelled')
    await settle()

    const currentSession = snapshot.domains[0].localSession
    const currentPresence = snapshot.world.localPresence
    if (!currentSession || !currentPresence) throw new Error('Committed local identity missing')
    const [currentSessionMessage] = broadcastsToRoom(fake, roomId) as ChatRoomMessage[]
    expect(currentSessionMessage).toMatchObject({
      type: MESSAGE_TYPE.SESSION,
      sessionId: currentSession.sessionId,
      user: currentSession.user
    })
    expect(broadcastsToRoom(fake, worldRoomId)).toEqual([currentPresence])
    expect.soft(sentToPeer(fake, roomId, 'both-missed-peer')).toEqual([currentSessionMessage])
    expect.soft(sentToPeer(fake, worldRoomId, 'both-missed-peer')).toEqual([currentPresence])
    expect.soft(sentToPeer(fake, roomId, 'world-missed-peer')).toEqual([])
    expect.soft(sentToPeer(fake, worldRoomId, 'world-missed-peer')).toEqual([currentPresence])
    expect.soft(sentToPeer(fake, roomId, 'chat-missed-peer')).toEqual([currentSessionMessage])
    expect.soft(sentToPeer(fake, worldRoomId, 'chat-missed-peer')).toEqual([])
    expect(sentToPeer(fake, roomId, 'covered-peer')).toEqual([])
    expect(sentToPeer(fake, worldRoomId, 'covered-peer')).toEqual([])
    expect(localSessions).toHaveLength(1)
    expect(localPresences).toHaveLength(1)
  })

  it('discards peer catch-up owned by a superseded provisional join', async () => {
    const clock = new FakeClock()
    const fake = createFakeTransport({ physicalReady: false })
    const server = createServer({ transport: fake.transport, clock, codec: jsonCodec })
    const roomId = getChatRoomId(DOMAIN)
    const worldRoomId = getWorldRoomId()
    await server.attachPage({ domain: DOMAIN, pageId: 'page-a' })
    fake.hangSendsTo(worldRoomId)
    const firstWorldBroadcast = fake.waitForSendAttempt(worldRoomId)
    const firstJoin = server.joinChatRoom({ domain: DOMAIN, user: USER, site: SITE }).then(
      () => null,
      (error: Error) => error
    )
    await fake.waitForDesiredRooms(2)
    fake.open()
    await expect(firstWorldBroadcast).resolves.toMatchObject({ roomId: worldRoomId })

    fake.peerJoin(roomId, 'stale-peer')
    fake.peerJoin(worldRoomId, 'stale-peer')
    await settle()
    const refreshedUser = { ...USER, name: 'Refreshed' }
    const replacement = server.joinChatRoom({ domain: DOMAIN, user: refreshedUser, site: SITE })
    await settle()
    fake.releaseSends()

    await expect(firstJoin).resolves.toBeNull()
    await expect(replacement).resolves.toMatchObject({
      domains: [expect.objectContaining({ localSession: expect.objectContaining({ user: refreshedUser }) })]
    })
    await settle()
    expect(sentToPeer(fake, roomId, 'stale-peer')).toEqual([])
    expect(sentToPeer(fake, worldRoomId, 'stale-peer')).toEqual([])
  })

  it('keeps reconnect inbound sessions attempt-owned until replacement commit', async () => {
    const { fake, server, roomId } = await setup()
    const remoteSessions: string[] = []
    await observeRemoteSessions(server, { pageId: 'page-a' }, (event) => {
      remoteSessions.push(event.session.sourcePeerId)
    })
    fake.makeNotReady()
    fake.hangSendsTo(roomId)
    const chatBroadcastStarted = fake.waitForSendAttempt(roomId)
    const reconnect = server.reconnectDomain({ domain: DOMAIN })
    await fake.waitForJoinCalls(4)
    fake.open()
    await expect(chatBroadcastStarted).resolves.toMatchObject({ roomId, to: undefined })

    fake.receive(roomId, 'remote-peer', session())
    await settle()
    const eventsBeforeCommit = [...remoteSessions]
    const sessionsBeforeCommit = (await server.getSnapshot()).domains[0].sessions
    fake.releaseSends()
    await reconnect
    await settle()

    expect.soft(eventsBeforeCommit).toEqual([])
    expect.soft(sessionsBeforeCommit).toEqual([])
    expect(remoteSessions).toEqual(['remote-peer'])
    expect((await server.getSnapshot()).domains[0].sessions).toEqual([
      expect.objectContaining({ sourcePeerId: 'remote-peer', user: REMOTE_USER })
    ])
  })

  it('discards remote sessions owned by a superseded provisional reconnect', async () => {
    const { fake, server, roomId } = await setup()
    const remoteSessions: string[] = []
    await observeRemoteSessions(server, { pageId: 'page-a' }, (event) => {
      remoteSessions.push(event.session.sourcePeerId)
    })
    fake.makeNotReady()
    fake.hangSendsTo(roomId)
    const firstBroadcastStarted = fake.waitForSendAttempt(roomId)
    const firstReconnect = server.reconnectDomain({ domain: DOMAIN })
    await fake.waitForJoinCalls(4)
    fake.open()
    await expect(firstBroadcastStarted).resolves.toMatchObject({ roomId, to: undefined })

    fake.receive(roomId, 'stale-remote-peer', session())
    await settle()
    const eventsBeforeSupersede = [...remoteSessions]
    const retainedBeforeSupersede = (await server.getSnapshot()).domains[0].sessions
    const replacement = server.joinChatRoom({ domain: DOMAIN, user: USER, site: SITE })
    await expect(firstReconnect).resolves.toBeNull()
    await settle()
    const eventsAfterSupersede = [...remoteSessions]
    const retainedAfterSupersede = (await server.getSnapshot()).domains[0].sessions

    fake.releaseSends()
    const replacementSnapshot = await replacement
    if (!replacementSnapshot) throw new Error('Join was cancelled')
    await settle()

    expect.soft(eventsBeforeSupersede).toEqual([])
    expect.soft(retainedBeforeSupersede).toEqual([])
    expect.soft(eventsAfterSupersede).toEqual([])
    expect.soft(retainedAfterSupersede).toEqual([])
    expect.soft(remoteSessions).toEqual([])
    expect(replacementSnapshot.domains[0]).toMatchObject({
      chatRoomJoined: true,
      localSession: { user: USER },
      sessions: []
    })
    expect((await server.getSnapshot()).domains[0].sessions).toEqual([])
  })

  it('catches up only peers that miss a provisional World recovery broadcast', async () => {
    const { fake, server } = await setup()
    const worldRoomId = getWorldRoomId()
    const currentPresence = (await server.getSnapshot()).world.localPresence
    if (!currentPresence) throw new Error('Committed local presence missing')
    const broadcastsBeforeRecovery = broadcastsToRoom(fake, worldRoomId)
    const localPresenceEvents: WorldPresenceEvent[] = []
    await server.onWorldPresence({ pageId: 'page-a' }, (event) => {
      if (event.sourcePeerId === fake.transport.peerId) localPresenceEvents.push(event)
    })
    fake.makeNotReady()
    fake.hangSendsTo(worldRoomId)
    const recoveryBroadcastStarted = fake.waitForSendAttempt(worldRoomId)

    fake.roomClose(worldRoomId)
    await fake.waitForJoinCalls(3)
    const joinedBeforeOpen = (await server.getSnapshot()).world.joined
    fake.open()
    fake.peerJoin(worldRoomId, 'covered-peer')
    await expect(recoveryBroadcastStarted).resolves.toMatchObject({ roomId: worldRoomId, to: undefined })
    fake.peerJoin(worldRoomId, 'missed-peer')
    fake.peerJoin(worldRoomId, 'missed-peer')
    await settle()

    const joinedBeforeCommit = (await server.getSnapshot()).world.joined
    const coveredBeforeCommit = sentToPeer(fake, worldRoomId, 'covered-peer')
    const missedBeforeCommit = sentToPeer(fake, worldRoomId, 'missed-peer')
    const projectionsBeforeCommit = [...localPresenceEvents]
    expect.soft(joinedBeforeOpen).toBe(false)
    expect.soft(joinedBeforeCommit).toBe(false)
    expect.soft(coveredBeforeCommit).toEqual([])
    expect.soft(missedBeforeCommit).toEqual([])
    expect.soft(projectionsBeforeCommit).toEqual([])

    fake.releaseSends()
    await settle()

    expect((await server.getSnapshot()).world.joined).toBe(true)
    expect(broadcastsToRoom(fake, worldRoomId)).toEqual([...broadcastsBeforeRecovery, currentPresence])
    expect.soft(sentToPeer(fake, worldRoomId, 'covered-peer')).toEqual([])
    expect.soft(sentToPeer(fake, worldRoomId, 'missed-peer')).toEqual([currentPresence])
    expect.soft(localPresenceEvents).toEqual([
      {
        sourcePeerId: fake.transport.peerId,
        presence: { sourcePeerId: fake.transport.peerId, presence: currentPresence }
      }
    ])
  })

  it('fences a timed-out World rejoin or republishes before late-open commitment', async () => {
    const { clock, fake, server } = await setup()
    const worldRoomId = getWorldRoomId()
    const presenceCount = fake.messages(worldRoomId).filter(isWorldPresence).length
    fake.makeNotReady()

    fake.roomClose(worldRoomId)
    await fake.waitForJoinCalls(3)
    clock.advance(PHYSICAL_ROOM_JOIN_TIMEOUT_MS + 1)
    await settle()
    expect.soft(fake.joined.has(worldRoomId)).toBe(false)
    expect.soft((await server.getSnapshot()).world.joined).toBe(false)
    expect.soft(fake.messages(worldRoomId).filter(isWorldPresence)).toHaveLength(presenceCount)
    fake.open()
    await settle()

    const outcome = {
      physicalJoined: fake.joined.has(worldRoomId),
      logicalDesired: fake.desired.has(worldRoomId),
      snapshotJoined: (await server.getSnapshot()).world.joined,
      presenceDelta: fake.messages(worldRoomId).filter(isWorldPresence).length - presenceCount
    }
    expect([
      { physicalJoined: false, logicalDesired: false, snapshotJoined: false, presenceDelta: 0 },
      { physicalJoined: true, logicalDesired: true, snapshotJoined: true, presenceDelta: 1 }
    ]).toContainEqual(outcome)
  })
})

describe('RuntimeServer trusted delivery', () => {
  it('binds live authors to the transport source session and ignores payload identity claims', async () => {
    const { fake, server, roomId } = await setup()
    const received: string[] = []
    await server.onInbound({ pageId: 'page-a' }, (event) => {
      received.push(event.record.message.id)
    })
    fake.receive(roomId, 'peer-a', session(REMOTE_USER))
    fake.receive(roomId, 'peer-a', text('forged', 'somebody-else'))
    fake.receive(roomId, 'peer-a', { ...text('extra-field'), peerId: 'peer-b' })
    fake.receive(roomId, 'peer-a', text('valid'))
    await settle()

    expect(received).toEqual(['valid'])
  })

  it('binds logical identity while accepting only same-generation user projection refreshes', async () => {
    const { fake, server, roomId } = await setup()
    const events: RuntimeSessionEvent[] = []
    await server.onSessionEvent({ pageId: 'page-a' }, (event) => {
      events.push(event)
    })
    const accepted = session(REMOTE_USER)
    const refreshedUser = { ...REMOTE_USER, name: 'Refreshed remote' }

    fake.receive(roomId, 'peer-a', accepted)
    fake.receive(roomId, 'peer-a', { ...accepted, user: refreshedUser })
    fake.receive(roomId, 'peer-a', { ...accepted, user: { ...refreshedUser, id: 'forged-user' } })
    fake.receive(roomId, 'peer-a', { ...accepted, joinedAt: accepted.joinedAt + 1 })
    fake.receive(roomId, 'peer-a', { ...accepted, joinedAt: undefined } as unknown as TestWireMessage)
    await settle()

    expect(events.map(({ type }) => type)).toEqual(['join', 'snapshot'])
    expect((await server.getSnapshot()).domains[0].sessions).toEqual([
      expect.objectContaining({
        sourcePeerId: 'peer-a',
        sessionId: accepted.sessionId,
        joinedAt: accepted.joinedAt,
        user: refreshedUser
      })
    ])
  })

  it('drops old-only and old-plus-new wire keys before page projection', async () => {
    const { fake, server, roomId } = await setup()
    const received: string[] = []
    await server.onInbound({ pageId: 'page-a' }, (event) => {
      received.push(event.record.message.id)
    })
    fake.receive(roomId, 'peer-a', session())

    const legacyMention = { ...text('legacy-mention'), mentions: [{ ...REMOTE_USER, positions: [[0, 0]] }] }
    const dualMention = {
      ...text('dual-mention'),
      mentions: [{ ...REMOTE_USER, ranges: [[0, 0]], positions: [[0, 0]] }]
    }
    const legacyRequest = { type: MESSAGE_TYPE.HISTORY_REQUEST, requestId: 'legacy-sync' }
    const dualRequest = { ...legacyRequest, syncId: 'current-sync' }
    const legacyResponse = {
      type: MESSAGE_TYPE.HISTORY_RESPONSE,
      requestId: 'legacy-sync',
      users: [REMOTE_USER],
      events: [text('legacy-history')],
      done: true
    }
    const dualResponse = { ...legacyResponse, syncId: 'current-sync', messages: legacyResponse.events }
    for (const invalid of [legacyMention, dualMention, legacyRequest, dualRequest, legacyResponse, dualResponse]) {
      fake.receive(roomId, 'peer-a', invalid as unknown as TestWireMessage)
    }
    fake.receive(roomId, 'peer-a', text('valid-after-rejections'))
    await settle()

    expect(received).toEqual(['valid-after-rejections'])
  })

  it('rejects future HLC without poisoning the central clock', async () => {
    const { fake, server, roomId } = await setup()
    const received: string[] = []
    await server.onInbound({ pageId: 'page-a' }, (event) => {
      received.push(event.record.message.id)
    })
    fake.receive(roomId, 'peer-a', session())
    fake.receive(roomId, 'peer-a', text('future', REMOTE_USER.id, NOW + 5 * 60 * 1000 + 1))
    fake.receive(roomId, 'peer-a', {
      ...text('counter-overflow'),
      hlc: { timestamp: NOW, counter: Number.MAX_SAFE_INTEGER }
    })
    fake.receive(roomId, 'peer-a', text('valid'))
    await settle()

    expect(received).toEqual(['valid'])
    const local = await server.allocateTextMessage({ domain: DOMAIN, body: 'next', mentions: [] })
    expect(local.message.hlc.timestamp).toBe(NOW)
  })

  it('clears buffered events only after a page ACK and treats duplicate ACK as idempotent', async () => {
    const { fake, server, roomId } = await setup()
    fake.receive(roomId, 'peer-a', session())
    fake.receive(roomId, 'peer-a', text('one'))
    fake.receive(roomId, 'peer-a', text('two', REMOTE_USER.id, NOW + 1))
    await settle()

    await server.ackInbound({ domain: DOMAIN, sequence: 2 })
    await server.ackInbound({ domain: DOMAIN, sequence: 2 })
    const replay = await server.replayInbound({ domain: DOMAIN, after: 0 })
    expect(replay.map((event) => event.record.message.id)).toEqual(['one'])

    await server.ackInbound({ domain: DOMAIN, sequence: 1 })
    expect(await server.replayInbound({ domain: DOMAIN, after: 0 })).toEqual([])
  })
})

describe('RuntimeServer send reliability', () => {
  it('submits a broadcast to the transport even when no peer session is bound', async () => {
    const { fake, server, roomId } = await setup()
    const record = await server.allocateTextMessage({ domain: DOMAIN, body: 'outbound', mentions: [] })

    await server.sendChatMessage({ domain: DOMAIN, event: record.message })

    expect(fake.messages(roomId)).toContainEqual(record.message)
    expect(fake.sent.find((item) => item.roomId === roomId)?.to).toBeUndefined()
  })

  it('allocates id/HLC centrally and propagates transport acceptance or failure', async () => {
    const { fake, server, roomId } = await setup()
    fake.receive(roomId, 'peer-a', session())
    await settle()
    const record = await server.allocateTextMessage({ domain: DOMAIN, body: 'outbound', mentions: [] })

    await server.sendChatMessage({ domain: DOMAIN, event: record.message })
    await settle()
    expect(fake.messages(roomId).some((message) => message.type === MESSAGE_TYPE.TEXT)).toBe(true)

    fake.failSend(new Error('partial send'))
    await expect(server.sendChatMessage({ domain: DOMAIN, event: record.message })).rejects.toThrow('partial send')
    const next = await server.allocateTextMessage({ domain: DOMAIN, body: 'next', mentions: [] })
    expect(next.message.hlc).toEqual({ timestamp: NOW, counter: 1 })
  })
})

describe('RuntimeServer World presence', () => {
  it('emits the updated local presence to existing pages after a second domain joins', async () => {
    const { fake, server } = await setup()
    const events: WorldPresenceEvent[] = []
    await server.onWorldPresence({ pageId: 'page-a' }, (event) => events.push(event))
    await server.attachPage({ domain: OTHER_DOMAIN, pageId: 'page-b' })

    await server.joinChatRoom({ domain: OTHER_DOMAIN, user: USER, site: { origin: OTHER_DOMAIN } })
    await settle()

    expect(events).toHaveLength(1)
    expect(events[0]?.sourcePeerId).toBe(fake.transport.peerId)
    expect(events[0]?.presence?.sourcePeerId).toBe(fake.transport.peerId)
    expect(events[0]?.presence?.presence.user).toEqual(USER)
    expect(Object.keys(events[0]?.presence?.presence.user ?? {})).toEqual(['id', 'name', 'avatar'])
    expect(events[0]?.presence?.presence.sites).toEqual([SITE, { origin: OTHER_DOMAIN }])

    const outgoing = fake.messages(getWorldRoomId()).filter(isWorldPresence)
    expect(outgoing).toHaveLength(2)
    expect(events[0]?.presence?.presence).toEqual(outgoing.at(-1))
  })

  it('does not emit an updated local presence when the World send fails', async () => {
    const { fake, server } = await setup()
    const events: WorldPresenceEvent[] = []
    await server.onWorldPresence({ pageId: 'page-a' }, (event) => events.push(event))
    await server.attachPage({ domain: OTHER_DOMAIN, pageId: 'page-b' })
    fake.failSend(new Error('world send failed'))

    await expect(
      server.joinChatRoom({ domain: OTHER_DOMAIN, user: USER, site: { origin: OTHER_DOMAIN } })
    ).rejects.toThrow('world send failed')
    await settle()

    expect(events).toEqual([])
    const outgoing = fake.messages(getWorldRoomId()).filter(isWorldPresence).at(-1)
    expect(outgoing?.sites).toEqual([SITE])
  })

  it('publishes full privacy-bounded snapshots and atomically replaces/deletes remote presence', async () => {
    const { fake, server } = await setup()
    const worldRoomId = getWorldRoomId()
    await server.attachPage({ domain: OTHER_DOMAIN, pageId: 'other-page' })
    await server.joinChatRoom({
      domain: OTHER_DOMAIN,
      user: USER,
      site: {
        origin: OTHER_DOMAIN,
        description: 'Other',
        host: 'other.example',
        href: 'https://other.example/private?token=secret'
      } as ChatSite & { host: string; href: string }
    })
    await settle()

    const outgoing = fake.messages(worldRoomId).filter(isWorldPresence).at(-1)!
    expect(outgoing.sites).toEqual([SITE, { origin: OTHER_DOMAIN, description: 'Other' }])
    expect(JSON.stringify(outgoing)).not.toMatch(/hostname|href/)

    const events: WorldPresenceEvent[] = []
    await server.onWorldPresence({ pageId: 'page-a' }, (event) => events.push(event))
    const first = { sessionId: 'world-1', user: REMOTE_USER, sites: [{ origin: DOMAIN }] }
    const second = {
      sessionId: 'world-1',
      user: REMOTE_USER,
      sites: [{ origin: OTHER_DOMAIN }]
    }
    fake.receive(worldRoomId, 'peer-a', first)
    fake.receive(worldRoomId, 'peer-a', second)
    await settle()
    fake.peerLeave(worldRoomId, 'peer-a')

    expect(events.map((event) => event.presence?.presence.sites[0]?.origin ?? null)).toEqual([
      DOMAIN,
      OTHER_DOMAIN,
      null
    ])
  })
})

describe('RuntimeServer concurrent World registration convergence', () => {
  const createConvergenceFixture = (failFirst = false) => {
    const attempts: Array<{ message: WorldRoomMessage; settle: ReturnType<typeof deferred<void>> }> = []
    const accepted: WorldRoomMessage[] = []
    const joinCalls: string[] = []
    const leave = vi.fn()
    let closeListener: ((roomId: string) => void) | null = null
    const transport: RoomTransport = {
      peerId: 'local-peer',
      join: async (roomId) => {
        joinCalls.push(roomId)
      },
      leave,
      send: async (roomId, payload) => {
        if (roomId !== getWorldRoomId()) return
        const message = JSON.parse(payload) as WorldRoomMessage
        const settle = deferred<void>()
        attempts.push({ message, settle })
        if (failFirst && attempts.length === 1) throw new Error('first World publication failed')
        await settle.promise
        accepted.push(message)
      },
      onMessage: () => () => {},
      onPeerJoin: () => () => {},
      onPeerLeave: () => () => {},
      onRoomClose: (callback) => {
        closeListener = callback
        return () => {
          closeListener = null
        }
      },
      onError: () => () => {},
      dispose: vi.fn()
    }
    return {
      server: createServer({ transport, codec: jsonCodec, clock: new FakeClock() }),
      attempts,
      accepted,
      joinCalls,
      leave,
      closeWorld: () => closeListener?.(getWorldRoomId())
    }
  }

  it('serializes concurrent registrations so the final accepted snapshot contains every successful domain', async () => {
    const { server, attempts, accepted } = createConvergenceFixture()
    const domainA = 'https://a.example'
    const domainB = 'https://b.example'
    await server.attachPage({ domain: domainA, pageId: 'page-a' })
    await server.attachPage({ domain: domainB, pageId: 'page-b' })

    const joinA = server.joinChatRoom({ domain: domainA, user: USER, site: { origin: domainA, title: 'A' } })
    const joinB = server.joinChatRoom({ domain: domainB, user: USER, site: { origin: domainB, title: 'B' } })
    await vi.waitFor(() => expect(attempts).toHaveLength(1))
    attempts[0].settle.resolve()
    await vi.waitFor(() => expect(attempts).toHaveLength(2))
    attempts[1].settle.resolve()
    await Promise.all([joinA, joinB])

    expect(
      accepted
        .at(-1)
        ?.sites.map(({ origin }) => origin)
        .toSorted()
    ).toEqual([domainA, domainB])
    disposeServer(server)
  })

  it('republishes the current registry before a staged join succeeds after release', async () => {
    const { server, attempts, accepted } = createConvergenceFixture()
    const domainA = 'https://a.example'
    const domainB = 'https://b.example'
    await server.attachPage({ domain: domainA, pageId: 'page-a' })
    const joinA = server.joinChatRoom({ domain: domainA, user: USER, site: { origin: domainA } })
    await vi.waitFor(() => expect(attempts).toHaveLength(1))
    attempts[0].settle.resolve()
    await joinA

    await server.attachPage({ domain: domainB, pageId: 'page-b' })
    let joinedB = false
    const joinB = server.joinChatRoom({ domain: domainB, user: USER, site: { origin: domainB } }).then(() => {
      joinedB = true
    })
    await vi.waitFor(() => expect(attempts).toHaveLength(2))
    await server.leaveChatRoom({ domain: domainA })
    attempts[1].settle.resolve()
    await vi.waitFor(() => expect(attempts).toHaveLength(3))

    expect(joinedB).toBe(false)
    expect(attempts[2].message.sites.map(({ origin }) => origin)).toEqual([domainB])
    attempts[2].settle.resolve()
    await joinB

    expect(accepted.at(-1)?.sites.map(({ origin }) => origin)).toEqual([domainB])
    expect((await server.getSnapshot()).world.localPresence?.sites.map(({ origin }) => origin)).toEqual([domainB])
    disposeServer(server)
  })

  it('does not let a release queued during a staged send erase the newly committed domain', async () => {
    const { server, attempts, accepted } = createConvergenceFixture()
    const domainA = 'https://a.example'
    const domainB = 'https://b.example'
    const domainC = 'https://c.example'
    for (const [domain, pageId] of [
      [domainA, 'page-a'],
      [domainC, 'page-c']
    ] as const) {
      await server.attachPage({ domain, pageId })
      const join = server.joinChatRoom({ domain, user: USER, site: { origin: domain } })
      await vi.waitFor(() => expect(attempts).toHaveLength(domain === domainA ? 1 : 2))
      attempts.at(-1)!.settle.resolve()
      await join
    }

    await server.attachPage({ domain: domainB, pageId: 'page-b' })
    const joinB = server.joinChatRoom({ domain: domainB, user: USER, site: { origin: domainB } })
    await vi.waitFor(() => expect(attempts).toHaveLength(3))
    await server.leaveChatRoom({ domain: domainA })
    attempts[2].settle.resolve()
    await vi.waitFor(() => expect(attempts).toHaveLength(4))
    expect(attempts[3].message.sites.map(({ origin }) => origin).toSorted()).toEqual([domainB, domainC])
    attempts[3].settle.resolve()
    await joinB

    const expected = [domainB, domainC]
    expect(
      accepted
        .at(-1)
        ?.sites.map(({ origin }) => origin)
        .toSorted()
    ).toEqual(expected)
    expect((await server.getSnapshot()).world.localPresence?.sites.map(({ origin }) => origin).toSorted()).toEqual(
      expected
    )
    disposeServer(server)
  })

  it('makes recovery and a staged join wait for the same accepted registry revision', async () => {
    const { server, attempts, accepted, joinCalls, closeWorld } = createConvergenceFixture()
    const domainA = 'https://a.example'
    const domainB = 'https://b.example'
    await server.attachPage({ domain: domainA, pageId: 'page-a' })
    const joinA = server.joinChatRoom({ domain: domainA, user: USER, site: { origin: domainA } })
    await vi.waitFor(() => expect(attempts).toHaveLength(1))
    attempts[0].settle.resolve()
    await joinA

    closeWorld()
    await vi.waitFor(() => expect(attempts).toHaveLength(2))
    await server.attachPage({ domain: domainB, pageId: 'page-b' })
    let joinedB = false
    const joinB = server.joinChatRoom({ domain: domainB, user: USER, site: { origin: domainB } }).then(() => {
      joinedB = true
    })
    await vi.waitFor(() => expect(joinCalls).toHaveLength(5))
    await settle()
    expect((await server.getSnapshot()).domains.find(({ domain }) => domain === domainB)?.chatRoomJoined).toBe(false)

    attempts[1].settle.resolve()
    await vi.waitFor(() => expect(attempts).toHaveLength(3))
    expect(joinedB).toBe(false)
    expect(attempts[2].message.sites.map(({ origin }) => origin).toSorted()).toEqual([domainA, domainB])
    attempts[2].settle.resolve()
    await joinB

    const snapshot = await server.getSnapshot()
    expect(snapshot.world.joined).toBe(true)
    expect(
      accepted
        .at(-1)
        ?.sites.map(({ origin }) => origin)
        .toSorted()
    ).toEqual([domainA, domainB])
    disposeServer(server)
  })

  it('does not fail the next staged domain when the released prior stage publication rejects late', async () => {
    const { server, attempts, accepted } = createConvergenceFixture()
    const domainA = 'https://a.example'
    const domainB = 'https://b.example'
    await server.attachPage({ domain: domainA, pageId: 'page-a' })
    await server.attachPage({ domain: domainB, pageId: 'page-b' })
    const joinAResult = server.joinChatRoom({ domain: domainA, user: USER, site: { origin: domainA } }).then(
      () => null,
      (error: Error) => error
    )
    let joinedB = false
    const joinB = server.joinChatRoom({ domain: domainB, user: USER, site: { origin: domainB } }).then(() => {
      joinedB = true
    })

    await vi.waitFor(() => expect(attempts).toHaveLength(1))
    expect(attempts[0].message.sites.map(({ origin }) => origin)).toEqual([domainA])
    await server.leaveChatRoom({ domain: domainA })
    attempts[0].settle.reject(new Error('released A publication failed late'))
    await vi.waitFor(() => expect(attempts).toHaveLength(2))

    expect(joinedB).toBe(false)
    expect(attempts[1].message.sites.map(({ origin }) => origin)).toEqual([domainB])
    attempts[1].settle.resolve()
    await joinB

    expect((await joinAResult)?.message).toBe('Domain released during join')
    expect(accepted.at(-1)?.sites.map(({ origin }) => origin)).toEqual([domainB])
    expect((await server.getSnapshot()).world.localPresence?.sites.map(({ origin }) => origin)).toEqual([domainB])
    disposeServer(server)
  })

  it('fails a staged join when its in-flight publication rejects after a release revision', async () => {
    const { server, attempts, accepted, leave } = createConvergenceFixture()
    const domainA = 'https://a.example'
    const domainB = 'https://b.example'
    await server.attachPage({ domain: domainA, pageId: 'page-a' })
    const joinA = server.joinChatRoom({ domain: domainA, user: USER, site: { origin: domainA } })
    await vi.waitFor(() => expect(attempts).toHaveLength(1))
    attempts[0].settle.resolve()
    await joinA

    await server.attachPage({ domain: domainB, pageId: 'page-b' })
    const joinBResult = server.joinChatRoom({ domain: domainB, user: USER, site: { origin: domainB } }).then(
      () => null,
      (error: Error) => error
    )
    await vi.waitFor(() => expect(attempts).toHaveLength(2))
    await server.leaveChatRoom({ domain: domainA })
    attempts[1].settle.reject(new Error('staged World publication failed'))
    const joinBError = await joinBResult

    expect(joinBError?.message).toBe('staged World publication failed')
    expect(accepted.at(-1)?.sites.map(({ origin }) => origin)).toEqual([domainA])
    expect((await server.getSnapshot()).world.localPresence).toBeUndefined()
    expect(leave).toHaveBeenCalledWith(getWorldRoomId())
    disposeServer(server)
  })

  it('removes a failed concurrent registration before publishing the next full snapshot', async () => {
    const { server, attempts, accepted } = createConvergenceFixture(true)
    const domainA = 'https://a.example'
    const domainB = 'https://b.example'
    await server.attachPage({ domain: domainA, pageId: 'page-a' })
    await server.attachPage({ domain: domainB, pageId: 'page-b' })

    const joinAResult = server
      .joinChatRoom({ domain: domainA, user: USER, site: { origin: domainA, title: 'A' } })
      .then(
        () => null,
        (error: Error) => error
      )
    const joinB = server.joinChatRoom({ domain: domainB, user: USER, site: { origin: domainB, title: 'B' } })
    await vi.waitFor(() => expect(attempts).toHaveLength(2))
    attempts[1].settle.resolve()
    const [joinAError] = await Promise.all([joinAResult, joinB])

    expect(joinAError?.message).toBe('first World publication failed')
    expect(accepted).toHaveLength(1)
    expect(accepted[0]?.sites.map(({ origin }) => origin)).toEqual([domainB])
    const snapshot = await server.getSnapshot()
    expect(snapshot.world.localPresence?.sites.map(({ origin }) => origin)).toEqual([domainB])
    expect(snapshot.domains.map(({ domain, chatRoomJoined }) => ({ domain, chatRoomJoined }))).toEqual([
      { domain: domainA, chatRoomJoined: false },
      { domain: domainB, chatRoomJoined: true }
    ])
    disposeServer(server)
  })
})

describe('RuntimeServer history', () => {
  it('serializes one history request per source while queueing another domain', async () => {
    const clock = new FakeClock()
    const fake = createFakeTransport()
    const server = createServer({ transport: fake.transport, clock, codec: jsonCodec })
    const firstRoom = getChatRoomId(DOMAIN)
    const secondRoom = getChatRoomId(OTHER_DOMAIN)
    await server.attachPage({ domain: DOMAIN, pageId: 'page-a' })
    await server.attachPage({ domain: OTHER_DOMAIN, pageId: 'page-b' })
    await server.joinChatRoom({ domain: DOMAIN, user: USER, site: SITE })
    await server.joinChatRoom({ domain: OTHER_DOMAIN, user: USER, site: { origin: OTHER_DOMAIN } })

    fake.receive(firstRoom, 'shared-peer', session())
    fake.receive(secondRoom, 'shared-peer', session())
    await settle()
    const firstRequest = fake.messages(firstRoom).find((message) => message.type === MESSAGE_TYPE.HISTORY_REQUEST)
    expect(firstRequest?.type).toBe(MESSAGE_TYPE.HISTORY_REQUEST)
    expect(fake.messages(secondRoom).filter((message) => message.type === MESSAGE_TYPE.HISTORY_REQUEST)).toHaveLength(0)

    fake.receive(firstRoom, 'shared-peer', {
      type: MESSAGE_TYPE.HISTORY_RESPONSE,
      syncId: (firstRequest as { syncId: string }).syncId,
      users: [],
      messages: [],
      done: true
    })
    await settle()

    expect(fake.messages(secondRoom).filter((message) => message.type === MESSAGE_TYPE.HISTORY_REQUEST)).toHaveLength(1)
  })

  it('keeps a queued requester domain alive for its full timeout after the prior domain finishes', async () => {
    const clock = new FakeClock()
    const fake = createFakeTransport()
    const server = createServer({ transport: fake.transport, clock, codec: jsonCodec })
    const firstRoom = getChatRoomId(DOMAIN)
    const secondRoom = getChatRoomId(OTHER_DOMAIN)
    const received: string[] = []
    await server.attachPage({ domain: DOMAIN, pageId: 'page-a' })
    await server.attachPage({ domain: OTHER_DOMAIN, pageId: 'page-b' })
    await server.joinChatRoom({ domain: DOMAIN, user: USER, site: SITE })
    await server.joinChatRoom({ domain: OTHER_DOMAIN, user: USER, site: { origin: OTHER_DOMAIN } })
    await server.onInbound({ pageId: 'page-b' }, (event) => {
      received.push(event.record.message.id)
    })
    fake.receive(firstRoom, 'shared-peer', session())
    fake.receive(secondRoom, 'shared-peer', session())
    await settle()
    const firstRequest = fake.messages(firstRoom).find((message) => message.type === MESSAGE_TYPE.HISTORY_REQUEST)

    clock.advance(9000)
    fake.receive(firstRoom, 'shared-peer', {
      type: MESSAGE_TYPE.HISTORY_RESPONSE,
      syncId: (firstRequest as { syncId: string }).syncId,
      users: [],
      messages: [],
      done: true
    })
    await settle()
    const secondRequest = fake.messages(secondRoom).find((message) => message.type === MESSAGE_TYPE.HISTORY_REQUEST)

    clock.advance(1001)
    await settle()
    clock.advance(8998)
    await settle()
    fake.receive(secondRoom, 'shared-peer', {
      type: MESSAGE_TYPE.HISTORY_RESPONSE,
      syncId: (secondRequest as { syncId: string }).syncId,
      users: [REMOTE_USER],
      messages: [text('domain-b-after-old-timeout')],
      done: true
    })
    await settle()

    expect(received).toEqual(['domain-b-after-old-timeout'])
  })

  it('releases a completed provider domain before serving the same source in another domain', async () => {
    const clock = new FakeClock()
    const fake = createFakeTransport()
    const server = createServer({ transport: fake.transport, clock, codec: jsonCodec })
    const firstRoom = getChatRoomId(DOMAIN)
    const secondRoom = getChatRoomId(OTHER_DOMAIN)
    await server.attachPage({ domain: DOMAIN, pageId: 'page-a' })
    await server.attachPage({ domain: OTHER_DOMAIN, pageId: 'page-b' })
    await server.joinChatRoom({ domain: DOMAIN, user: USER, site: SITE })
    await server.joinChatRoom({ domain: OTHER_DOMAIN, user: USER, site: { origin: OTHER_DOMAIN } })
    await registerHistoryProvider(server, { domain: DOMAIN, pageId: 'page-a' }, async () => ({
      records: [],
      done: true
    }))
    await registerHistoryProvider(server, { domain: OTHER_DOMAIN, pageId: 'page-b' }, async () => ({
      records: [textRecord('domain-b-immediate')],
      done: true
    }))
    fake.receive(firstRoom, 'shared-peer', session())
    fake.receive(secondRoom, 'shared-peer', session())
    fake.receive(firstRoom, 'shared-peer', { type: MESSAGE_TYPE.HISTORY_REQUEST, syncId: 'provider-a' })

    await vi.waitFor(() => {
      expect(
        fake
          .messages(firstRoom)
          .filter((message) => message.type === MESSAGE_TYPE.HISTORY_RESPONSE && message.syncId === 'provider-a')
      ).toHaveLength(1)
    })
    fake.receive(secondRoom, 'shared-peer', { type: MESSAGE_TYPE.HISTORY_REQUEST, syncId: 'provider-b' })

    await vi.waitFor(() => {
      expect(
        fake
          .messages(secondRoom)
          .filter((message) => message.type === MESSAGE_TYPE.HISTORY_RESPONSE && message.syncId === 'provider-b')
      ).toHaveLength(1)
    })
  })

  it('does not let an old provider timer close a newer domain sync for the same source', async () => {
    const clock = new FakeClock()
    const fake = createFakeTransport()
    const server = createServer({ transport: fake.transport, clock, codec: jsonCodec })
    const firstRoom = getChatRoomId(DOMAIN)
    const secondRoom = getChatRoomId(OTHER_DOMAIN)
    let secondSupplyCalls = 0
    await server.attachPage({ domain: DOMAIN, pageId: 'page-a' })
    await server.attachPage({ domain: OTHER_DOMAIN, pageId: 'page-b' })
    await server.joinChatRoom({ domain: DOMAIN, user: USER, site: SITE })
    await server.joinChatRoom({ domain: OTHER_DOMAIN, user: USER, site: { origin: OTHER_DOMAIN } })
    await registerHistoryProvider(server, { domain: DOMAIN, pageId: 'page-a' }, async () => ({
      records: [],
      done: true
    }))
    await registerHistoryProvider(server, { domain: OTHER_DOMAIN, pageId: 'page-b' }, async () => {
      secondSupplyCalls += 1
      return secondSupplyCalls === 1
        ? { records: [], done: false }
        : { records: [textRecord('provider-b-after-old-timeout')], done: true }
    })
    fake.receive(firstRoom, 'shared-peer', session())
    fake.receive(secondRoom, 'shared-peer', session())
    fake.receive(firstRoom, 'shared-peer', { type: MESSAGE_TYPE.HISTORY_REQUEST, syncId: 'provider-a' })
    await vi.waitFor(() => {
      expect(
        fake
          .messages(firstRoom)
          .filter((message) => message.type === MESSAGE_TYPE.HISTORY_RESPONSE && message.syncId === 'provider-a')
      ).toHaveLength(1)
    })

    clock.advance(9000)
    fake.receive(secondRoom, 'shared-peer', { type: MESSAGE_TYPE.HISTORY_REQUEST, syncId: 'provider-b' })
    await vi.waitFor(() => {
      expect(
        fake
          .messages(secondRoom)
          .filter((message) => message.type === MESSAGE_TYPE.HISTORY_RESPONSE && message.syncId === 'provider-b')
      ).toHaveLength(1)
    })
    clock.advance(1001)
    await settle()
    clock.advance(8998)
    await settle()
    fake.receive(secondRoom, 'shared-peer', { type: MESSAGE_TYPE.HISTORY_REQUEST, syncId: 'provider-b' })

    await vi.waitFor(() => {
      expect(
        fake
          .messages(secondRoom)
          .filter((message) => message.type === MESSAGE_TYPE.HISTORY_RESPONSE && message.syncId === 'provider-b')
      ).toHaveLength(2)
    })
  })

  it('waits for durable ACK of every history-response sequence before requesting the next response', async () => {
    const { fake, server, roomId } = await setup()
    const delivered: { sequence: number; id: string }[] = []
    await server.onInbound({ pageId: 'page-a' }, (event) => {
      delivered.push({ sequence: event.sequence, id: event.record.message.id })
    })
    fake.receive(roomId, 'peer-a', session())
    await settle()
    const initial = fake.messages(roomId).find((message) => message.type === MESSAGE_TYPE.HISTORY_REQUEST)
    const syncId = (initial as { syncId: string }).syncId

    fake.receive(roomId, 'peer-a', {
      type: MESSAGE_TYPE.HISTORY_RESPONSE,
      syncId,
      users: [REMOTE_USER],
      messages: [text('history-newer'), text('history-older', REMOTE_USER.id, NOW - 1)],
      done: false
    })
    await settle()

    expect(delivered).toEqual([
      { sequence: 1, id: 'history-newer' },
      { sequence: 2, id: 'history-older' }
    ])
    expect(fake.messages(roomId).filter((message) => message.type === MESSAGE_TYPE.HISTORY_REQUEST)).toHaveLength(1)

    await server.ackInbound({ domain: DOMAIN, sequence: delivered[0].sequence })
    await settle()
    expect(fake.messages(roomId).filter((message) => message.type === MESSAGE_TYPE.HISTORY_REQUEST)).toHaveLength(1)

    await server.ackInbound({ domain: DOMAIN, sequence: delivered[1].sequence })
    await settle()
    const requests = fake.messages(roomId).filter((message) => message.type === MESSAGE_TYPE.HISTORY_REQUEST)
    expect(requests).toHaveLength(2)
    expect(requests[1]).toMatchObject({ before: { id: 'history-older' } })
  })

  it('keeps provider supplies alive after page lookup throws before yielding an id', async () => {
    const originalHistoryPageIds = PagePort.prototype.historyPageIds
    let failNextPageLookup = true
    const pageLookup = vi
      .spyOn(PagePort.prototype, 'historyPageIds')
      .mockImplementation(function (this: PagePort, domain) {
        if (failNextPageLookup) {
          failNextPageLookup = false
          throw new Error('transient history page lookup failure')
        }
        return originalHistoryPageIds.call(this, domain)
      })
    let server: RuntimeServer | null = null

    try {
      const runtime = await setup()
      server = runtime.server
      await registerHistoryProvider(server, { domain: DOMAIN, pageId: 'page-a' }, async () => ({
        records: [],
        done: true
      }))
      runtime.fake.receive(runtime.roomId, 'peer-a', session())
      runtime.fake.receive(runtime.roomId, 'peer-a', {
        type: MESSAGE_TYPE.HISTORY_REQUEST,
        syncId: 'failed-page-lookup'
      })
      await settle()
      runtime.fake.receive(runtime.roomId, 'peer-a', {
        type: MESSAGE_TYPE.HISTORY_REQUEST,
        syncId: 'healthy-page-lookup'
      })

      await vi.waitFor(() =>
        expect(
          runtime.fake
            .messages(runtime.roomId)
            .filter(
              (message) => message.type === MESSAGE_TYPE.HISTORY_RESPONSE && message.syncId === 'healthy-page-lookup'
            )
        ).toHaveLength(1)
      )
    } finally {
      pageLookup.mockRestore()
      if (server) disposeServer(server)
    }
  })

  it('fails over a physically cancelled local history supplier and bounds provider sessions per source', async () => {
    const { clock, fake, server, roomId } = await setup()
    await server.attachPage({ domain: DOMAIN, pageId: 'page-b' })
    await registerHistoryProvider(
      server,
      { domain: DOMAIN, pageId: 'page-a' },
      (_request, signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true })
        })
    )
    await registerHistoryProvider(server, { domain: DOMAIN, pageId: 'page-b' }, async () => ({
      records: [textRecord('from-page-b')],
      done: false
    }))

    fake.receive(roomId, 'peer-a', session())
    fake.receive(roomId, 'peer-a', { type: MESSAGE_TYPE.HISTORY_REQUEST, syncId: 'provider-1' })
    await settle()
    clock.advance(5000)
    await settle()

    expect(
      fake
        .messages(roomId)
        .filter((message) => message.type === MESSAGE_TYPE.HISTORY_RESPONSE && message.syncId === 'provider-1')
    ).toHaveLength(1)

    fake.receive(roomId, 'peer-a', { type: MESSAGE_TYPE.HISTORY_REQUEST, syncId: 'provider-2' })
    await settle()
    expect(
      fake
        .messages(roomId)
        .filter((message) => message.type === MESSAGE_TYPE.HISTORY_RESPONSE && message.syncId === 'provider-2')
    ).toHaveLength(0)

    clock.advance(10000)
    await settle()
    fake.receive(roomId, 'peer-a', { type: MESSAGE_TYPE.HISTORY_REQUEST, syncId: 'provider-2' })
    await settle()
    clock.advance(5000)
    await settle()
    expect(
      fake
        .messages(roomId)
        .filter((message) => message.type === MESSAGE_TYPE.HISTORY_RESPONSE && message.syncId === 'provider-2')
    ).toHaveLength(1)
  })

  it('freezes the provider cutoff across page and cursor failover using its own clock', async () => {
    const dayMs = 24 * 60 * 60 * 1000
    const requesterNow = NOW
    const providerNow = requesterNow + dayMs
    const requesterCutoff = requesterNow - HISTORY_WINDOW_DAYS * dayMs
    const providerCutoff = providerNow - HISTORY_WINDOW_DAYS * dayMs
    const { clock, fake, server, roomId } = await setup(DOMAIN, providerNow)
    const firstPageCutoffs: number[] = []
    const secondPageCutoffs: number[] = []
    const localCandidates = [
      textRecord('at-provider-cutoff', providerCutoff),
      textRecord('requester-boundary-omitted-by-skew', requesterCutoff)
    ]
    await server.attachPage({ domain: DOMAIN, pageId: 'page-b' })
    await registerHistoryProvider(server, { domain: DOMAIN, pageId: 'page-a' }, (request, signal) => {
      firstPageCutoffs.push(request.cutoff)
      return new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true })
      })
    })
    await registerHistoryProvider(server, { domain: DOMAIN, pageId: 'page-b' }, async (request) => {
      secondPageCutoffs.push(request.cutoff)
      return secondPageCutoffs.length === 1 ? { records: localCandidates, done: false } : { records: [], done: true }
    })
    fake.receive(roomId, 'peer-a', session())
    fake.receive(roomId, 'peer-a', { type: MESSAGE_TYPE.HISTORY_REQUEST, syncId: 'independent-provider' })
    await vi.waitFor(() => expect(firstPageCutoffs).toEqual([providerCutoff]))

    clock.advance(5000)
    await vi.waitFor(() => expect(secondPageCutoffs).toEqual([providerCutoff]))
    const response = fake
      .messages(roomId)
      .find((message) => message.type === MESSAGE_TYPE.HISTORY_RESPONSE && message.syncId === 'independent-provider')
    if (response?.type !== MESSAGE_TYPE.HISTORY_RESPONSE) throw new Error('Expected provider history response')
    expect(response.messages.map((event) => event.id)).toEqual(['at-provider-cutoff'])
    expect(response).not.toHaveProperty('cutoff')
    expect(localCandidates.map((record) => record.message.id)).toEqual([
      'at-provider-cutoff',
      'requester-boundary-omitted-by-skew'
    ])
    expect(providerCutoff).not.toBe(requesterCutoff)

    clock.advance(1000)
    fake.receive(roomId, 'peer-a', {
      type: MESSAGE_TYPE.HISTORY_REQUEST,
      syncId: 'independent-provider',
      before: { hlc: { timestamp: providerCutoff, counter: 0 }, id: 'at-provider-cutoff' }
    })
    await vi.waitFor(() => expect(secondPageCutoffs).toEqual([providerCutoff, providerCutoff]))
  })

  it('fails over immediately when the selected page detaches during supply', async () => {
    const { fake, server, roomId } = await setup()
    let firstPageCalls = 0
    await server.attachPage({ domain: DOMAIN, pageId: 'page-b' })
    await registerHistoryProvider(server, { domain: DOMAIN, pageId: 'page-a' }, () => {
      firstPageCalls += 1
      return new Promise(() => {})
    })
    await registerHistoryProvider(server, { domain: DOMAIN, pageId: 'page-b' }, async () => ({
      records: [textRecord('page-b-after-detach')],
      done: true
    }))
    fake.receive(roomId, 'peer-a', session())
    fake.receive(roomId, 'peer-a', { type: MESSAGE_TYPE.HISTORY_REQUEST, syncId: 'page-detach' })
    await vi.waitFor(() => expect(firstPageCalls).toBe(1))

    await server.detachPage({ domain: DOMAIN, pageId: 'page-a' })

    await vi.waitFor(() => {
      expect(
        fake
          .messages(roomId)
          .filter((message) => message.type === MESSAGE_TYPE.HISTORY_RESPONSE && message.syncId === 'page-detach')
      ).toHaveLength(1)
    })
  })

  it('keeps another domain provider alive when the same peer leaves one room', async () => {
    const clock = new FakeClock()
    const fake = createFakeTransport()
    const server = createServer({ transport: fake.transport, clock, codec: jsonCodec })
    const firstRoom = getChatRoomId(DOMAIN)
    const secondRoom = getChatRoomId(OTHER_DOMAIN)
    const supplied = deferred<{ records: TextMessageRecord[]; done: boolean }>()
    await server.attachPage({ domain: DOMAIN, pageId: 'page-a' })
    await server.attachPage({ domain: OTHER_DOMAIN, pageId: 'page-b' })
    await server.joinChatRoom({ domain: DOMAIN, user: USER, site: SITE })
    await server.joinChatRoom({ domain: OTHER_DOMAIN, user: USER, site: { origin: OTHER_DOMAIN } })
    await registerHistoryProvider(server, { domain: OTHER_DOMAIN, pageId: 'page-b' }, () => supplied.promise)
    fake.receive(firstRoom, 'shared-peer', session())
    fake.receive(secondRoom, 'shared-peer', session())
    fake.receive(secondRoom, 'shared-peer', { type: MESSAGE_TYPE.HISTORY_REQUEST, syncId: 'domain-b-provider' })
    await settle()

    fake.peerLeave(firstRoom, 'shared-peer')
    supplied.resolve({ records: [textRecord('domain-b-history')], done: true })

    await vi.waitFor(() => {
      expect(
        fake
          .messages(secondRoom)
          .filter((message) => message.type === MESSAGE_TYPE.HISTORY_RESPONSE && message.syncId === 'domain-b-provider')
      ).toHaveLength(1)
    })
  })

  it('isolates provider supply by source so one hung peer cannot block another', async () => {
    const { fake, server, roomId } = await setup()
    await registerHistoryProvider(server, { domain: DOMAIN, pageId: 'page-a' }, (request) =>
      request.syncId === 'hung-source'
        ? new Promise(() => {})
        : Promise.resolve({ records: [textRecord('responsive-history')], done: true })
    )
    fake.receive(roomId, 'peer-a', session())
    fake.receive(roomId, 'peer-b', session({ ...REMOTE_USER, id: 'remote-b' }))
    fake.receive(roomId, 'peer-a', { type: MESSAGE_TYPE.HISTORY_REQUEST, syncId: 'hung-source' })
    fake.receive(roomId, 'peer-b', { type: MESSAGE_TYPE.HISTORY_REQUEST, syncId: 'responsive-source' })

    await vi.waitFor(() => {
      expect(
        fake
          .messages(roomId)
          .filter((message) => message.type === MESSAGE_TYPE.HISTORY_RESPONSE && message.syncId === 'responsive-source')
      ).toHaveLength(1)
    })
    expect(
      fake
        .messages(roomId)
        .filter((message) => message.type === MESSAGE_TYPE.HISTORY_RESPONSE && message.syncId === 'hung-source')
    ).toHaveLength(0)
  })

  it('freezes a dormant successor cutoff at its own admission and retains it after promotion', async () => {
    const { clock, fake, server, roomId } = await setup()
    const firstSupply = deferred<{ records: TextMessageRecord[]; done: boolean }>()
    const suppliedRequests: { syncId: string; cutoff: number }[] = []
    const windowMs = HISTORY_WINDOW_DAYS * 24 * 60 * 60 * 1000
    await registerHistoryProvider(server, { domain: DOMAIN, pageId: 'page-a' }, (request) => {
      suppliedRequests.push({ syncId: request.syncId, cutoff: request.cutoff })
      return request.syncId === 'before-reset'
        ? firstSupply.promise
        : Promise.resolve({ records: [textRecord('replacement-history')], done: true })
    })
    fake.receive(roomId, 'peer-a', session())
    fake.receive(roomId, 'peer-a', { type: MESSAGE_TYPE.HISTORY_REQUEST, syncId: 'before-reset' })
    await vi.waitFor(() => expect(suppliedRequests).toEqual([{ syncId: 'before-reset', cutoff: NOW - windowMs }]))

    fake.receive(roomId, 'peer-a', { ...session(), sessionId: 'replacement-session' })
    clock.advance(1000)
    fake.receive(roomId, 'peer-a', { type: MESSAGE_TYPE.HISTORY_REQUEST, syncId: 'replacement-request' })
    await settle()
    expect(suppliedRequests).toHaveLength(1)

    clock.advance(1000)
    firstSupply.resolve({ records: [], done: true })
    await vi.waitFor(() =>
      expect(suppliedRequests).toEqual([
        { syncId: 'before-reset', cutoff: NOW - windowMs },
        { syncId: 'replacement-request', cutoff: NOW + 1000 - windowMs }
      ])
    )
    await vi.waitFor(() => {
      expect(
        fake
          .messages(roomId)
          .filter(
            (message) => message.type === MESSAGE_TYPE.HISTORY_RESPONSE && message.syncId === 'replacement-request'
          )
      ).toHaveLength(1)
    })
  })

  it('waits for timed-out page work to physically settle before failover and successor promotion', async () => {
    const { clock, fake, server, roomId } = await setup()
    const oldPhysicalWork = deferred<{ records: TextMessageRecord[]; done: boolean }>()
    const calls: string[] = []
    let oldSignal: AbortSignal | null = null
    await server.attachPage({ domain: DOMAIN, pageId: 'page-b' })
    await registerHistoryProvider(server, { domain: DOMAIN, pageId: 'page-a' }, (request, signal) => {
      calls.push(`page-a:${request.syncId}`)
      oldSignal = signal
      return oldPhysicalWork.promise
    })
    await registerHistoryProvider(server, { domain: DOMAIN, pageId: 'page-b' }, async (request) => {
      calls.push(`page-b:${request.syncId}`)
      return { records: [textRecord(request.syncId)], done: true }
    })
    fake.receive(roomId, 'peer-a', session())
    fake.receive(roomId, 'peer-a', { type: MESSAGE_TYPE.HISTORY_REQUEST, syncId: 'old-work' })
    await vi.waitFor(() => expect(calls).toEqual(['page-a:old-work']))

    fake.receive(roomId, 'peer-a', { ...session(), sessionId: 'replacement-session' })
    fake.receive(roomId, 'peer-a', { type: MESSAGE_TYPE.HISTORY_REQUEST, syncId: 'successor' })
    clock.advance(5001)
    await settle()

    expect(oldSignal).not.toBeNull()
    expect((oldSignal as unknown as AbortSignal).aborted).toBe(true)
    expect(calls).toEqual(['page-a:old-work'])
    expect(fake.messages(roomId).filter((message) => message.type === MESSAGE_TYPE.HISTORY_RESPONSE)).toHaveLength(0)

    oldPhysicalWork.resolve({ records: [], done: true })
    await vi.waitFor(() => expect(calls).toEqual(['page-a:old-work', 'page-b:old-work', 'page-b:successor']))
    await vi.waitFor(() => {
      expect(
        fake
          .messages(roomId)
          .filter((message) => message.type === MESSAGE_TYPE.HISTORY_RESPONSE && message.syncId === 'successor')
      ).toHaveLength(1)
    })
  })

  it('invalidates a queued replacement request when the peer leaves before the old job settles', async () => {
    const { fake, server, roomId } = await setup()
    const firstSupply = deferred<{ records: TextMessageRecord[]; done: boolean }>()
    const suppliedSyncIds: string[] = []
    await registerHistoryProvider(server, { domain: DOMAIN, pageId: 'page-a' }, (request) => {
      suppliedSyncIds.push(request.syncId)
      return firstSupply.promise
    })
    fake.receive(roomId, 'peer-a', session())
    fake.receive(roomId, 'peer-a', { type: MESSAGE_TYPE.HISTORY_REQUEST, syncId: 'before-leave' })
    await vi.waitFor(() => expect(suppliedSyncIds).toEqual(['before-leave']))

    fake.receive(roomId, 'peer-a', { ...session(), sessionId: 'replacement-before-leave' })
    fake.receive(roomId, 'peer-a', { type: MESSAGE_TYPE.HISTORY_REQUEST, syncId: 'queued-before-leave' })
    await settle()
    expect(suppliedSyncIds).toEqual(['before-leave'])
    fake.peerLeave(roomId, 'peer-a')
    await settle()
    firstSupply.resolve({ records: [], done: true })
    await settle()

    expect(suppliedSyncIds).toEqual(['before-leave'])
  })

  it('invalidates a queued replacement request when its domain is released', async () => {
    const { clock, fake, server, roomId } = await setup()
    const suppliedSyncIds: string[] = []
    fake.hangHistoryResponseSends()
    await registerHistoryProvider(server, { domain: DOMAIN, pageId: 'page-a' }, async (request) => {
      suppliedSyncIds.push(request.syncId)
      return { records: [], done: true }
    })
    fake.receive(roomId, 'peer-a', session())
    fake.receive(roomId, 'peer-a', { type: MESSAGE_TYPE.HISTORY_REQUEST, syncId: 'before-release' })
    await vi.waitFor(() => expect(fake.activeHistorySends()).toBe(1))

    fake.receive(roomId, 'peer-a', { ...session(), sessionId: 'replacement-before-release' })
    fake.receive(roomId, 'peer-a', { type: MESSAGE_TYPE.HISTORY_REQUEST, syncId: 'queued-before-release' })
    await server.detachPage({ domain: DOMAIN, pageId: 'page-a' })
    clock.advance(RUNTIME_DOMAIN_GRACE_MS + 1)
    await settle()

    fake.releaseHistoryResponseSends()
    await vi.waitFor(() => expect(fake.activeHistorySends()).toBe(0))
    await settle()
    expect(suppliedSyncIds).toEqual(['before-release'])
  })

  it('invalidates a queued replacement request on timeout without releasing the old active job', async () => {
    const { clock, fake, server, roomId } = await setup()
    const firstSupply = deferred<{ records: TextMessageRecord[]; done: boolean }>()
    const suppliedSyncIds: string[] = []
    await registerHistoryProvider(server, { domain: DOMAIN, pageId: 'page-a' }, (request) => {
      suppliedSyncIds.push(request.syncId)
      return firstSupply.promise
    })
    fake.receive(roomId, 'peer-a', session())
    fake.receive(roomId, 'peer-a', { type: MESSAGE_TYPE.HISTORY_REQUEST, syncId: 'before-timeout' })
    await vi.waitFor(() => expect(suppliedSyncIds).toEqual(['before-timeout']))

    fake.receive(roomId, 'peer-a', { ...session(), sessionId: 'replacement-before-timeout' })
    fake.receive(roomId, 'peer-a', { type: MESSAGE_TYPE.HISTORY_REQUEST, syncId: 'queued-before-timeout' })
    clock.advance(10001)
    await settle()
    firstSupply.resolve({ records: [], done: true })
    await settle()

    expect(suppliedSyncIds).toEqual(['before-timeout'])
  })

  it('counts dormant replacement successors against the shared admission cap', async () => {
    const { fake, server, roomId } = await setup()
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    let supplyCalls = 0
    await registerHistoryProvider(server, { domain: DOMAIN, pageId: 'page-a' }, () => {
      supplyCalls += 1
      return new Promise(() => {})
    })
    for (let index = 0; index < 16; index += 1) {
      const peerId = `successor-peer-${index}`
      const user = { ...REMOTE_USER, id: `successor-user-${index}` }
      fake.receive(roomId, peerId, session(user))
      fake.receive(roomId, peerId, { type: MESSAGE_TYPE.HISTORY_REQUEST, syncId: `active-${index}` })
      fake.receive(roomId, peerId, { ...session(user), sessionId: `replacement-${index}` })
      fake.receive(roomId, peerId, { type: MESSAGE_TYPE.HISTORY_REQUEST, syncId: `successor-${index}` })
    }
    await vi.waitFor(() => expect(supplyCalls).toBe(4))

    fake.receive(roomId, 'overflow-peer', session({ ...REMOTE_USER, id: 'overflow-user' }))
    fake.receive(roomId, 'overflow-peer', { type: MESSAGE_TYPE.HISTORY_REQUEST, syncId: 'overflow' })
    await vi.waitFor(() => {
      expect(warning).toHaveBeenCalledWith(expect.stringContaining('history provider queue limit reached'), '')
    })
    const warningCount = warning.mock.calls.length

    fake.peerLeave(roomId, 'successor-peer-0')
    await settle()
    fake.receive(roomId, 'overflow-peer', { type: MESSAGE_TYPE.HISTORY_REQUEST, syncId: 'after-release' })
    await settle()
    expect(warning).toHaveBeenCalledTimes(warningCount)
    warning.mockRestore()
  })

  it('uses one four-job concurrency boundary across supplier and hung page send', async () => {
    const { clock, fake, server, roomId } = await setup()
    let supplyCalls = 0
    fake.hangHistoryResponseSends()
    await registerHistoryProvider(server, { domain: DOMAIN, pageId: 'page-a' }, async () => {
      supplyCalls += 1
      return { records: [], done: true }
    })
    for (let index = 0; index < 8; index += 1) {
      fake.receive(roomId, `send-peer-${index}`, session({ ...REMOTE_USER, id: `send-remote-${index}` }))
    }
    await settle()
    for (let index = 0; index < 8; index += 1) {
      fake.receive(roomId, `send-peer-${index}`, {
        type: MESSAGE_TYPE.HISTORY_REQUEST,
        syncId: `send-${index}`
      })
    }

    await vi.waitFor(() => expect(supplyCalls).toBe(4))
    expect(fake.maxActiveHistorySends()).toBeLessThanOrEqual(1)
    expect(fake.activeHistorySends()).toBe(1)
    clock.advance(10001)
    await settle()
    expect(supplyCalls).toBe(4)
    expect(fake.activeHistorySends()).toBe(1)

    fake.releaseHistoryResponseSends()
    await vi.waitFor(() => expect(fake.activeHistorySends()).toBe(0))
    await settle()
    fake.receive(roomId, 'send-peer-0', {
      type: MESSAGE_TYPE.HISTORY_REQUEST,
      syncId: 'send-after-timeout'
    })
    await vi.waitFor(() => expect(supplyCalls).toBe(5))
  })

  it('drops a late supplier completion after timeout and releases its admission exactly once', async () => {
    const { clock, fake, server, roomId } = await setup()
    const lateSupply = deferred<{ records: TextMessageRecord[]; done: boolean }>()
    let supplyCalls = 0
    await registerHistoryProvider(server, { domain: DOMAIN, pageId: 'page-a' }, () => {
      supplyCalls += 1
      return lateSupply.promise
    })
    fake.receive(roomId, 'peer-a', session())
    fake.receive(roomId, 'peer-a', { type: MESSAGE_TYPE.HISTORY_REQUEST, syncId: 'timed-out' })
    await vi.waitFor(() => expect(supplyCalls).toBe(1))

    clock.advance(5001)
    await settle()
    lateSupply.resolve({ records: [textRecord('too-late')], done: true })
    await settle()
    expect(fake.messages(roomId).filter((message) => message.type === MESSAGE_TYPE.HISTORY_RESPONSE)).toHaveLength(0)

    await server.attachPage({ domain: DOMAIN, pageId: 'page-b' })
    await registerHistoryProvider(server, { domain: DOMAIN, pageId: 'page-b' }, async () => {
      supplyCalls += 1
      return { records: [textRecord('after-timeout')], done: true }
    })
    fake.receive(roomId, 'peer-a', { ...session(), sessionId: 'after-timeout-session' })
    fake.receive(roomId, 'peer-a', { type: MESSAGE_TYPE.HISTORY_REQUEST, syncId: 'after-timeout' })

    await vi.waitFor(() => expect(supplyCalls).toBe(2))
    await vi.waitFor(() => {
      expect(
        fake
          .messages(roomId)
          .filter((message) => message.type === MESSAGE_TYPE.HISTORY_RESPONSE && message.syncId === 'after-timeout')
      ).toHaveLength(1)
    })
  })

  it('counts dormant successors against queued-byte admission during session cleanup', async () => {
    const { fake, server, roomId } = await setup()
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await registerHistoryProvider(server, { domain: DOMAIN, pageId: 'page-a' }, () => new Promise(() => {}))
    for (let index = 0; index < 15; index += 1) {
      const peerId = `queue-peer-${index}`
      const user = { ...REMOTE_USER, id: `queue-user-${index}` }
      fake.receive(roomId, peerId, session(user))
      fake.receive(roomId, peerId, {
        type: MESSAGE_TYPE.HISTORY_REQUEST,
        syncId: `active-${index}`.padEnd(128, 'a'),
        before: { hlc: { timestamp: NOW, counter: 0 }, id: 'i'.repeat(128) }
      })
      fake.receive(roomId, peerId, { ...session(user), sessionId: `reset-${index}` })
      fake.receive(roomId, peerId, {
        type: MESSAGE_TYPE.HISTORY_REQUEST,
        syncId: `successor-${index}`.padEnd(128, 's'),
        before: { hlc: { timestamp: NOW, counter: 0 }, id: 'j'.repeat(128) }
      })
    }

    await vi.waitFor(() => {
      expect(warning).toHaveBeenCalledWith(expect.stringContaining('history provider queue limit reached'), '')
    })
    warning.mockRestore()
  })

  it('retains request-count admission across provider session cleanup', async () => {
    const { fake, server, roomId } = await setup()
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await registerHistoryProvider(server, { domain: DOMAIN, pageId: 'page-a' }, () => new Promise(() => {}))
    for (let index = 0; index < 33; index += 1) {
      const peerId = `count-peer-${index}`
      fake.receive(roomId, peerId, session({ ...REMOTE_USER, id: `count-remote-${index}` }))
    }
    await settle()
    for (let index = 0; index < 33; index += 1) {
      fake.receive(roomId, `count-peer-${index}`, {
        type: MESSAGE_TYPE.HISTORY_REQUEST,
        syncId: `count-${index}`
      })
      fake.receive(roomId, `count-peer-${index}`, {
        ...session({ ...REMOTE_USER, id: `count-remote-${index}` }),
        sessionId: `count-reset-${index}`
      })
    }

    await vi.waitFor(() => {
      expect(warning).toHaveBeenCalledWith(expect.stringContaining('history provider queue limit reached'), '')
    })
    warning.mockRestore()
  })

  it('serves immutable history responses with user snapshots from one selected local page', async () => {
    const { fake, server, roomId } = await setup()
    await registerHistoryProvider(server, { domain: DOMAIN, pageId: 'page-a' }, async (request) => ({
      records: [textRecord('history-1', request.cutoff + 1)],
      done: true
    }))
    fake.receive(roomId, 'peer-a', session())
    fake.receive(roomId, 'peer-a', { type: MESSAGE_TYPE.HISTORY_REQUEST, syncId: 'request-1' })
    await settle()

    const response = fake
      .messages(roomId)
      .find((message) => message.type === MESSAGE_TYPE.HISTORY_RESPONSE && message.syncId === 'request-1')
    expect(response).toMatchObject({
      type: MESSAGE_TYPE.HISTORY_RESPONSE,
      users: [USER],
      messages: [{ id: 'history-1' }],
      done: true
    })
  })

  it('stops at the requester message budget without issuing another page request', async () => {
    const clock = new FakeClock()
    const fake = createFakeTransport()
    const server = createServer({
      transport: fake.transport,
      clock,
      codec: jsonCodec,
      historySessionMessages: 1
    })
    const roomId = getChatRoomId(DOMAIN)
    await server.attachPage({ domain: DOMAIN, pageId: 'page-a' })
    await server.joinChatRoom({ domain: DOMAIN, user: USER, site: SITE })
    const received: string[] = []
    await server.onInbound({ pageId: 'page-a' }, (event) => {
      received.push(event.record.message.id)
    })
    fake.receive(roomId, 'peer-a', session())
    await settle()
    const request = fake.messages(roomId).find((message) => message.type === MESSAGE_TYPE.HISTORY_REQUEST)
    const syncId = (request as { syncId: string }).syncId

    fake.receive(roomId, 'peer-a', {
      type: MESSAGE_TYPE.HISTORY_RESPONSE,
      syncId,
      users: [REMOTE_USER],
      messages: [text('newer'), text('older', REMOTE_USER.id, NOW - 1)],
      done: false
    })
    await settle()

    expect(received).toEqual(['newer'])
    expect(fake.messages(roomId).filter((message) => message.type === MESSAGE_TYPE.HISTORY_REQUEST)).toHaveLength(1)
  })

  it('keeps requester authority frozen across pagination and rejects an older provider-clock boundary', async () => {
    const dayMs = 24 * 60 * 60 * 1000
    const requesterNow = NOW
    const providerNow = requesterNow - dayMs
    const requesterCutoff = requesterNow - HISTORY_WINDOW_DAYS * dayMs
    const providerCutoff = providerNow - HISTORY_WINDOW_DAYS * dayMs
    const { clock, fake, server, roomId } = await setup(DOMAIN, requesterNow)
    const delivered: { sequence: number; id: string }[] = []
    await server.onInbound({ pageId: 'page-a' }, (event) => {
      delivered.push({ sequence: event.sequence, id: event.record.message.id })
    })
    fake.receive(roomId, 'peer-a', session())
    await settle()
    const initial = fake.messages(roomId).find((message) => message.type === MESSAGE_TYPE.HISTORY_REQUEST)
    expect(initial?.type).toBe(MESSAGE_TYPE.HISTORY_REQUEST)
    const syncId = (initial as { syncId: string }).syncId
    expect(initial).toEqual({ type: MESSAGE_TYPE.HISTORY_REQUEST, syncId })

    clock.advance(1000)
    fake.receive(roomId, 'peer-a', {
      type: MESSAGE_TYPE.HISTORY_RESPONSE,
      syncId,
      users: [REMOTE_USER],
      messages: [text('first-response', REMOTE_USER.id, requesterCutoff + 1)],
      done: false
    })
    await vi.waitFor(() => expect(delivered).toEqual([{ sequence: 1, id: 'first-response' }]))
    await server.ackInbound({ domain: DOMAIN, sequence: delivered[0].sequence })
    await settle()
    const requests = fake.messages(roomId).filter((message) => message.type === MESSAGE_TYPE.HISTORY_REQUEST)
    expect(requests).toHaveLength(2)
    expect(requests[1]).toMatchObject({ syncId, before: { id: 'first-response' } })
    expect(requests.every((request) => !('cutoff' in request))).toBe(true)

    clock.advance(1000)
    fake.receive(roomId, 'peer-a', {
      type: MESSAGE_TYPE.HISTORY_RESPONSE,
      syncId,
      users: [REMOTE_USER],
      messages: [
        text('at-requester-cutoff', REMOTE_USER.id, requesterCutoff),
        text('older-provider-clock-boundary', REMOTE_USER.id, providerCutoff)
      ],
      done: true
    })
    await vi.waitFor(() =>
      expect(delivered).toEqual([
        { sequence: 1, id: 'first-response' },
        { sequence: 2, id: 'at-requester-cutoff' }
      ])
    )
    expect(providerCutoff).not.toBe(requesterCutoff)
  })
})

describe('RuntimeServer Artico per-target isolation', () => {
  it('commits initial Chat publication when the first remembered peer starts closing', async () => {
    const roomId = getChatRoomId(DOMAIN)
    const worldRoomId = getWorldRoomId()
    const server = await createArticoTestServer([roomId, worldRoomId])
    const chatRoom = articoRoom(roomId)
    const worldRoom = articoRoom(worldRoomId)
    chatRoom.open('closing-peer')
    chatRoom.open('later-ready-peer')
    chatRoom.loseReadiness('closing-peer')
    worldRoom.open('world-ready-peer')
    await server.attachPage({ domain: DOMAIN, pageId: 'page-a' })

    const joinError = await server.joinChatRoom({ domain: DOMAIN, user: USER, site: SITE }).then(
      () => null,
      (error: Error) => error.message
    )
    await settle()
    const snapshot = await server.getSnapshot()
    const result = {
      joinError,
      joined: snapshot.domains[0]?.chatRoomJoined ?? false,
      laterChat: articoMessagesTo(chatRoom, 'later-ready-peer').map((message) => message.type),
      laterWorld: articoMessagesTo(worldRoom, 'world-ready-peer').filter(isWorldPresence).length
    }
    disposeServer(server)

    expect(result).toEqual({
      joinError: null,
      joined: true,
      laterChat: [MESSAGE_TYPE.SESSION],
      laterWorld: 1
    })
  })

  it('does not roll back partial initial publication or replay an accepted peer', async () => {
    const roomId = getChatRoomId(DOMAIN)
    const worldRoomId = getWorldRoomId()
    const server = await createArticoTestServer([roomId, worldRoomId])
    const chatRoom = articoRoom(roomId)
    const worldRoom = articoRoom(worldRoomId)
    chatRoom.open('chat-ready-peer')
    worldRoom.open('accepted-peer')
    worldRoom.open('closing-peer')
    worldRoom.open('later-ready-peer')
    worldRoom.loseReadiness('closing-peer')
    await server.attachPage({ domain: DOMAIN, pageId: 'page-a' })

    const joinError = await server.joinChatRoom({ domain: DOMAIN, user: USER, site: SITE }).then(
      () => null,
      (error: Error) => error.message
    )
    await settle()
    const snapshot = await server.getSnapshot()
    const result = {
      joinError,
      joined: snapshot.domains[0]?.chatRoomJoined ?? false,
      attempts: worldRoom.attempts.map((attempt) => attempt.peerId),
      accepted: articoMessagesTo(worldRoom, 'accepted-peer').filter(isWorldPresence).length,
      later: articoMessagesTo(worldRoom, 'later-ready-peer').filter(isWorldPresence).length
    }
    disposeServer(server)

    expect(result).toEqual({
      joinError: null,
      joined: true,
      attempts: ['accepted-peer', 'closing-peer', 'later-ready-peer'],
      accepted: 1,
      later: 1
    })
  })

  it('continues a committed World presence update after a target-local miss', async () => {
    const firstRoomId = getChatRoomId(DOMAIN)
    const secondRoomId = getChatRoomId(OTHER_DOMAIN)
    const worldRoomId = getWorldRoomId()
    const server = await createArticoTestServer([firstRoomId, secondRoomId, worldRoomId])
    articoRoom(firstRoomId).open('chat-ready-peer')
    articoRoom(secondRoomId).open('chat-ready-peer')
    const worldRoom = articoRoom(worldRoomId)
    worldRoom.open('closing-peer')
    worldRoom.open('later-ready-peer')
    await server.attachPage({ domain: DOMAIN, pageId: 'page-a' })
    await server.joinChatRoom({ domain: DOMAIN, user: USER, site: SITE })
    await server.attachPage({ domain: OTHER_DOMAIN, pageId: 'page-b' })
    await server.joinChatRoom({
      domain: OTHER_DOMAIN,
      user: USER,
      site: { ...SITE, origin: OTHER_DOMAIN, title: 'Other' }
    })
    await settle()
    const laterBefore = articoMessagesTo(worldRoom, 'later-ready-peer').length
    const errors: string[] = []
    await server.onError({ pageId: 'page-a' }, (error) => errors.push(error.message))
    worldRoom.loseReadiness('closing-peer')

    await server.detachPage({ domain: OTHER_DOMAIN, pageId: 'page-b' })
    await vi.advanceTimersByTimeAsync(RUNTIME_DOMAIN_GRACE_MS + 1)
    await settle()
    const snapshot = await server.getSnapshot()
    const laterMessages = articoMessagesTo(worldRoom, 'later-ready-peer')
    const latest = laterMessages.at(-1)
    const result = {
      domains: snapshot.domains.map((domain) => domain.domain),
      laterDelta: laterMessages.length - laterBefore,
      latestSites: latest && isWorldPresence(latest) ? latest.sites.map((site) => site.origin) : [],
      errors
    }
    disposeServer(server)

    expect(result).toEqual({ domains: [DOMAIN], laterDelta: 1, latestSites: [DOMAIN], errors: [] })
  })

  it('commits World recovery while containing the first recovered target miss', async () => {
    const roomId = getChatRoomId(DOMAIN)
    const worldRoomId = getWorldRoomId()
    const server = await createArticoTestServer([roomId, worldRoomId])
    articoRoom(roomId).open('chat-ready-peer')
    const initialWorldRoom = articoRoom(worldRoomId)
    initialWorldRoom.open('world-ready-peer')
    await server.attachPage({ domain: DOMAIN, pageId: 'page-a' })
    await server.joinChatRoom({ domain: DOMAIN, user: USER, site: SITE })
    await settle()
    const errors: string[] = []
    await server.onError({ pageId: 'page-a' }, (error) => errors.push(error.message))
    runtimeArticoFixture.nextJoins.set(worldRoomId, {
      peers: ['closing-peer', 'later-ready-peer'],
      closing: ['closing-peer']
    })

    initialWorldRoom.closeUnexpectedly()
    await settle()
    await settle()
    const recoveredWorldRoom = articoRoom(worldRoomId)
    const snapshot = await server.getSnapshot()
    const result = {
      joined: snapshot.world.joined,
      attempts: recoveredWorldRoom.attempts.map((attempt) => attempt.peerId),
      later: articoMessagesTo(recoveredWorldRoom, 'later-ready-peer').filter(isWorldPresence).length,
      errors
    }
    disposeServer(server)

    expect(result).toEqual({
      joined: true,
      attempts: ['closing-peer', 'later-ready-peer'],
      later: 1,
      errors: []
    })
  })

  it('keeps pre-provider codec rejection operation-wide with zero target attempts', async () => {
    const roomId = getChatRoomId(DOMAIN)
    const worldRoomId = getWorldRoomId()
    const codec: WireCodec = {
      encode: async () => {
        throw new Error('codec rejected')
      },
      decode: async (payload) => JSON.parse(payload)
    }
    const server = await createArticoTestServer([roomId, worldRoomId], codec)
    const chatRoom = articoRoom(roomId)
    const worldRoom = articoRoom(worldRoomId)
    chatRoom.open('chat-ready-peer')
    worldRoom.open('world-ready-peer')
    await server.attachPage({ domain: DOMAIN, pageId: 'page-a' })

    const joinError = await server.joinChatRoom({ domain: DOMAIN, user: USER, site: SITE }).then(
      () => null,
      (error: Error) => error.message
    )
    await settle()
    const snapshot = await server.getSnapshot()
    const result = {
      joinError,
      domains: snapshot.domains,
      chatAttempts: chatRoom.attempts,
      worldAttempts: worldRoom.attempts
    }
    disposeServer(server)

    expect(result).toEqual({
      joinError: 'codec rejected',
      domains: [
        {
          domain: DOMAIN,
          pageIds: ['page-a'],
          phase: 'active',
          chatRoomJoined: false,
          sessions: [],
          localSession: undefined
        }
      ],
      chatAttempts: [],
      worldAttempts: []
    })
  })
})
