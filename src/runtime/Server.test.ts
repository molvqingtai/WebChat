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
import { createMessageStore } from '@/domain/MessageStore'
import { createMemoryMessageDatabase } from '@/domain/impls/database/Memory'
import type {
  HistorySupplyRequest,
  HistorySupplyResult,
  RuntimeServer,
  RuntimeSession,
  RuntimeSessionEvent,
  WorldPresenceEvent
} from '@/runtime/Contract'
import { RUNTIME_DOMAIN_GRACE_MS } from '@/constants/config'
import { createArticoRoomTransport } from '@/runtime/ArticoRoomTransport'
import { createBrowserPresenceStore } from '@/runtime/PresenceStore'

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
  const peersByRoom = new Map<string, Set<string>>()
  const failedJoins = new Set<string>()
  const messageListeners = new Set<(roomId: string, sourcePeerId: string, rawPayload: string) => void>()
  const joinListeners = new Set<(roomId: string, peerId: string) => void>()
  const leaveListeners = new Set<(roomId: string, peerId: string) => void>()
  const closeListeners = new Set<(roomId: string) => void>()
  let sendError: Error | null = null
  let sendErrorRoomId: string | null = null
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
      if (failedJoins.delete(roomId)) return Promise.reject(new Error(`Room "${roomId}" join failed`))
      if (joined.has(roomId)) return Promise.resolve()
      if (physicalReady) {
        joined.add(roomId)
        physicalJoinCalls.push(roomId)
        const members = [...(peersByRoom.get(roomId) ?? [])]
        queueMicrotask(() => {
          if (joined.has(roomId))
            members.forEach((peerId) => joinListeners.forEach((listener) => listener(roomId, peerId)))
        })
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
    peers: (roomId) => [...(peersByRoom.get(roomId) ?? [])],
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
      if (sendError && (!sendErrorRoomId || sendErrorRoomId === roomId)) throw sendError
      sent.push(attempt)
      if (sendGate && roomId === blockedSendRoomId) await sendGate
      const message = JSON.parse(payload) as TestWireMessage
      if (!('type' in message) || message.type !== MESSAGE_TYPE.HISTORY_MESSAGES_RESPONSE) return
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
        const members = [...(peersByRoom.get(roomId) ?? [])]
        queueMicrotask(() => {
          if (joined.has(roomId))
            members.forEach((peerId) => joinListeners.forEach((listener) => listener(roomId, peerId)))
        })
      })
    },
    makeNotReady: () => {
      physicalReady = false
    },
    failNextJoin: (roomId: string) => {
      failedJoins.add(roomId)
    },
    failSend: (error: Error | null, roomId?: string) => {
      sendError = error
      sendErrorRoomId = roomId ?? null
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
      // A wire message implies physical room membership without a fresh join announcement.
      const peers = peersByRoom.get(roomId) ?? new Set<string>()
      peers.add(sourcePeerId)
      peersByRoom.set(roomId, peers)
      messageListeners.forEach((listener) => listener(roomId, sourcePeerId, JSON.stringify(message)))
    },
    /** Plants a pre-existing room member without a fresh join announcement. */
    plantPeer: (roomId: string, peerId: string) => {
      const peers = peersByRoom.get(roomId) ?? new Set<string>()
      peers.add(peerId)
      peersByRoom.set(roomId, peers)
    },
    peerJoin: (roomId: string, peerId: string) => {
      if (!joined.has(roomId)) return
      const peers = peersByRoom.get(roomId) ?? new Set<string>()
      if (peers.has(peerId)) {
        peersByRoom.set(roomId, peers)
      } else {
        peers.add(peerId)
        peersByRoom.set(roomId, peers)
        joinListeners.forEach((listener) => listener(roomId, peerId))
      }
    },
    peerLeave: (roomId: string, peerId: string) => {
      peersByRoom.get(roomId)?.delete(peerId)
      leaveListeners.forEach((listener) => listener(roomId, peerId))
    },
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

/** Injects one current remote World peer so publication iterators have a distinct live target. */
const emitRemoteWorldPresence = (fake: ReturnType<typeof createFakeTransport>, sourcePeerId = 'remote-peer') => {
  fake.peerJoin(getWorldRoomId(), sourcePeerId)
  fake.receive(getWorldRoomId(), sourcePeerId, {
    sessionId: `remote-world-${sourcePeerId}`,
    user: REMOTE_USER,
    sites: [{ origin: 'https://remote.example', title: 'Remote' }]
  })
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

  it('projects the production page user shape to the wire identity before joining', async () => {
    const clock = new FakeClock()
    const fake = createFakeTransport()
    const server = createServer({ transport: fake.transport, clock, codec: jsonCodec })
    await server.attachPage({ domain: DOMAIN, pageId: 'page-a' })
    // Pre-existing room members become the initial publication's distinct targets.
    fake.plantPeer(getChatRoomId(DOMAIN), 'remote-peer')
    fake.plantPeer(getWorldRoomId(), 'remote-peer')

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
    // Pre-existing room members become the initial publication's distinct targets.
    fake.plantPeer(roomId, 'remote-peer')
    fake.plantPeer(worldRoomId, 'remote-peer')
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
    // Pre-existing room members become the initial publication's distinct targets.
    fake.plantPeer(roomId, 'remote-peer')
    fake.plantPeer(worldRoomId, 'remote-peer')
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
    // A pre-existing room member becomes the initial publication's distinct target.
    fake.plantPeer(roomId, 'remote-peer')
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
    // A pre-existing Chat member becomes the committed publication's distinct target.
    fake.plantPeer(roomId, 'remote-peer')
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
    fake.peerJoin(worldRoomId, 'remote-peer')
    await settle()
    expect(fake.messages(worldRoomId).filter(isWorldPresence).at(-1)).toEqual(
      expect.objectContaining({ user: refreshedUser })
    )
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
    // A live remote target turns the reconnect revision into one wire publication.
    emitRemoteWorldPresence(fake)
    await settle()
    fake.plantPeer(roomId, 'remote-peer')
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
    // Only the reconnect publication had a distinct Chat target; the cold join settled without members.
    expect(fake.messages(roomId).filter((message) => message.type === MESSAGE_TYPE.SESSION)).toHaveLength(1)
    const worldMessages = fake.messages(worldRoomId).filter(isWorldPresence)
    expect(worldMessages.length).toBeGreaterThanOrEqual(2)
    expect(worldMessages.at(-1)).toEqual(after.world.localPresence)
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
    // A live remote target makes each committed revision one wire publication.
    emitRemoteWorldPresence(fake)
    await settle()
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

  it('retries a failed Chat recovery at a bounded cadence until the room rejoins', async () => {
    const { fake, server, roomId } = await setup()
    const failures: string[] = []
    await server.onError({ pageId: 'page-a' }, (event) => failures.push(event.message))
    fake.failNextJoin(roomId)

    fake.roomClose(roomId)
    await settle()
    await vi.waitFor(() => expect(failures).toEqual([`Room "${roomId}" join failed`]))
    expect(fake.joined.has(roomId)).toBe(false)

    await vi.advanceTimersByTimeAsync(5000)
    await settle()

    expect(fake.joined.has(roomId)).toBe(true)
    expect((await server.getSnapshot()).domains[0]).toMatchObject({ chatRoomJoined: true })
    expect(failures).toHaveLength(1)
  })

  it('retries a failed World recovery at a bounded cadence until the room rejoins', async () => {
    const { fake, server } = await setup()
    const worldRoomId = getWorldRoomId()
    const failures: string[] = []
    await server.onError({ pageId: 'page-a' }, (event) => failures.push(event.message))
    fake.failNextJoin(worldRoomId)

    fake.roomClose(worldRoomId)
    await settle()
    await vi.waitFor(() => expect(failures).toEqual([`Room "${worldRoomId}" join failed`]))
    expect((await server.getSnapshot()).world.joined).toBe(false)

    await vi.advanceTimersByTimeAsync(5000)
    await settle()

    expect((await server.getSnapshot()).world.joined).toBe(true)
    expect(failures).toHaveLength(1)
  })

  it("routes a domain-scoped failure only to that domain's current pages", async () => {
    const { fake, server, roomId } = await setup()
    await server.attachPage({ domain: OTHER_DOMAIN, pageId: 'page-b' })
    await server.joinChatRoom({ domain: OTHER_DOMAIN, user: USER, site: { origin: OTHER_DOMAIN } })
    const failuresA: string[] = []
    const failuresB: string[] = []
    await server.onError({ pageId: 'page-a' }, (event) => failuresA.push(event.message))
    await server.onError({ pageId: 'page-b' }, (event) => failuresB.push(event.message))
    fake.failNextJoin(roomId)

    fake.roomClose(roomId)
    await settle()
    await vi.waitFor(() => expect(failuresA).toEqual([`Room "${roomId}" join failed`]))

    expect(failuresB).toEqual([])
  })

  it('keeps a Runtime failure diagnostic when no affected page is current', async () => {
    const { fake, server } = await setup()
    const worldRoomId = getWorldRoomId()
    const diagnostic = vi.spyOn(console, 'error').mockImplementation(() => {})
    await server.detachPage({ domain: DOMAIN, pageId: 'page-a' })
    fake.failNextJoin(worldRoomId)

    fake.roomClose(worldRoomId)
    await settle()
    await vi.waitFor(() =>
      expect(diagnostic).toHaveBeenCalledWith(
        '[WebChat] Runtime failure without a current affected page:',
        expect.objectContaining({ message: `Room "${worldRoomId}" join failed` })
      )
    )
    diagnostic.mockRestore()
  })
})

describe('RuntimeServer provisional recovery races', () => {
  it('catches up every World peer exactly once across iterator, pending, join, and discovery paths', async () => {
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
    // A pre-existing Chat member makes the session publication block on the wire gate, keeping the
    // staged World publication pending while a remote World member lands.
    fake.plantPeer(roomId, 'chat-peer')
    fake.hangSendsTo(roomId)
    const join = server.joinChatRoom({ domain: DOMAIN, user: USER, site: SITE })
    await fake.waitForDesiredRooms(2)

    fake.open()
    emitRemoteWorldPresence(fake, 'early-peer')
    await settle()
    await settle()
    fake.releaseSends()
    // Hold the World wire so the frozen iterator stays pending while another peer joins.
    fake.hangSendsTo(worldRoomId)
    await fake.waitForSendAttempt(worldRoomId)
    fake.peerJoin(worldRoomId, 'mid-peer')
    await settle()
    expect(sentToPeer(fake, worldRoomId, 'mid-peer')).toEqual([])

    fake.releaseSends()
    const snapshot = await join
    if (!snapshot) throw new Error('Join was cancelled')
    await settle()

    const currentPresence = snapshot.world.localPresence
    if (!currentPresence) throw new Error('Committed local presence missing')
    expect(sentToPeer(fake, worldRoomId, 'early-peer')).toEqual([currentPresence])
    expect(sentToPeer(fake, worldRoomId, 'mid-peer')).toEqual([currentPresence])
    expect(localSessions).toHaveLength(1)
    expect(localPresences).toHaveLength(1)

    fake.peerJoin(worldRoomId, 'late-peer')
    await settle()
    expect(sentToPeer(fake, worldRoomId, 'late-peer')).toEqual([currentPresence])

    emitRemoteWorldPresence(fake, 'discovered-peer')
    await settle()
    expect(sentToPeer(fake, worldRoomId, 'discovered-peer')).toEqual([currentPresence])
    expect(fake.messages(worldRoomId).filter(isWorldPresence)).toHaveLength(4)
  })

  it('discards peer catch-up owned by a superseded provisional join', async () => {
    const clock = new FakeClock()
    const fake = createFakeTransport({ physicalReady: false })
    const server = createServer({ transport: fake.transport, clock, codec: jsonCodec })
    const roomId = getChatRoomId(DOMAIN)
    const worldRoomId = getWorldRoomId()
    await server.attachPage({ domain: DOMAIN, pageId: 'page-a' })
    // Hold the first attempt's Chat session broadcast so the peer join lands inside its pending window.
    fake.plantPeer(roomId, 'chat-peer')
    fake.hangSendsTo(roomId)
    const firstJoin = server.joinChatRoom({ domain: DOMAIN, user: USER, site: SITE }).then(
      () => null,
      (error: Error) => error
    )
    await fake.waitForDesiredRooms(2)
    fake.open()
    await fake.waitForSendAttempt(roomId)

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
    // The superseded attempt never commits, so the peer can only receive the replacement identity.
    const staleChatSessions = sentToPeer(fake, roomId, 'stale-peer')
    expect(staleChatSessions.length).toBeGreaterThanOrEqual(0)
    staleChatSessions.forEach((message) => {
      expect(message).toEqual(expect.objectContaining({ user: expect.objectContaining({ name: 'Refreshed' }) }))
    })
    // The superseded attempt never commits, so the peer can only receive the replacement identity,
    // exactly once, as a current World Room target.
    expect(sentToPeer(fake, worldRoomId, 'stale-peer')).toEqual([
      expect.objectContaining({ user: expect.objectContaining({ name: 'Refreshed' }) })
    ])
  })

  it('keeps reconnect inbound sessions attempt-owned until replacement commit', async () => {
    const { fake, server, roomId } = await setup()
    const remoteSessions: string[] = []
    await observeRemoteSessions(server, { pageId: 'page-a' }, (event) => {
      remoteSessions.push(event.session.sourcePeerId)
    })
    // A current room member becomes the provisional publication's distinct target.
    fake.plantPeer(roomId, 'chat-peer')
    fake.makeNotReady()
    fake.hangSendsTo(roomId)
    const chatBroadcastStarted = fake.waitForSendAttempt(roomId)
    const reconnect = server.reconnectDomain({ domain: DOMAIN })
    await fake.waitForJoinCalls(4)
    fake.open()
    await expect(chatBroadcastStarted).resolves.toMatchObject({ roomId, to: ['chat-peer'] })

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
    // A current room member becomes the provisional publication's distinct target.
    fake.plantPeer(roomId, 'chat-peer')
    fake.makeNotReady()
    fake.hangSendsTo(roomId)
    const firstBroadcastStarted = fake.waitForSendAttempt(roomId)
    const firstReconnect = server.reconnectDomain({ domain: DOMAIN })
    await fake.waitForJoinCalls(4)
    fake.open()
    await expect(firstBroadcastStarted).resolves.toMatchObject({ roomId, to: ['chat-peer'] })

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

  it('catches up only peers that miss a provisional World recovery publication', async () => {
    const { fake, server } = await setup()
    const worldRoomId = getWorldRoomId()
    const currentPresence = (await server.getSnapshot()).world.localPresence
    if (!currentPresence) throw new Error('Committed local presence missing')
    // A known remote presence becomes the frozen recovery-iterator target.
    emitRemoteWorldPresence(fake)
    await settle()
    expect(sentToPeer(fake, worldRoomId, 'remote-peer')).toEqual([currentPresence])
    const localPresenceEvents: WorldPresenceEvent[] = []
    await server.onWorldPresence({ pageId: 'page-a' }, (event) => {
      if (event.sourcePeerId === fake.transport.peerId) localPresenceEvents.push(event)
    })
    fake.makeNotReady()

    fake.roomClose(worldRoomId)
    await fake.waitForJoinCalls(3)
    expect((await server.getSnapshot()).world.joined).toBe(false)
    fake.hangSendsTo(worldRoomId)
    fake.open()
    await fake.waitForSendAttempt(worldRoomId)
    fake.peerJoin(worldRoomId, 'missed-peer')
    await settle()

    expect((await server.getSnapshot()).world.joined).toBe(false)
    expect(sentToPeer(fake, worldRoomId, 'missed-peer')).toEqual([])
    expect(localPresenceEvents).toEqual([])

    fake.releaseSends()
    await settle()

    expect((await server.getSnapshot()).world.joined).toBe(true)
    // The frozen target was attempted exactly once more for the recovery revision, and the peer that
    // joined mid-publication receives exactly one catch-up at commit.
    expect(sentToPeer(fake, worldRoomId, 'remote-peer')).toEqual([currentPresence, currentPresence])
    expect(sentToPeer(fake, worldRoomId, 'missed-peer')).toEqual([currentPresence])
    expect(localPresenceEvents).toEqual([
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
    const legacyRequest = { type: 'history-request', requestId: 'legacy-sync' }
    const dualRequest = {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_REQUEST,
      syncId: 'current-sync',
      page: 0,
      messageIds: [],
      done: true,
      requestId: 'legacy'
    }
    const legacyResponse = {
      type: 'history-response',
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

    await server.ackInbound({ domain: DOMAIN, sequence: 2, inserted: false })
    await server.ackInbound({ domain: DOMAIN, sequence: 2, inserted: false })
    const replay = await server.replayInbound({ domain: DOMAIN, after: 0 })
    expect(replay.map((event) => event.record.message.id)).toEqual(['one'])

    await server.ackInbound({ domain: DOMAIN, sequence: 1, inserted: false })
    expect(await server.replayInbound({ domain: DOMAIN, after: 0 })).toEqual([])
  })
})

describe('RuntimeServer send reliability', () => {
  it('settles a send with no session target locally without a wire send', async () => {
    const { fake, server, roomId } = await setup()
    const record = await server.allocateTextMessage({ domain: DOMAIN, body: 'outbound', mentions: [] })

    await server.sendChatMessage({ domain: DOMAIN, event: record.message })

    // No current session peer means no distinct target, so the local send settles with zero wire sends.
    expect(fake.messages(roomId)).toHaveLength(0)
  })

  it('allocates id/HLC centrally and rejects an explicit single-target throw once surfaced', async () => {
    const { fake, server, roomId } = await setup()
    fake.receive(roomId, 'peer-a', session())
    await settle()
    const failures: string[] = []
    await server.onError({ pageId: 'page-a' }, (event) => failures.push(event.message))
    const record = await server.allocateTextMessage({ domain: DOMAIN, body: 'outbound', mentions: [] })

    await server.sendChatMessage({ domain: DOMAIN, event: record.message })
    await settle()
    expect(fake.messages(roomId).some((message) => message.type === MESSAGE_TYPE.TEXT)).toBe(true)
    expect(failures).toEqual([])

    fake.failSend(new Error('partial send'))
    // The single session target throw is a real failure: surfaced once and the send rejects.
    await expect(server.sendChatMessage({ domain: DOMAIN, event: record.message })).rejects.toThrow('partial send')
    await settle()
    expect(failures).toEqual(['partial send'])
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
    // A live remote target turns each committed revision into one per-target wire publication.
    emitRemoteWorldPresence(fake)
    await settle()

    await server.joinChatRoom({ domain: OTHER_DOMAIN, user: USER, site: { origin: OTHER_DOMAIN } })
    await settle()

    const localEvents = events.filter((event) => event.sourcePeerId === fake.transport.peerId)
    expect(localEvents).toHaveLength(1)
    expect(localEvents[0]?.presence?.sourcePeerId).toBe(fake.transport.peerId)
    expect(localEvents[0]?.presence?.presence.user).toEqual(USER)
    expect(Object.keys(localEvents[0]?.presence?.presence.user ?? {})).toEqual(['id', 'name', 'avatar'])
    expect(localEvents[0]?.presence?.presence.sites).toEqual([SITE, { origin: OTHER_DOMAIN }])

    const outgoing = fake.messages(getWorldRoomId()).filter(isWorldPresence)
    expect(outgoing).toHaveLength(2)
    expect(localEvents[0]?.presence?.presence).toEqual(outgoing.at(-1))
  })

  it('surfaces a World target failure and still settles the revision and join', async () => {
    const { fake, server } = await setup()
    const worldRoomId = getWorldRoomId()
    // A known remote target turns the second-domain revision into one per-target publication.
    emitRemoteWorldPresence(fake)
    await settle()
    const events: WorldPresenceEvent[] = []
    const failures: string[] = []
    await server.onWorldPresence({ pageId: 'page-a' }, (event) => events.push(event))
    await server.onError({ pageId: 'page-a' }, (event) => failures.push(event.message))
    await server.attachPage({ domain: OTHER_DOMAIN, pageId: 'page-b' })
    fake.failSend(new Error('world send failed'), worldRoomId)

    const snapshot = await server.joinChatRoom({ domain: OTHER_DOMAIN, user: USER, site: { origin: OTHER_DOMAIN } })
    await settle()
    if (!snapshot) throw new Error('Join was cancelled')

    expect(snapshot.domains.map((domain) => domain.domain)).toEqual([DOMAIN, OTHER_DOMAIN])
    expect(failures).toEqual(['world send failed'])
    const localEvents = events.filter((event) => event.sourcePeerId === fake.transport.peerId)
    expect(localEvents.at(-1)?.presence?.presence.sites).toEqual([SITE, { origin: OTHER_DOMAIN }])
  })

  it('publishes full privacy-bounded snapshots and atomically replaces/deletes remote presence', async () => {
    const { fake, server } = await setup()
    const worldRoomId = getWorldRoomId()
    // A live remote target turns each committed revision into one per-target wire publication.
    emitRemoteWorldPresence(fake)
    await settle()
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
  const createConvergenceFixture = (options: { failFirstPublication?: boolean } = {}) => {
    const attempts: Array<{ message: WorldRoomMessage; settle: ReturnType<typeof deferred<void>> }> = []
    const accepted: WorldRoomMessage[] = []
    const joinCalls: string[] = []
    const leave = vi.fn()
    let closeListener: ((roomId: string) => void) | null = null
    let joinGate: Promise<void> | null = null
    let releaseJoinGate = () => {}
    let primed = false
    const transport: RoomTransport = {
      peerId: 'local-peer',
      join: async (roomId) => {
        joinCalls.push(roomId)
        if (joinGate) await joinGate
      },
      leave,
      send: async (roomId, payload) => {
        if (roomId !== getWorldRoomId()) return
        const message = JSON.parse(payload) as WorldRoomMessage
        const settle = deferred<void>()
        attempts.push({ message, settle })
        if (options.failFirstPublication && attempts.length === 1) throw new Error('first World publication failed')
        await settle.promise
        accepted.push(message)
      },
      onMessage: () => () => {},
      peers: () => (primed ? ['remote-peer'] : []),
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
    const flush = async () => {
      for (let index = 0; index < 20; index += 1) await Promise.resolve()
    }
    const server = createServer({ transport, codec: jsonCodec, clock: new FakeClock() })
    return {
      server,
      attempts,
      accepted,
      joinCalls,
      leave,
      flush,
      closeWorld: () => closeListener?.(getWorldRoomId()),
      pauseJoins: () => {
        joinGate = new Promise<void>((resolve) => {
          releaseJoinGate = resolve
        })
      },
      releaseJoins: () => {
        releaseJoinGate()
        joinGate = null
      },
      /** Establishes one known remote World peer so each revision iterator has one distinct target. */
      primeTarget: async () => {
        primed = true
        await flush()
      }
    }
  }

  it('serializes concurrent registrations so the final accepted snapshot contains every successful domain', async () => {
    const fixture = createConvergenceFixture()
    const { server, attempts, accepted } = fixture
    const domainA = 'https://a.example'
    const domainB = 'https://b.example'
    await server.attachPage({ domain: domainA, pageId: 'page-a' })
    await server.attachPage({ domain: domainB, pageId: 'page-b' })

    fixture.pauseJoins()
    const joinA = server.joinChatRoom({ domain: domainA, user: USER, site: { origin: domainA, title: 'A' } })
    const joinB = server.joinChatRoom({ domain: domainB, user: USER, site: { origin: domainB, title: 'B' } })
    await vi.waitFor(() => expect(fixture.joinCalls).toContain(getWorldRoomId()))
    await fixture.primeTarget()
    fixture.releaseJoins()
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
    const fixture = createConvergenceFixture()
    const { server, attempts, accepted } = fixture
    const domainA = 'https://a.example'
    const domainB = 'https://b.example'
    await server.attachPage({ domain: domainA, pageId: 'page-a' })
    fixture.pauseJoins()
    const joinA = server.joinChatRoom({ domain: domainA, user: USER, site: { origin: domainA } })
    await vi.waitFor(() => expect(fixture.joinCalls).toContain(getWorldRoomId()))
    await fixture.primeTarget()
    fixture.releaseJoins()
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
    const fixture = createConvergenceFixture()
    const { server, attempts, accepted } = fixture
    const domainA = 'https://a.example'
    const domainB = 'https://b.example'
    const domainC = 'https://c.example'
    fixture.pauseJoins()
    let primed = false
    for (const [domain, pageId] of [
      [domainA, 'page-a'],
      [domainC, 'page-c']
    ] as const) {
      await server.attachPage({ domain, pageId })
      const join = server.joinChatRoom({ domain, user: USER, site: { origin: domain } })
      if (!primed) {
        primed = true
        await vi.waitFor(() => expect(fixture.joinCalls).toContain(getWorldRoomId()))
        await fixture.primeTarget()
        fixture.releaseJoins()
      }
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
    const fixture = createConvergenceFixture()
    const { server, attempts, accepted, joinCalls, closeWorld } = fixture
    const domainA = 'https://a.example'
    const domainB = 'https://b.example'
    await server.attachPage({ domain: domainA, pageId: 'page-a' })
    fixture.pauseJoins()
    const joinA = server.joinChatRoom({ domain: domainA, user: USER, site: { origin: domainA } })
    await vi.waitFor(() => expect(joinCalls).toContain(getWorldRoomId()))
    await fixture.primeTarget()
    fixture.releaseJoins()
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
    const fixture = createConvergenceFixture()
    const { server, attempts, accepted } = fixture
    const domainA = 'https://a.example'
    const domainB = 'https://b.example'
    await server.attachPage({ domain: domainA, pageId: 'page-a' })
    await server.attachPage({ domain: domainB, pageId: 'page-b' })
    fixture.pauseJoins()
    const joinAResult = server.joinChatRoom({ domain: domainA, user: USER, site: { origin: domainA } }).then(
      () => null,
      (error: Error) => error
    )
    await vi.waitFor(() => expect(fixture.joinCalls).toContain(getWorldRoomId()))
    await fixture.primeTarget()
    fixture.releaseJoins()
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

  it('settles a staged join when a superseded revision target rejects late', async () => {
    const fixture = createConvergenceFixture()
    const { server, attempts, accepted } = fixture
    const domainA = 'https://a.example'
    const domainB = 'https://b.example'
    await server.attachPage({ domain: domainA, pageId: 'page-a' })
    fixture.pauseJoins()
    const joinA = server.joinChatRoom({ domain: domainA, user: USER, site: { origin: domainA } })
    await vi.waitFor(() => expect(fixture.joinCalls).toContain(getWorldRoomId()))
    await fixture.primeTarget()
    fixture.releaseJoins()
    await vi.waitFor(() => expect(attempts).toHaveLength(1))
    attempts[0].settle.resolve()
    await joinA

    await server.attachPage({ domain: domainB, pageId: 'page-b' })
    const joinB = server.joinChatRoom({ domain: domainB, user: USER, site: { origin: domainB } })
    await vi.waitFor(() => expect(attempts).toHaveLength(2))
    await server.leaveChatRoom({ domain: domainA })
    // The B revision is superseded by the release revision; its late target rejection is discarded,
    // and the newest revision still settles the join.
    attempts[1].settle.reject(new Error('staged World publication failed'))
    await vi.waitFor(() => expect(attempts).toHaveLength(3))
    attempts[2].settle.resolve()
    const joinBSnapshot = await joinB
    if (!joinBSnapshot) throw new Error('Join was cancelled')

    expect(attempts[2].message.sites.map(({ origin }) => origin)).toEqual([domainB])
    expect(accepted.at(-1)?.sites.map(({ origin }) => origin)).toEqual([domainB])
    expect((await server.getSnapshot()).world.localPresence?.sites.map(({ origin }) => origin)).toEqual([domainB])
    disposeServer(server)
  })

  it('surfaces a failed publication target without removing the concurrent registration', async () => {
    const fixture = createConvergenceFixture({ failFirstPublication: true })
    const { server, attempts, accepted } = fixture
    const domainA = 'https://a.example'
    const domainB = 'https://b.example'
    await server.attachPage({ domain: domainA, pageId: 'page-a' })
    await server.attachPage({ domain: domainB, pageId: 'page-b' })
    const failures: string[] = []
    await server.onError({ pageId: 'page-a' }, (event) => failures.push(event.message))

    fixture.pauseJoins()
    const joinA = server.joinChatRoom({ domain: domainA, user: USER, site: { origin: domainA, title: 'A' } })
    const joinB = server.joinChatRoom({ domain: domainB, user: USER, site: { origin: domainB, title: 'B' } })
    await vi.waitFor(() => expect(fixture.joinCalls).toContain(getWorldRoomId()))
    await fixture.primeTarget()
    fixture.releaseJoins()
    // The first revision's only target throws synchronously; the iterator settles it and the joins continue.
    await vi.waitFor(() => expect(attempts).toHaveLength(2))
    attempts[1].settle.resolve()
    const [snapshotA] = await Promise.all([joinA, joinB])
    if (!snapshotA) throw new Error('Join was cancelled')

    expect(failures).toEqual(['first World publication failed'])
    expect(
      accepted
        .at(-1)
        ?.sites.map(({ origin }) => origin)
        .toSorted()
    ).toEqual([domainA, domainB])
    const snapshot = await server.getSnapshot()
    expect(snapshot.world.localPresence?.sites.map(({ origin }) => origin).toSorted()).toEqual([domainA, domainB])
    expect(snapshot.domains.map(({ domain, chatRoomJoined }) => ({ domain, chatRoomJoined }))).toEqual([
      { domain: domainA, chatRoomJoined: true },
      { domain: domainB, chatRoomJoined: true }
    ])
    disposeServer(server)
  })
})

describe('RuntimeServer history', () => {
  const request = (syncId: string, page: number, messageIds: string[], done: boolean) => ({
    type: MESSAGE_TYPE.HISTORY_MESSAGES_REQUEST,
    syncId,
    page,
    messageIds,
    done
  })
  const response = (syncId: string, page: number, messages: TextMessage[], done: boolean) => ({
    type: MESSAGE_TYPE.HISTORY_MESSAGES_RESPONSE,
    syncId,
    page,
    users: [...new Map(messages.map((m) => [m.userId, { id: m.userId, name: m.userId, avatar: '' }])).values()],
    messages,
    done
  })
  const pageOf = (messages: TextMessage[], done: boolean) => response('sync', 0, messages, done)

  const registerInventoryProvider = (server: RuntimeServer, records: TextMessageRecord[] = []) =>
    registerHistoryProvider(
      server,
      { domain: DOMAIN, pageId: 'page-a' },
      async (): Promise<HistorySupplyResult> => ({ records, done: true })
    )

  it('runs one exact-difference inventory -> missing-body sync through the real page boundary', async () => {
    const { fake, server, roomId } = await setup()
    await registerInventoryProvider(server)
    const delivered: string[] = []
    await server.onInbound({ pageId: 'page-a' }, (event) => {
      delivered.push(event.record.message.id)
    })
    fake.receive(roomId, 'peer-a', session())
    await settle()
    const requestMsg = fake.messages(roomId).find((m) => m.type === MESSAGE_TYPE.HISTORY_MESSAGES_REQUEST)
    const syncId = (requestMsg as { syncId: string }).syncId
    expect((requestMsg as { messageIds: string[] }).messageIds).toEqual([])
    expect((requestMsg as { done: boolean }).done).toBe(true)

    fake.receive(roomId, 'peer-a', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_RESPONSE,
      syncId,
      page: 0,
      users: [REMOTE_USER],
      messages: [text('history-a'), text('history-b', REMOTE_USER.id, NOW - 1)],
      done: true
    })
    await vi.waitFor(() => expect(delivered).toEqual(['history-a', 'history-b']))
  })

  it('publishes one attempt-owned loading Toast on first actual insert and dismisses at final page', async () => {
    const { fake, server, roomId } = await setup()
    await registerInventoryProvider(server)
    // The page persists each inbound History record and ACKs with the real insert result.
    await server.onInbound({ pageId: 'page-a' }, async (event) => {
      await server.ackInbound({ domain: event.domain, sequence: event.sequence, inserted: true })
    })
    const feedback: { kind: string; ownerId: string }[] = []
    await server.onHistoryFeedback({ pageId: 'page-a' }, (event) => {
      feedback.push(event)
    })
    fake.receive(roomId, 'peer-a', session())
    await settle()
    const requestMsg = fake.messages(roomId).find((m) => m.type === MESSAGE_TYPE.HISTORY_MESSAGES_REQUEST)
    const syncId = (requestMsg as { syncId: string }).syncId

    fake.receive(roomId, 'peer-a', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_RESPONSE,
      syncId,
      page: 0,
      users: [REMOTE_USER],
      messages: [text('history-a')],
      done: true
    })
    await vi.waitFor(() => expect(feedback.some((f) => f.kind === 'loading')).toBe(true))
    await vi.waitFor(() => expect(feedback.some((f) => f.kind === 'dismiss')).toBe(true))
    expect(feedback.filter((f) => f.kind === 'loading')).toHaveLength(1)
    expect(feedback.filter((f) => f.kind === 'dismiss')).toHaveLength(1)
    expect(new Set(feedback.map((f) => f.ownerId)).size).toBe(1)
  })

  it('stays silent when a response page is empty or every insert already exists', async () => {
    const { fake, server, roomId } = await setup()
    await registerInventoryProvider(server)
    const feedback: { kind: string }[] = []
    await server.onHistoryFeedback({ pageId: 'page-a' }, (event) => {
      feedback.push(event)
    })
    fake.receive(roomId, 'peer-a', session())
    await settle()
    const requestMsg = fake.messages(roomId).find((m) => m.type === MESSAGE_TYPE.HISTORY_MESSAGES_REQUEST)
    const syncId = (requestMsg as { syncId: string }).syncId

    fake.receive(roomId, 'peer-a', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_RESPONSE,
      syncId,
      page: 0,
      users: [],
      messages: [],
      done: true
    })
    await settle()
    expect(feedback).toEqual([])
  })

  it('provides only records absent from the complete inventory in recent-first order', async () => {
    const { fake, server, roomId } = await setup()
    const database = createMemoryMessageDatabase('history-provider-db')
    const store = createMessageStore(database)
    await store.insert(textRecord('local-1', NOW))
    await store.insert(textRecord('local-2', NOW - 1))
    await registerHistoryProvider(server, { domain: DOMAIN, pageId: 'page-a' }, async () => {
      const records = await store.query({ type: MESSAGE_RECORD_TYPE.CHAT_MESSAGE })
      return { records: records as TextMessageRecord[], done: true }
    })

    // Commit the remote session so the provider binding exists, then the requester sends inventory.
    fake.receive(roomId, 'peer-a', session())
    await settle()
    fake.receive(roomId, 'peer-a', request('sync-provider', 0, ['local-1'], true))
    await vi.waitFor(() => {
      const sent = fake.messages(roomId).filter((m) => m.type === MESSAGE_TYPE.HISTORY_MESSAGES_RESPONSE)
      expect(sent.length).toBeGreaterThan(0)
    })
    const sent = fake.messages(roomId).filter((m) => m.type === MESSAGE_TYPE.HISTORY_MESSAGES_RESPONSE)
    expect(sent[0]).toMatchObject({
      syncId: 'sync-provider',
      page: 0,
      done: true,
      messages: [{ id: 'local-2' }]
    })
    expect(sent[0].users).toHaveLength(1)
  })

  it('cancels the attempt on a page gap or out-of-order page', async () => {
    const { fake, server, roomId } = await setup()
    await registerInventoryProvider(server)
    fake.receive(roomId, 'peer-a', session())
    await settle()
    const requestMsg = fake.messages(roomId).find((m) => m.type === MESSAGE_TYPE.HISTORY_MESSAGES_REQUEST)
    const syncId = (requestMsg as { syncId: string }).syncId

    fake.receive(roomId, 'peer-a', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_RESPONSE,
      syncId,
      page: 5,
      users: [REMOTE_USER],
      messages: [text('gap')],
      done: true
    })
    await settle()
    // The requester cancels the attempt: no further request pages are sent.
    expect(fake.messages(roomId).filter((m) => m.type === MESSAGE_TYPE.HISTORY_MESSAGES_REQUEST)).toHaveLength(1)
  })

  it('rejects old history shapes and never falls back', async () => {
    const { fake, roomId } = await setup()
    fake.receive(roomId, 'peer-a', {
      type: 'history-request',
      syncId: 'old',
      before: { hlc: { timestamp: 1, counter: 0 }, id: 'x' }
    })
    fake.receive(roomId, 'peer-a', { type: 'history-response', syncId: 'old', users: [], messages: [], done: true })
    await settle()
    const types = fake.messages(roomId).map((m) => ('type' in m ? m.type : ''))
    expect(types).not.toContain('history-request')
    expect(types).not.toContain('history-response')
  })

  it('slices inventory pages by the encoded 64KiB frame cap, not the phase count', async () => {
    const { fake, server, roomId } = await setup()
    const manyIds = Array.from({ length: 10000 }, (_, index) => `id-${index.toString(36).padStart(6, '0')}`)
    const records = manyIds.map((id, index) => textRecord(id, NOW - index))
    await registerInventoryProvider(server, records)
    fake.receive(roomId, 'peer-a', session())
    await vi.waitFor(() => {
      const pages = fake.messages(roomId).filter((m) => m.type === MESSAGE_TYPE.HISTORY_MESSAGES_REQUEST)
      expect(pages.length).toBeGreaterThan(1)
    })
    const pages = fake.messages(roomId).filter((m) => m.type === MESSAGE_TYPE.HISTORY_MESSAGES_REQUEST)
    const pageSizes = pages.map((p) => new TextEncoder().encode(JSON.stringify(p)).byteLength)
    expect(Math.max(...pageSizes)).toBeLessThan(64 * 1024)
    expect(pages[pages.length - 1]).toMatchObject({ done: true })
    // The inventory id set is fully covered by the pages.
    const covered = pages.flatMap((p) => (p as { messageIds: string[] }).messageIds)
    expect(new Set(covered).size).toBe(manyIds.length)
  })

  it('rejects a cross-page recent-first violation atomically without applying a prefix', async () => {
    const { fake, server, roomId } = await setup()
    await registerInventoryProvider(server)
    const delivered: string[] = []
    await server.onInbound({ pageId: 'page-a' }, async (event) => {
      delivered.push(event.record.message.id)
      await server.ackInbound({ domain: event.domain, sequence: event.sequence, inserted: true })
    })
    fake.receive(roomId, 'peer-a', session())
    await settle()
    const requestMsg = fake.messages(roomId).find((m) => m.type === MESSAGE_TYPE.HISTORY_MESSAGES_REQUEST)
    const syncId = (requestMsg as { syncId: string }).syncId

    // Page 0 applies records older than page 1's newest: a cross-page ordering violation must cancel
    // the attempt instead of applying the violating prefix.
    fake.receive(roomId, 'peer-a', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_RESPONSE,
      syncId,
      page: 0,
      users: [REMOTE_USER],
      messages: [text('older-page-0', REMOTE_USER.id, NOW - 10)],
      done: false
    })
    await vi.waitFor(() => expect(delivered).toContain('older-page-0'))
    fake.receive(roomId, 'peer-a', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_RESPONSE,
      syncId,
      page: 1,
      users: [REMOTE_USER],
      messages: [text('newer-page-1', REMOTE_USER.id, NOW - 5)],
      done: true
    })
    await settle()
    // The violating page never applies.
    expect(delivered).not.toContain('newer-page-1')
  })

  it('queues a valid next response page while a batch is pending and cancels a changed replay', async () => {
    const { fake, server, roomId } = await setup()
    await registerInventoryProvider(server)
    const delivered: string[] = []
    const release = { write: null as null | (() => void) }
    await server.onInbound({ pageId: 'page-a' }, async (event) => {
      delivered.push(event.record.message.id)
      if (event.record.message.id === 'page-0-msg' && release.write) {
        await release.write
      }
      await server.ackInbound({ domain: event.domain, sequence: event.sequence, inserted: true })
    })
    fake.receive(roomId, 'peer-a', session())
    await settle()
    const requestMsg = fake.messages(roomId).find((m) => m.type === MESSAGE_TYPE.HISTORY_MESSAGES_REQUEST)
    const syncId = (requestMsg as { syncId: string }).syncId

    fake.receive(roomId, 'peer-a', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_RESPONSE,
      syncId,
      page: 0,
      users: [REMOTE_USER],
      messages: [text('page-0-msg', REMOTE_USER.id, NOW - 10)],
      done: false
    })
    await vi.waitFor(() => expect(delivered).toContain('page-0-msg'))
    // Page 1 arrives before page 0 settles: it joins the bounded serial queue.
    fake.receive(roomId, 'peer-a', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_RESPONSE,
      syncId,
      page: 1,
      users: [REMOTE_USER],
      messages: [text('page-1-msg', REMOTE_USER.id, NOW - 20)],
      done: true
    })
    await settle()
    // Changed replay of the accepted page while pending cancels the attempt.
    fake.receive(roomId, 'peer-a', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_RESPONSE,
      syncId,
      page: 0,
      users: [REMOTE_USER],
      messages: [text('changed-replay', REMOTE_USER.id, NOW - 30)],
      done: false
    })
    await settle()
    // The queued page 1 must still apply after page 0 settles (serial, not dropped).
    release.write?.()
    await vi.waitFor(() => expect(delivered).toContain('page-1-msg'))
  })

  it('preserves every provider record through the work list without a false terminal', async () => {
    const { fake, server, roomId } = await setup()
    const database = createMemoryMessageDatabase('history-preflight-db')
    const store = createMessageStore(database)
    await store.insert(textRecord('keep-1', NOW))
    await store.insert(textRecord('keep-2', NOW - 1))
    await registerHistoryProvider(server, { domain: DOMAIN, pageId: 'page-a' }, async () => {
      const records = await store.query({ type: MESSAGE_RECORD_TYPE.CHAT_MESSAGE })
      return { records: records as TextMessageRecord[], done: true }
    })
    fake.receive(roomId, 'peer-a', session())
    await settle()
    const requestMsg = fake.messages(roomId).find((m) => m.type === MESSAGE_TYPE.HISTORY_MESSAGES_REQUEST)
    const syncId = (requestMsg as { syncId: string }).syncId
    fake.receive(roomId, 'peer-a', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_REQUEST,
      syncId,
      page: 0,
      messageIds: [],
      done: true
    })
    await vi.waitFor(() => {
      const sent = fake.messages(roomId).filter((m) => m.type === MESSAGE_TYPE.HISTORY_MESSAGES_RESPONSE)
      expect(sent.length).toBeGreaterThan(0)
    })
    const sent = fake.messages(roomId).filter((m) => m.type === MESSAGE_TYPE.HISTORY_MESSAGES_RESPONSE)
    const ids = sent.flatMap((m) => (m as { messages: { id: string }[] }).messages.map((x) => x.id))
    expect(ids.sort()).toEqual(['keep-1', 'keep-2'])
    expect(sent.every((m) => (m as { messages: unknown[] }).messages.length > 0 || sent.length === 1)).toBe(true)
  })

  it('cancels the attempt when a single opaque inventory id cannot form a valid page', async () => {
    const { fake, server, roomId } = await setup()
    const hugeId = 'x'.repeat(70 * 1024)
    await registerInventoryProvider(server, [textRecord(hugeId, NOW)])
    fake.receive(roomId, 'peer-a', session())
    await settle()
    // No inventory request page is ever sent (the local attempt aborts before sending).
    expect(fake.messages(roomId).some((m) => m.type === MESSAGE_TYPE.HISTORY_MESSAGES_REQUEST)).toBe(false)
  })

  it('keeps one peer in two domains as independent attempts without suppression', async () => {
    const { fake, server, roomId } = await setup()
    await registerInventoryProvider(server)
    // The same source joins the first domain; its requester sends its own inventory request.
    fake.receive(roomId, 'peer-a', session())
    await vi.waitFor(() => {
      expect(fake.messages(roomId).some((m) => m.type === MESSAGE_TYPE.HISTORY_MESSAGES_REQUEST)).toBe(true)
    })
    // The same source joins a second domain: a second independent requester must start.
    const OTHER_DOMAIN_2 = 'https://other-2.example'
    await server.attachPage({ domain: OTHER_DOMAIN_2, pageId: 'page-b' })
    await server.joinChatRoom({ domain: OTHER_DOMAIN_2, user: USER, site: { ...SITE, origin: OTHER_DOMAIN_2 } })
    await registerHistoryProvider(
      server,
      { domain: OTHER_DOMAIN_2, pageId: 'page-b' },
      async (): Promise<HistorySupplyResult> => ({ records: [], done: true })
    )
    await settle()
    const otherRoomId = getChatRoomId(OTHER_DOMAIN_2)
    fake.receive(otherRoomId, 'peer-a', session())
    await vi.waitFor(() => {
      expect(fake.messages(otherRoomId).some((m) => m.type === MESSAGE_TYPE.HISTORY_MESSAGES_REQUEST)).toBe(true)
    })
    // Completing the first domain's requester must not finish the second domain's attempt.
    const firstSync = (
      fake.messages(roomId).find((m) => m.type === MESSAGE_TYPE.HISTORY_MESSAGES_REQUEST) as {
        syncId: string
      }
    ).syncId
    fake.receive(roomId, 'peer-a', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_RESPONSE,
      syncId: firstSync,
      page: 0,
      users: [],
      messages: [],
      done: true
    })
    await settle()
    expect(fake.messages(otherRoomId).some((m) => m.type === MESSAGE_TYPE.HISTORY_MESSAGES_REQUEST)).toBe(true)
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
    await server.onError({ pageId: 'page-a' }, (event) => errors.push(event.message))
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

    // The target-local miss is surfaced once with its original message and never retried.
    expect(result).toEqual({
      domains: [DOMAIN],
      laterDelta: 1,
      latestSites: [DOMAIN],
      errors: ['Connection is not established yet.']
    })
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
    await server.onError({ pageId: 'page-a' }, (event) => errors.push(event.message))
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
      errors: ['Connection is not established yet.']
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
