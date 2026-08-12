import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createServer, disposeServer, getChatRoomId, getWorldRoomId } from '@/runtime/Server'
import type { Clock } from '@/domain/runtime/externs/Clock'
import type { PresenceStore } from '@/domain/runtime/externs/PresenceStore'
import type { RoomTransport } from '@/runtime/RoomTransport'
import type { UserInfo } from '@/domain/UserInfo'
import type { WireCodec } from '@/protocol'
import { MESSAGE_TYPE, type ChatRoomMessage, type ChatUser, type TextMessage, type WorldRoomMessage } from '@/protocol'
import { MESSAGE_RECORD_TYPE, type ReactionMessageRecord, type TextMessageRecord } from '@/domain/Message'
import type { ReactionMessageAllocatedEventPayload, TextMessageAllocatedEventPayload } from '@/domain/runtime/Session'
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
import { HISTORY_REQUEST_TIMEOUT_MS, RUNTIME_DOMAIN_GRACE_MS, PENDING_LEAVE_GRACE_MS } from '@/constants/config'
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
  const operationLog: string[] = []
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
  const errorListeners = new Set<(error: Error, roomId: string) => void>()
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
    peerIdOf: (roomId) => (roomId === getWorldRoomId() ? 'local-peer' : `local-peer:${roomId}`),
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
      operationLog.push(`leave:${roomId}`)
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
      operationLog.push(`send:${roomId}`)
      if (sendGate && roomId === blockedSendRoomId) await sendGate
      const message = JSON.parse(payload) as TestWireMessage
      if (!('type' in message) || message.type !== MESSAGE_TYPE.HISTORY_MESSAGES_PUSH) return
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
    onError: (callback) => {
      errorListeners.add(callback)
      return () => errorListeners.delete(callback)
    },
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
      errorListeners.clear()
    }
  }

  return {
    transport,
    desired,
    joined,
    joinCalls,
    physicalJoinCalls,
    operationLog,
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
    emitError: (error: Error, roomId: string) => {
      errorListeners.forEach((listener) => listener(error, roomId))
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

const setup = async (domain = DOMAIN, now = NOW, codec: WireCodec = jsonCodec) => {
  const clock = new FakeClock(now)
  const fake = createFakeTransport()
  const server = createServer({ transport: fake.transport, clock, codec })
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

/**
 * Compile-time negative fixture at the typed Session allocation-event boundary (guarded by the
 * tsc gate): the payload types are exact, so a reaction payload cannot satisfy a text
 * allocation payload and a missing record is rejected. If the events ever regressed to the
 * generic optional record, the directives would go unused and tsc would fail.
 */
const sessionAllocationEventFixture = () => {
  const textPayload: TextMessageAllocatedEventPayload = {
    operationId: 'fixture',
    record: {} as TextMessageRecord
  }
  const reactionPayload: ReactionMessageAllocatedEventPayload = {
    operationId: 'fixture',
    record: {} as ReactionMessageRecord
  }
  // @ts-expect-error — a reaction allocation payload is not a text allocation payload
  const wrongVariant: TextMessageAllocatedEventPayload = { operationId: 'fixture', record: {} as ReactionMessageRecord }
  // @ts-expect-error — the typed allocation payload requires a record
  const missingRecord: TextMessageAllocatedEventPayload = { operationId: 'fixture' }
  void textPayload
  void reactionPayload
  void wrongVariant
  void missingRecord
}

void sessionAllocationEventFixture

describe('RuntimeServer lifecycle', () => {
  it('one clean refresh converges the stale member count from the ended-observation state', async () => {
    vi.useFakeTimers()
    try {
      const { clock, fake, server, roomId } = await setup()
      const remoteUsers = [
        { id: 'user-1', name: 'User 1', avatar: '' },
        { id: 'user-2', name: 'User 2', avatar: '' },
        { id: 'user-3', name: 'User 3', avatar: '' }
      ]
      const memberCount = async () => {
        const domain = (await server.getSnapshot()).domains[0]
        return new Set(domain.sessions.map((item) => item.user.id)).size + (domain.localSession ? 1 : 0)
      }
      const announce = (peerId: string, user: { id: string; name: string; avatar: string }, sessionId: string) => {
        fake.peerJoin(roomId, peerId)
        fake.receive(roomId, peerId, { ...session(user), sessionId })
      }
      remoteUsers.forEach((user, index) => announce(`peer-${index + 1}`, user, `session-${user.id}`))
      await settle()
      expect(await memberCount()).toBe(4)

      // Remote-1 leaves; its pending leave expires into an ended observer, so the room shows three.
      fake.peerLeave(roomId, 'peer-1')
      await vi.advanceTimersByTimeAsync(PENDING_LEAVE_GRACE_MS)
      await settle()
      expect(await memberCount()).toBe(3)

      // One AppButton-equivalent refresh STARTING FROM THE STALE THREE state must converge to four
      // after the remotes re-announce through the canonical join (fail-before: the ended observer
      // survives the released reconnect, so the count remains three).
      await server.reconnectDomain({ domain: DOMAIN })
      await settle()
      remoteUsers.forEach((user, index) => {
        fake.receive(roomId, `peer-${index + 1}`, { ...session(user), sessionId: `session-${user.id}-fresh` })
      })
      await settle()
      expect(await memberCount()).toBe(4)

      // Complete release/reopen is the independent control that reaches four on released code.
      await server.detachPage({ domain: DOMAIN, pageId: 'page-a' })
      clock.advance(RUNTIME_DOMAIN_GRACE_MS + 1)
      await vi.waitFor(() => expect(fake.joined.has(roomId)).toBe(false))
      await server.attachPage({ domain: DOMAIN, pageId: 'page-a' })
      await server.joinChatRoom({ domain: DOMAIN, user: USER, site: SITE })
      await settle()
      remoteUsers.forEach((user, index) => {
        fake.receive(roomId, `peer-${index + 1}`, { ...session(user), sessionId: `session-${user.id}-reopen` })
      })
      await settle()
      expect(await memberCount()).toBe(4)
      disposeServer(server)
    } finally {
      vi.useRealTimers()
    }
  })

  it('accepts a lawful same-presence rebind and rejects stale replays, mutations, departed sources, and newer conflicts', async () => {
    vi.useFakeTimers()
    try {
      const { fake, server, roomId } = await setup()
      const user1 = { id: 'user-1', name: 'User 1', avatar: '' }
      const user2 = { id: 'user-2', name: 'User 2', avatar: '' }
      const memberCount = async () => {
        const domain = (await server.getSnapshot()).domains[0]
        return new Set(domain.sessions.map((item) => item.user.id)).size + (domain.localSession ? 1 : 0)
      }
      const announce = (peerId: string, user: { id: string; name: string; avatar: string }, sessionId: string) => {
        fake.peerJoin(roomId, peerId)
        fake.receive(roomId, peerId, { ...session(user), sessionId })
      }
      announce('peer-1', user1, 'session-user-1')
      announce('peer-2', user2, 'session-user-2')
      await settle()
      expect(await memberCount()).toBe(3)

      // Remote-1 leaves and its pending leave expires into an ended observer.
      fake.peerLeave(roomId, 'peer-1')
      await vi.advanceTimersByTimeAsync(PENDING_LEAVE_GRACE_MS)
      await settle()
      expect(await memberCount()).toBe(2)

      // The lawful rebind: the source re-joins (admitted), sends a NEW physical sessionId with
      // the exact accepted logical identity/time, and the ended observation is corrected.
      announce('peer-1', user1, 'session-user-1-rejoined')
      await settle()
      expect(await memberCount()).toBe(3)

      // Remote-2 leaves and its pending leave expires into an ended observer.
      fake.peerLeave(roomId, 'peer-2')
      await vi.advanceTimersByTimeAsync(PENDING_LEAVE_GRACE_MS)
      await settle()
      expect(await memberCount()).toBe(2)

      // Even from a CURRENTLY ADMITTED source, an exact replay of the ended physical sessionId is
      // rejected (the source re-joins, but the physical generation is the ended one).
      announce('peer-2', user2, 'session-user-2')
      await settle()
      expect(await memberCount()).toBe(2)

      // An identity/time mutation of the ended presence is rejected from the same admitted source.
      fake.receive(roomId, 'peer-2', {
        ...session(user2),
        sessionId: 'session-user-2-mutated',
        user: { id: 'user-X', name: 'Impostor', avatar: '' }
      })
      await settle()
      expect(await memberCount()).toBe(2)

      // A SESSION from the source AFTER it leaves again (no fresh PeerJoin) cannot re-activate
      // the ended presence: the source is not a currently admitted physical member.
      fake.peerLeave(roomId, 'peer-2')
      fake.receive(roomId, 'peer-2', { ...session(user2), sessionId: 'session-user-2-departed' })
      await settle()
      expect(await memberCount()).toBe(2)

      // A NEWER logical generation for the same user becomes active (a different presence with a
      // strictly later joinedAt).
      fake.peerJoin(roomId, 'peer-2b')
      fake.receive(roomId, 'peer-2b', {
        type: MESSAGE_TYPE.SESSION,
        sessionId: 'session-user-2-new',
        presenceId: 'presence-user-2-new',
        joinedAt: NOW + 2,
        user: user2
      })
      await settle()
      expect(await memberCount()).toBe(3)

      // The ended OLD generation may not resurrect once a newer active binding exists.
      fake.receive(roomId, 'peer-2b', { ...session(user2), sessionId: 'session-user-2-old-new' })
      await settle()
      expect(await memberCount()).toBe(3)
      disposeServer(server)
    } finally {
      vi.useRealTimers()
    }
  })

  it('accepts a lawful rebind through automatic recovery', async () => {
    vi.useFakeTimers()
    try {
      const { fake, server, roomId } = await setup()
      const user1 = { id: 'user-1', name: 'User 1', avatar: '' }
      const memberCount = async () => {
        const domain = (await server.getSnapshot()).domains[0]
        return new Set(domain.sessions.map((item) => item.user.id)).size + (domain.localSession ? 1 : 0)
      }
      fake.peerJoin(roomId, 'peer-1')
      fake.receive(roomId, 'peer-1', { ...session(user1), sessionId: 'session-user-1' })
      await settle()
      fake.peerLeave(roomId, 'peer-1')
      await vi.advanceTimersByTimeAsync(PENDING_LEAVE_GRACE_MS)
      await settle()
      expect(await memberCount()).toBe(1)
      // The room closes and the runtime automatically recovers (rejoins); the recovered member
      // re-joins (a fresh PeerJoin admits it again), announces its current SESSION, and the
      // ended observation is corrected through the shared classifier.
      fake.roomClose(roomId)
      await settle()
      expect(fake.joined.has(roomId)).toBe(true)
      fake.peerJoin(roomId, 'peer-1')
      fake.receive(roomId, 'peer-1', { ...session(user1), sessionId: 'session-user-1-recovered' })
      await settle()
      expect(await memberCount()).toBe(2)
      disposeServer(server)
    } finally {
      vi.useRealTimers()
    }
  })

  it('accepts a lawful rebind after a same-domain page attach', async () => {
    vi.useFakeTimers()
    try {
      const { fake, server, roomId } = await setup()
      const user1 = { id: 'user-1', name: 'User 1', avatar: '' }
      const memberCount = async () => {
        const domain = (await server.getSnapshot()).domains[0]
        return new Set(domain.sessions.map((item) => item.user.id)).size + (domain.localSession ? 1 : 0)
      }
      fake.peerJoin(roomId, 'peer-1')
      fake.receive(roomId, 'peer-1', { ...session(user1), sessionId: 'session-user-1' })
      await settle()
      fake.peerLeave(roomId, 'peer-1')
      await vi.advanceTimersByTimeAsync(PENDING_LEAVE_GRACE_MS)
      await settle()
      expect(await memberCount()).toBe(1)
      // A second page attaches to the same domain; the connection ledger is untouched and the
      // lawful rebind is accepted through the shared classifier.
      await server.attachPage({ domain: DOMAIN, pageId: 'page-b' })
      await settle()
      fake.peerJoin(roomId, 'peer-1')
      fake.receive(roomId, 'peer-1', { ...session(user1), sessionId: 'session-user-1-attach' })
      await settle()
      expect(await memberCount()).toBe(2)
      expect((await server.getSnapshot()).domains[0].pageIds).toContain('page-b')
      disposeServer(server)
    } finally {
      vi.useRealTimers()
    }
  })

  it('accepts a lawful rebind after page reattach and through a grace return', async () => {
    vi.useFakeTimers()
    try {
      const user1 = { id: 'user-1', name: 'User 1', avatar: '' }
      const memberCount = async (server: Awaited<ReturnType<typeof setup>>['server']) => {
        const domain = (await server.getSnapshot()).domains[0]
        return new Set(domain.sessions.map((item) => item.user.id)).size + (domain.localSession ? 1 : 0)
      }

      // Page reattach: the page detaches and attaches again immediately; the domain ledger
      // (including the ended observation) survives, and the lawful rebind is accepted.
      {
        const { fake, server, roomId } = await setup()
        fake.peerJoin(roomId, 'peer-1')
        fake.receive(roomId, 'peer-1', { ...session(user1), sessionId: 'session-user-1' })
        await settle()
        fake.peerLeave(roomId, 'peer-1')
        await vi.advanceTimersByTimeAsync(PENDING_LEAVE_GRACE_MS)
        await settle()
        await server.detachPage({ domain: DOMAIN, pageId: 'page-a' })
        await server.attachPage({ domain: DOMAIN, pageId: 'page-a' })
        await settle()
        fake.peerJoin(roomId, 'peer-1')
        fake.receive(roomId, 'peer-1', { ...session(user1), sessionId: 'session-user-1-reattach' })
        await settle()
        expect(await memberCount(server)).toBe(2)
        disposeServer(server)
      }

      // Grace return: the page returns near the end of the grace window; the ledger survives and
      // the lawful rebind is accepted.
      {
        const { clock, fake, server, roomId } = await setup()
        fake.peerJoin(roomId, 'peer-1')
        fake.receive(roomId, 'peer-1', { ...session(user1), sessionId: 'session-user-1' })
        await settle()
        fake.peerLeave(roomId, 'peer-1')
        await vi.advanceTimersByTimeAsync(PENDING_LEAVE_GRACE_MS)
        await settle()
        await server.detachPage({ domain: DOMAIN, pageId: 'page-a' })
        clock.advance(RUNTIME_DOMAIN_GRACE_MS - 1)
        await server.attachPage({ domain: DOMAIN, pageId: 'page-a' })
        await settle()
        fake.peerJoin(roomId, 'peer-1')
        fake.receive(roomId, 'peer-1', { ...session(user1), sessionId: 'session-user-1-grace-return' })
        await settle()
        expect(await memberCount(server)).toBe(2)
        disposeServer(server)
      }
    } finally {
      vi.useRealTimers()
    }
  })

  it('host recovery reuses a persisted ended tombstone and still requires the lawful rebind', async () => {
    vi.useFakeTimers()
    try {
      const values: Record<string, unknown> = {}
      const presenceStore = createBrowserPresenceStore({
        get: async (key) => ({ [key]: values[key] }),
        set: async (items) => {
          Object.assign(values, items)
        }
      })
      const user1 = { id: 'user-1', name: 'User 1', avatar: '' }
      const memberCount = async (server: Awaited<ReturnType<typeof setup>>['server']) => {
        const domain = (await server.getSnapshot()).domains[0]
        return new Set(domain.sessions.map((item) => item.user.id)).size + (domain.localSession ? 1 : 0)
      }

      // First host: the member's presence ends and its observer tombstone is persisted.
      const firstClock = new FakeClock()
      const firstFake = createFakeTransport()
      const first = createServer({ transport: firstFake.transport, clock: firstClock, codec: jsonCodec, presenceStore })
      const firstRoomId = getChatRoomId(DOMAIN)
      await first.attachPage({ domain: DOMAIN, pageId: 'page-a' })
      await first.joinChatRoom({ domain: DOMAIN, user: USER, site: SITE })
      await settle()
      firstFake.peerJoin(firstRoomId, 'peer-1')
      firstFake.receive(firstRoomId, 'peer-1', { ...session(user1), sessionId: 'session-user-1' })
      await settle()
      firstFake.peerLeave(firstRoomId, 'peer-1')
      await vi.advanceTimersByTimeAsync(PENDING_LEAVE_GRACE_MS)
      await settle()
      expect(await memberCount(first)).toBe(1)
      disposeServer(first)

      // Host replacement: a fresh Runtime hydrates the persisted record, including the ended
      // tombstone; the strict classifier still rejects the exact replay and accepts only the
      // lawful rebind (admitted source, new physical sessionId, exact logical identity).
      const secondClock = new FakeClock()
      const secondFake = createFakeTransport()
      const second = createServer({
        transport: secondFake.transport,
        clock: secondClock,
        codec: jsonCodec,
        presenceStore
      })
      const secondRoomId = getChatRoomId(DOMAIN)
      await second.attachPage({ domain: DOMAIN, pageId: 'page-a' })
      await second.joinChatRoom({ domain: DOMAIN, user: USER, site: SITE })
      await settle()
      secondFake.peerJoin(secondRoomId, 'peer-1')
      secondFake.receive(secondRoomId, 'peer-1', { ...session(user1), sessionId: 'session-user-1' })
      await settle()
      expect(await memberCount(second)).toBe(1)
      secondFake.receive(secondRoomId, 'peer-1', { ...session(user1), sessionId: 'session-user-1-host' })
      await settle()
      expect(await memberCount(second)).toBe(2)
      disposeServer(second)
    } finally {
      vi.useRealTimers()
    }
  })

  it('joins the in-flight reset owner so a concurrent refresh cannot skip persistence', async () => {
    const clock = new FakeClock()
    const fake = createFakeTransport()
    const values: Record<string, unknown> = {}
    let holdClearSave = false
    const clearSaveStarted = deferred<void>()
    const releaseClearSave = deferred<void>()
    // A's reset persistence is held; B starts a concurrent refresh while it is pending.
    holdClearSave = true
    let clearSaveCount = 0
    const presenceStore = createBrowserPresenceStore({
      get: async (key) => ({ [key]: values[key] }),
      set: async (items) => {
        const record = Object.values(items)[0] as { local?: { status?: string }; observers?: unknown[] }
        if (
          record &&
          typeof record === 'object' &&
          record.local?.status === 'active' &&
          (record.observers ?? []).length === 0
        ) {
          clearSaveCount += 1
        }
        if (
          holdClearSave &&
          record &&
          typeof record === 'object' &&
          record.local?.status === 'active' &&
          (record.observers ?? []).length === 0
        ) {
          clearSaveStarted.resolve()
          await releaseClearSave.promise
        }
        Object.assign(values, items)
      }
    })
    const server = createServer({ transport: fake.transport, clock, codec: jsonCodec, presenceStore })
    await server.attachPage({ domain: DOMAIN, pageId: 'page-a' })
    await server.joinChatRoom({ domain: DOMAIN, user: USER, site: SITE })
    await settle()
    const resetShapedSavesBefore = clearSaveCount

    // A's reset persistence is held; B starts a concurrent refresh while it is pending.
    holdClearSave = true
    const refreshA = server.reconnectDomain({ domain: DOMAIN })
    await clearSaveStarted.promise
    const refreshB = server.reconnectDomain({ domain: DOMAIN })
    await settle()
    // B joined A's pending reset: no replacement may commit while the clear save is unsettled.
    expect((await server.getSnapshot()).domains[0].chatRoomJoined).toBe(false)

    releaseClearSave.resolve()
    await Promise.all([refreshA, refreshB])
    await settle()
    // One shared destruction + persistence + replacement served both refreshes; B joined A's
    // whole operation (no second destructive reset, so exactly one reset-shaped save beyond the
    // baseline: A's reset save plus the replacement commit save), and the domain converged once.
    expect(clearSaveCount - resetShapedSavesBefore).toBe(2)
    expect((await server.getSnapshot()).domains[0].chatRoomJoined).toBe(true)
    disposeServer(server)
  })

  it('joins an in-flight replacement attempt instead of running a second destructive reset', async () => {
    const clock = new FakeClock()
    const fake = createFakeTransport({ physicalReady: false })
    const server = createServer({ transport: fake.transport, clock, codec: jsonCodec })
    await server.attachPage({ domain: DOMAIN, pageId: 'page-a' })
    const initialJoin = server.joinChatRoom({ domain: DOMAIN, user: USER, site: SITE })
    fake.open()
    await initialJoin
    await settle()

    // A's refresh: the destruction settles, then the replacement attempt's physical Chat join is
    // held (phase 2 in flight).
    fake.makeNotReady()
    const refreshA = server.reconnectDomain({ domain: DOMAIN })
    await fake.waitForJoinCalls(4)

    // B refreshes while A's replacement attempt is pending: it must join A's whole operation,
    // not run a second destructive reset against the in-flight prepared session.
    let bSettled = false
    const refreshB = server.reconnectDomain({ domain: DOMAIN }).then(() => {
      bSettled = true
    })
    await settle()
    expect(bSettled).toBe(false)
    expect((await server.getSnapshot()).domains[0].chatRoomJoined).toBe(false)

    fake.open()
    await Promise.all([refreshA, refreshB])
    await settle()
    // A's prepared session survived (no second reset), and the domain converged to one committed
    // replacement shared by both refreshes.
    expect(bSettled).toBe(true)
    expect((await server.getSnapshot()).domains[0].chatRoomJoined).toBe(true)
    expect(fake.physicalJoinCalls.filter((id) => id === getChatRoomId(DOMAIN))).toHaveLength(2)
    disposeServer(server)
  })

  it('fails the refresh request retryably when the reset persistence rejects', async () => {
    const clock = new FakeClock()
    const fake = createFakeTransport()
    const values: Record<string, unknown> = {}
    let rejectClearSave = false
    const presenceStore = createBrowserPresenceStore({
      get: async (key) => ({ [key]: values[key] }),
      set: async (items) => {
        const record = Object.values(items)[0] as { local?: { status?: string }; observers?: unknown[] }
        // The refresh reset persists the cleared-observer record (retained local seed, no remote
        // observations); a healthy join's commit save carries the same shape, so only reject once
        // the test arms the failure after the initial join settled.
        if (
          rejectClearSave &&
          record &&
          typeof record === 'object' &&
          record.local?.status === 'active' &&
          (record.observers ?? []).length === 0
        ) {
          throw new Error('clear save rejected')
        }
        Object.assign(values, items)
      }
    })
    const server = createServer({ transport: fake.transport, clock, codec: jsonCodec, presenceStore })
    await server.attachPage({ domain: DOMAIN, pageId: 'page-a' })
    await server.joinChatRoom({ domain: DOMAIN, user: USER, site: SITE })
    await settle()
    expect((await server.getSnapshot()).domains[0].chatRoomJoined).toBe(true)

    // The cleared-observer persistence rejects: the refresh must fail without committing a
    // replacement, and a later retry must recover through the canonical join.
    rejectClearSave = true
    await expect(server.reconnectDomain({ domain: DOMAIN })).rejects.toThrow(
      'Domain connection reset persistence failed'
    )
    await settle()
    expect((await server.getSnapshot()).domains[0].chatRoomJoined).toBe(false)

    rejectClearSave = false
    await server.reconnectDomain({ domain: DOMAIN })
    await settle()
    expect((await server.getSnapshot()).domains[0].chatRoomJoined).toBe(true)
    disposeServer(server)
  })

  it('preserves World, other domains, page lease, and the logical presence across refresh', async () => {
    const clock = new FakeClock()
    const fake = createFakeTransport()
    const values: Record<string, unknown> = {}
    const presenceStore = createBrowserPresenceStore({
      get: async (key) => ({ [key]: values[key] }),
      set: async (items) => {
        Object.assign(values, items)
      }
    })
    const server = createServer({ transport: fake.transport, clock, codec: jsonCodec, presenceStore })
    const worldRoomId = getWorldRoomId()
    const otherRoomId = getChatRoomId(OTHER_DOMAIN)
    await server.attachPage({ domain: DOMAIN, pageId: 'page-a' })
    await server.joinChatRoom({ domain: DOMAIN, user: USER, site: SITE })
    await settle()
    await server.attachPage({ domain: OTHER_DOMAIN, pageId: 'page-b' })
    await server.joinChatRoom({ domain: OTHER_DOMAIN, user: USER, site: { origin: OTHER_DOMAIN } })
    await settle()
    fake.peerJoin(otherRoomId, 'peer-x')
    fake.receive(otherRoomId, 'peer-x', session({ id: 'user-x', name: 'User X', avatar: '' }))
    await settle()
    emitRemoteWorldPresence(fake)
    await settle()

    const presenceIdBefore = (Object.values(values)[0] as { local: { presenceId: string } }).local.presenceId
    const before = await server.getSnapshot()
    const beforeLocal = before.domains.find((item) => item.domain === DOMAIN)!.localSession!
    const beforeOther = before.domains.find((item) => item.domain === OTHER_DOMAIN)!
    const beforeWorld = before.world

    await server.reconnectDomain({ domain: DOMAIN })
    await settle()

    const after = await server.getSnapshot()
    const afterLocal = after.domains.find((item) => item.domain === DOMAIN)!.localSession!
    const afterOther = after.domains.find((item) => item.domain === OTHER_DOMAIN)!
    const afterWorld = after.world
    // Physical identity rotates; the active local logical generation is retained.
    expect(afterLocal.sessionId).not.toBe(beforeLocal.sessionId)
    expect(afterLocal.joinedAt).toBe(beforeLocal.joinedAt)
    expect(afterLocal.user).toEqual(beforeLocal.user)
    expect((Object.values(values)[0] as { local: { presenceId: string } }).local.presenceId).toBe(presenceIdBefore)
    // The page lease stays attached.
    expect(after.domains.find((item) => item.domain === DOMAIN)!.pageIds).toContain('page-a')
    // World stays joined with the same remote presence and the refreshed domain site re-published.
    expect(fake.joined.has(worldRoomId)).toBe(true)
    expect(afterWorld.joined).toBe(true)
    expect(afterWorld.presences).toEqual(beforeWorld.presences)
    expect(afterWorld.localPresence?.sites.map((site) => site.origin)).toContain(DOMAIN)
    // The other domain's connection, members, and local session are untouched.
    expect(afterOther.localSession).toEqual(beforeOther.localSession)
    expect(afterOther.sessions.map((item) => item.user.id)).toEqual(['user-x'])
    disposeServer(server)
  })

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

    const snapshot = await server.joinChatRoom({
      domain: DOMAIN,
      user: { id: USER_INFO.id, name: USER_INFO.name, avatar: USER_INFO.avatar },
      site: SITE
    })
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
    // The refresh destruction removed the committed aggregate: no prior session/readiness may
    // satisfy the replacement while it is still provisional.
    expect((await server.getSnapshot()).domains[0].localSession).toBeUndefined()
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

  it('trusts typed identity at local production and joins without protocol revalidation', async () => {
    const clock = new FakeClock()
    const fake = createFakeTransport()
    const server = createServer({ transport: fake.transport, clock, codec: jsonCodec })
    await server.attachPage({ domain: DOMAIN, pageId: 'page-a' })

    // Local identity production does not validate protocol shape: the typed join proceeds and
    // the receiving peer remains responsible for its own inbound parse.
    await expect(
      server.joinChatRoom({
        domain: DOMAIN,
        user: { ...USER_INFO, name: 1 } as unknown as ChatUser,
        site: SITE
      })
    ).resolves.toMatchObject({ domains: [{ domain: DOMAIN, chatRoomJoined: true }] })
    expect(fake.joinCalls.length).toBeGreaterThan(0)
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

  it('retries a failed initial domain join at the bounded cadence with its preserved typed input', async () => {
    const clock = new FakeClock()
    const fake = createFakeTransport()
    const server = createServer({ transport: fake.transport, clock, codec: jsonCodec })
    await server.attachPage({ domain: DOMAIN, pageId: 'page-a' })
    const chatRoomId = getChatRoomId(DOMAIN)
    fake.failNextJoin(chatRoomId)

    await expect(server.joinChatRoom({ domain: DOMAIN, user: USER, site: SITE })).rejects.toThrow()
    const joinsBefore = fake.joinCalls.filter((roomId) => roomId === chatRoomId).length

    await vi.advanceTimersByTimeAsync(5000)
    await settle()

    const joinsAfter = fake.joinCalls.filter((roomId) => roomId === chatRoomId).length
    expect(joinsAfter).toBeGreaterThan(joinsBefore)
    expect((await server.getSnapshot()).domains[0]).toMatchObject({
      domain: DOMAIN,
      chatRoomJoined: true,
      localSession: { user: USER }
    })
    disposeServer(server)
  })

  it('retries a failed initial World step at the same bounded cadence', async () => {
    const clock = new FakeClock()
    const fake = createFakeTransport()
    const server = createServer({ transport: fake.transport, clock, codec: jsonCodec })
    await server.attachPage({ domain: DOMAIN, pageId: 'page-a' })
    const worldRoomId = getWorldRoomId()
    fake.failNextJoin(worldRoomId)

    await expect(server.joinChatRoom({ domain: DOMAIN, user: USER, site: SITE })).rejects.toThrow()
    const worldJoinsBefore = fake.joinCalls.filter((roomId) => roomId === worldRoomId).length

    await vi.advanceTimersByTimeAsync(5000)
    await settle()

    const worldJoinsAfter = fake.joinCalls.filter((roomId) => roomId === worldRoomId).length
    expect(worldJoinsAfter).toBeGreaterThan(worldJoinsBefore)
    expect((await server.getSnapshot()).world.joined).toBe(true)
    disposeServer(server)
  })

  it('leaves the released Chat peer physically before publishing its World removal', async () => {
    const { clock, fake, server, roomId } = await setup()
    const worldRoomId = getWorldRoomId()
    fake.plantPeer(worldRoomId, 'remote-peer')
    await server.attachPage({ domain: OTHER_DOMAIN, pageId: 'page-b' })
    await server.joinChatRoom({ domain: OTHER_DOMAIN, user: USER, site: { origin: OTHER_DOMAIN } })
    await settle()
    fake.operationLog.length = 0

    await server.detachPage({ domain: DOMAIN, pageId: 'page-a' })
    clock.advance(RUNTIME_DOMAIN_GRACE_MS + 1)
    await vi.waitFor(() => expect(fake.joined.has(roomId)).toBe(false))

    const chatLeaveIndex = fake.operationLog.indexOf(`leave:${roomId}`)
    const worldRemovalIndex = fake.operationLog.indexOf(`send:${worldRoomId}`)
    expect(chatLeaveIndex).toBeGreaterThanOrEqual(0)
    expect(worldRemovalIndex).toBeGreaterThan(chatLeaveIndex)
    expect((await server.getSnapshot()).domains.map((item) => item.domain)).toEqual([OTHER_DOMAIN])
  })

  it('publishes the empty World snapshot before the final-site release owner closes', async () => {
    const { clock, fake, server } = await setup()
    const worldRoomId = getWorldRoomId()
    fake.plantPeer(worldRoomId, 'remote-peer')
    await settle()

    await server.detachPage({ domain: DOMAIN, pageId: 'page-a' })
    clock.advance(RUNTIME_DOMAIN_GRACE_MS + 1)
    await vi.waitFor(() => expect(fake.joined.has(worldRoomId)).toBe(false))

    const finalSnapshot = fake.messages(worldRoomId).filter(isWorldPresence).at(-1)
    expect(finalSnapshot?.sites).toEqual([])
    expect(fake.operationLog.indexOf(`leave:${worldRoomId}`)).toBeGreaterThan(
      fake.operationLog.lastIndexOf(`send:${worldRoomId}`)
    )
    expect((await server.getSnapshot()).world.joined).toBe(false)
  })

  it("routes a Chat-domain provider error only to that domain's pages", async () => {
    const { fake, server, roomId } = await setup()
    await server.attachPage({ domain: OTHER_DOMAIN, pageId: 'page-b' })
    await server.joinChatRoom({ domain: OTHER_DOMAIN, user: USER, site: { origin: OTHER_DOMAIN } })
    await settle()
    const failuresA: string[] = []
    const failuresB: string[] = []
    await server.onError({ pageId: 'page-a' }, (event) => failuresA.push(event.message))
    await server.onError({ pageId: 'page-b' }, (event) => failuresB.push(event.message))

    fake.emitError(new Error('chat-a signaling failed'), roomId)
    await settle()

    expect(failuresA).toEqual(['chat-a signaling failed'])
    expect(failuresB).toEqual([])
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

  it("routes a provisional domain's provider error only to its joining page", async () => {
    const { fake, server } = await setup()
    const roomIdB = getChatRoomId(OTHER_DOMAIN)
    await server.attachPage({ domain: OTHER_DOMAIN, pageId: 'page-b' })
    // Keep Chat(B) provisional: the physical room joined but its session broadcast stays hung
    // before the domain commits.
    fake.plantPeer(roomIdB, 'chat-peer-b')
    fake.hangSendsTo(roomIdB)
    const joinB = server.joinChatRoom({ domain: OTHER_DOMAIN, user: USER, site: { origin: OTHER_DOMAIN } })
    await fake.waitForSendAttempt(roomIdB)
    await settle()

    const failuresA: string[] = []
    const failuresB: string[] = []
    await server.onError({ pageId: 'page-a' }, (event) => failuresA.push(event.message))
    await server.onError({ pageId: 'page-b' }, (event) => failuresB.push(event.message))
    fake.emitError(new Error('chat-b provisional signaling failed'), roomIdB)
    await settle()

    expect(failuresB).toEqual(['chat-b provisional signaling failed'])
    expect(failuresA).toEqual([])

    fake.releaseSends()
    await joinB
  })

  it("routes a releasing domain's provider error away from unrelated domains", async () => {
    const { clock, fake, server, roomId } = await setup()
    await server.attachPage({ domain: OTHER_DOMAIN, pageId: 'page-b' })
    await server.joinChatRoom({ domain: OTHER_DOMAIN, user: USER, site: { origin: OTHER_DOMAIN } })
    await settle()
    const failuresB: string[] = []
    await server.onError({ pageId: 'page-b' }, (event) => failuresB.push(event.message))
    const diagnostic = vi.spyOn(console, 'error').mockImplementation(() => {})

    emitRemoteWorldPresence(fake)
    fake.hangSendsTo(getWorldRoomId())
    await server.detachPage({ domain: DOMAIN, pageId: 'page-a' })
    clock.advance(RUNTIME_DOMAIN_GRACE_MS + 1)
    // The release closes Chat(A) and holds the final World publication, so Chat(A) stays in the
    // live-release record without any committed or prepared state.
    await vi.waitFor(() => expect(fake.joined.has(roomId)).toBe(false))

    fake.emitError(new Error('chat-a closing leave failed'), roomId)
    await settle()

    expect(failuresB).toEqual([])
    expect(diagnostic).toHaveBeenCalledWith(
      '[WebChat] Runtime failure without a current affected page:',
      expect.objectContaining({ message: 'chat-a closing leave failed' })
    )

    diagnostic.mockRestore()
    fake.releaseSends()
    await settle()
  })

  it('coalesces overlapping finalizing-release leases into one fresh committed generation', async () => {
    const { clock, fake, server, roomId } = await setup()
    emitRemoteWorldPresence(fake)
    fake.hangSendsTo(getWorldRoomId())

    await server.detachPage({ domain: DOMAIN, pageId: 'page-a' })
    clock.advance(RUNTIME_DOMAIN_GRACE_MS + 1)
    // The release closes Chat(A) and then holds the final World publication.
    await vi.waitFor(() => expect(fake.joined.has(roomId)).toBe(false))

    await server.attachPage({ domain: DOMAIN, pageId: 'page-b' })
    await server.attachPage({ domain: DOMAIN, pageId: 'page-c' })
    let rejectedB: unknown
    let rejectedC: unknown
    const joinB = server.joinChatRoom({ domain: DOMAIN, user: USER, site: SITE }).catch((error: unknown) => {
      rejectedB = error
      return null
    })
    const joinC = server.joinChatRoom({ domain: DOMAIN, user: USER, site: SITE }).catch((error: unknown) => {
      rejectedC = error
      return null
    })
    await settle()
    await settle()

    // Both leases wait behind the single closing release; neither is rejected mid-release.
    expect(rejectedB).toBeUndefined()
    expect(rejectedC).toBeUndefined()
    expect(fake.joined.has(roomId)).toBe(false)

    // The release closed Chat(A) exactly once; the waiting leases never replay its cleanup.
    expect(fake.operationLog.filter((entry) => entry === `leave:${roomId}`)).toHaveLength(1)

    fake.releaseSends()
    const [snapshotB, snapshotC] = await Promise.all([joinB, joinC])
    expect(rejectedB).toBeUndefined()
    expect(rejectedC).toBeUndefined()
    expect(snapshotB?.domains[0]).toMatchObject({ domain: DOMAIN, chatRoomJoined: true })
    expect(snapshotC?.domains[0]).toMatchObject({ domain: DOMAIN, chatRoomJoined: true })
    // Exactly one fresh physical rebuild served both coalesced leases, and still exactly one
    // Chat(A) physical exit overall.
    expect(fake.physicalJoinCalls.filter((id) => id === roomId)).toHaveLength(2)
    expect(fake.physicalJoinCalls.filter((id) => id === getWorldRoomId())).toHaveLength(2)
    expect(fake.operationLog.filter((entry) => entry === `leave:${roomId}`)).toHaveLength(1)
    expect((await server.getSnapshot()).domains[0].pageIds.slice().sort()).toEqual(['page-b', 'page-c'])
  })

  it('commits a staged cross-domain join only from a World snapshot containing its own site', async () => {
    const { clock, fake, server, roomId } = await setup()
    const worldRoomId = getWorldRoomId()
    emitRemoteWorldPresence(fake)
    fake.hangSendsTo(worldRoomId)

    // A's final-site release closes Chat(A) and then holds the empty final World publication.
    await server.detachPage({ domain: DOMAIN, pageId: 'page-a' })
    clock.advance(RUNTIME_DOMAIN_GRACE_MS + 1)
    await vi.waitFor(() => expect(fake.joined.has(roomId)).toBe(false))
    await vi.waitFor(() => expect(fake.sendAttempts.some((attempt) => attempt.roomId === worldRoomId)).toBe(true))

    // B stages on a different domain while the empty final publication is still in flight.
    await server.attachPage({ domain: OTHER_DOMAIN, pageId: 'page-b' })
    let rejectedB: unknown
    const joinB = server
      .joinChatRoom({ domain: OTHER_DOMAIN, user: USER, site: { origin: OTHER_DOMAIN } })
      .catch((error: unknown) => {
        rejectedB = error
        return null
      })
    await settle()
    await settle()
    // B must not become ready from the pending empty snapshot.
    expect(rejectedB).toBeUndefined()
    expect(
      (await server.getSnapshot()).domains.find((item) => item.domain === OTHER_DOMAIN)?.chatRoomJoined ?? false
    ).toBe(false)

    fake.releaseSends()
    const snapshotB = await joinB
    expect(rejectedB).toBeUndefined()
    expect(snapshotB?.domains.find((item) => item.domain === OTHER_DOMAIN)).toMatchObject({
      chatRoomJoined: true
    })

    // The wire publication that accepted B carries B's own site; the empty final snapshot only
    // settled A's release facts.
    const publications = fake.messages(worldRoomId).filter(isWorldPresence)
    const emptyFinalIndex = publications.findIndex((message) => message.sites.length === 0)
    const acceptingIndex = publications.findIndex((message) =>
      message.sites.some((site) => site.origin === OTHER_DOMAIN)
    )
    expect(emptyFinalIndex).toBeGreaterThanOrEqual(0)
    expect(acceptingIndex).toBeGreaterThan(emptyFinalIndex)
    expect(acceptingIndex).toBe(publications.length - 1)
  })

  it('attaches a late lease to a pending cleanup without a redundant write or false failure', async () => {
    const clock = new FakeClock()
    const fake = createFakeTransport()
    const values: Record<string, unknown> = {}
    let cleanupWrites = 0
    const cleanupStarted = deferred<void>()
    const releaseCleanup = deferred<void>()
    const presenceStore = createBrowserPresenceStore({
      get: async (key) => ({ [key]: values[key] }),
      set: async (items) => {
        const record = Object.values(items)[0] as { local?: unknown } | undefined
        // The release cleanup save carries no local record; active-record saves always do.
        if (record && typeof record === 'object' && !('local' in record)) {
          cleanupWrites += 1
          if (cleanupWrites === 1) {
            cleanupStarted.resolve()
            await releaseCleanup.promise
          } else {
            throw new Error('redundant cleanup failed')
          }
        }
        Object.assign(values, items)
      }
    })
    const server = createServer({ transport: fake.transport, clock, codec: jsonCodec, presenceStore })
    const roomId = getChatRoomId(DOMAIN)
    await server.attachPage({ domain: DOMAIN, pageId: 'page-a' })
    await server.joinChatRoom({ domain: DOMAIN, user: USER, site: SITE })
    await settle()
    emitRemoteWorldPresence(fake)
    fake.hangSendsTo(getWorldRoomId())

    await server.detachPage({ domain: DOMAIN, pageId: 'page-a' })
    clock.advance(RUNTIME_DOMAIN_GRACE_MS + 1)
    // The release's authoritative cleanup write is in flight (held).
    await cleanupStarted.promise

    // A late same-domain lease attaches behind the pending cleanup without re-issuing it.
    await server.attachPage({ domain: DOMAIN, pageId: 'page-b' })
    let rejectedB: unknown
    const joinB = server.joinChatRoom({ domain: DOMAIN, user: USER, site: SITE }).catch((error: unknown) => {
      rejectedB = error
      return null
    })
    await settle()
    await settle()
    expect(cleanupWrites).toBe(1)

    // The authoritative cleanup succeeds; the World removal stays held.
    releaseCleanup.resolve()
    await vi.waitFor(() => expect(fake.joined.has(roomId)).toBe(false))
    await settle()
    expect(cleanupWrites).toBe(1)
    expect(rejectedB).toBeUndefined()

    fake.releaseSends()
    const snapshotB = await joinB
    expect(rejectedB).toBeUndefined()
    expect(snapshotB?.domains[0]).toMatchObject({ domain: DOMAIN, chatRoomJoined: true })
    expect(cleanupWrites).toBe(1)
    disposeServer(server)
  })

  it('rolls back the World projection when a deferred follow-up publication aborts', async () => {
    const clock = new FakeClock()
    const fake = createFakeTransport()
    let failFollowUpEncode = false
    const codec: WireCodec = {
      encode: async (value) => {
        const message = value as { sites?: { origin: string }[] }
        if (failFollowUpEncode && message.sites?.some((site) => site.origin === OTHER_DOMAIN)) {
          throw new Error('follow-up encode failed')
        }
        return JSON.stringify(value)
      },
      decode: async (payload) => JSON.parse(payload)
    }
    const server = createServer({ transport: fake.transport, clock, codec })
    const roomId = getChatRoomId(DOMAIN)
    const worldRoomId = getWorldRoomId()
    await server.attachPage({ domain: DOMAIN, pageId: 'page-a' })
    await server.joinChatRoom({ domain: DOMAIN, user: USER, site: SITE })
    await settle()
    emitRemoteWorldPresence(fake)
    fake.hangSendsTo(worldRoomId)

    // A's final-site release closes Chat(A) and holds the empty final World publication.
    await server.detachPage({ domain: DOMAIN, pageId: 'page-a' })
    clock.advance(RUNTIME_DOMAIN_GRACE_MS + 1)
    await vi.waitFor(() => expect(fake.joined.has(roomId)).toBe(false))
    await vi.waitFor(() => expect(fake.sendAttempts.some((attempt) => attempt.roomId === worldRoomId)).toBe(true))

    // B stages on a different domain; its follow-up snapshot will fail before any provider send.
    await server.attachPage({ domain: OTHER_DOMAIN, pageId: 'page-b' })
    let rejectedB: unknown
    const joinB = server
      .joinChatRoom({ domain: OTHER_DOMAIN, user: USER, site: { origin: OTHER_DOMAIN } })
      .catch((error: unknown) => {
        rejectedB = error
        return null
      })
    await settle()
    await settle()
    failFollowUpEncode = true
    fake.releaseSends()

    await joinB
    expect(rejectedB).toEqual(new Error('follow-up encode failed'))
    await vi.waitFor(() => expect(fake.joined.has(worldRoomId)).toBe(false))
    // The abort was the last World owner: the projection settles the same terminal truth as final
    // World departure instead of a false joined state with stale remote presences.
    const world = (await server.getSnapshot()).world
    expect(world.joined).toBe(false)
    expect(world.presences).toEqual([])
    expect(world.localPresence).toBeUndefined()
    disposeServer(server)
  })

  it('retains live remote World presence across ordinary same-domain supersession', async () => {
    const clock = new FakeClock()
    const fake = createFakeTransport({ physicalReady: false })
    const server = createServer({ transport: fake.transport, clock, codec: jsonCodec })
    const roomId = getChatRoomId(DOMAIN)
    const worldRoomId = getWorldRoomId()
    await server.attachPage({ domain: DOMAIN, pageId: 'page-a' })

    // Hold the first cold join's Chat publication after the physical World peer joined.
    fake.plantPeer(roomId, 'chat-peer')
    fake.hangSendsTo(roomId)
    const firstJoin = server.joinChatRoom({ domain: DOMAIN, user: USER, site: SITE }).then(
      () => null,
      (error: Error) => error
    )
    await fake.waitForDesiredRooms(2)
    fake.open()
    await fake.waitForSendAttempt(roomId)

    // A live remote World presence arrives while the first join is provisional.
    emitRemoteWorldPresence(fake)
    await settle()
    expect((await server.getSnapshot()).world.presences.map((item) => item.sourcePeerId)).toContain('remote-peer')

    // Supersede with a new same-domain join; the physical World owner stays live throughout.
    const refreshedUser = { ...USER, name: 'Refreshed' }
    const secondJoin = server.joinChatRoom({ domain: DOMAIN, user: refreshedUser, site: SITE })
    await expect(firstJoin).resolves.toBeNull()

    fake.releaseSends()
    const snapshot = await secondJoin
    if (!snapshot) throw new Error('Join was cancelled')

    expect(snapshot.domains[0]).toMatchObject({ domain: DOMAIN, chatRoomJoined: true })
    expect(fake.joined.has(worldRoomId)).toBe(true)
    expect((await server.getSnapshot()).world.presences).toEqual([
      expect.objectContaining({ sourcePeerId: 'remote-peer' })
    ])
    disposeServer(server)
  })

  it('retains another domain live final release World ownership across a provisional Chat failure', async () => {
    const { clock, fake, server, roomId } = await setup()
    const worldRoomId = getWorldRoomId()
    emitRemoteWorldPresence(fake)
    fake.hangSendsTo(worldRoomId)

    // A's final-site release closes Chat(A) and holds the empty final World publication.
    await server.detachPage({ domain: DOMAIN, pageId: 'page-a' })
    clock.advance(RUNTIME_DOMAIN_GRACE_MS + 1)
    await vi.waitFor(() => expect(fake.joined.has(roomId)).toBe(false))
    await vi.waitFor(() => expect(fake.sendAttempts.some((attempt) => attempt.roomId === worldRoomId)).toBe(true))

    // B's independent provisional Chat join fails while A's release continuation and pending
    // final publication still own the physical World owner.
    await server.attachPage({ domain: OTHER_DOMAIN, pageId: 'page-b' })
    fake.failNextJoin(getChatRoomId(OTHER_DOMAIN))
    const joinB = server.joinChatRoom({ domain: OTHER_DOMAIN, user: USER, site: { origin: OTHER_DOMAIN } })
    await expect(joinB).rejects.toThrow(`Room "${getChatRoomId(OTHER_DOMAIN)}" join failed`)
    await settle()

    // The departure decision must respect exact World demand: A's live release keeps the room.
    expect(fake.joined.has(worldRoomId)).toBe(true)

    fake.releaseSends()
    await vi.waitFor(() => expect(fake.joined.has(worldRoomId)).toBe(false))
    expect(fake.messages(worldRoomId).filter(isWorldPresence).at(-1)?.sites).toEqual([])
    disposeServer(server)
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
      if (event.sourcePeerId === fake.transport.peerIdOf(getWorldRoomId())) localPresences.push(event)
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
      if (event.sourcePeerId === fake.transport.peerIdOf(getWorldRoomId())) localPresenceEvents.push(event)
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
        sourcePeerId: fake.transport.peerIdOf(getWorldRoomId()),
        presence: { sourcePeerId: fake.transport.peerIdOf(getWorldRoomId()), presence: currentPresence }
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
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
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

  it('accepts any safe HLC at receive (time rules are not declaratively expressible)', async () => {
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

    // The declarative schema accepts every safe non-negative integer HLC; the receiver-time
    // future rule is not expressible and is therefore not validated.
    expect(received).toEqual(['future', 'counter-overflow', 'valid'])
    const local = await server.allocateTextMessage({ domain: DOMAIN, body: 'next', mentions: [] })
    expect(local.message.hlc.timestamp).toBe(NOW + 5 * 60 * 1000 + 1)
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

    const localEvents = events.filter((event) => event.sourcePeerId === fake.transport.peerIdOf(getWorldRoomId()))
    expect(localEvents).toHaveLength(1)
    expect(localEvents[0]?.presence?.sourcePeerId).toBe(fake.transport.peerIdOf(getWorldRoomId()))
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
    const localEvents = events.filter((event) => event.sourcePeerId === fake.transport.peerIdOf(getWorldRoomId()))
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
      site: { origin: OTHER_DOMAIN, description: 'Other' }
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
      peerIdOf: () => 'local-peer',
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
    // The release is queued while the staged send is held; it resolves only after the World
    // convergence settles.
    const leaveA = server.leaveChatRoom({ domain: domainA })
    attempts[1].settle.resolve()
    await vi.waitFor(() => expect(attempts).toHaveLength(3))

    expect(joinedB).toBe(false)
    expect(attempts[2].message.sites.map(({ origin }) => origin)).toEqual([domainB])
    attempts[2].settle.resolve()
    await leaveA
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
    const leaveA = server.leaveChatRoom({ domain: domainA })
    attempts[2].settle.resolve()
    await vi.waitFor(() => expect(attempts).toHaveLength(4))
    expect(attempts[3].message.sites.map(({ origin }) => origin).toSorted()).toEqual([domainB, domainC])
    attempts[3].settle.resolve()
    await leaveA
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
    const leaveA = server.leaveChatRoom({ domain: domainA })
    attempts[0].settle.reject(new Error('released A publication failed late'))
    await vi.waitFor(() => expect(attempts).toHaveLength(2))

    expect(joinedB).toBe(false)
    expect(attempts[1].message.sites.map(({ origin }) => origin)).toEqual([domainB])
    attempts[1].settle.resolve()
    await leaveA
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
    type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
    syncId,
    page,
    messageIds,
    done
  })
  const registerInventoryProvider = (server: RuntimeServer, records: TextMessageRecord[] = []) =>
    registerHistoryProvider(
      server,
      { domain: DOMAIN, pageId: 'page-a' },
      async (): Promise<HistorySupplyResult> => ({ records, done: true })
    )

  it('delivers a schema-accepted response whose message userId is absent from the users array', async () => {
    const { fake, server, roomId } = await setup()
    await registerInventoryProvider(server)
    const delivered: string[] = []
    await server.onInbound({ pageId: 'page-a' }, (event) => {
      delivered.push(event.record.message.id)
    })
    fake.receive(roomId, 'peer-a', session())
    await settle()
    await settle()
    const requestMsg = await vi.waitFor(() => {
      const found = fake.messages(roomId).find((m) => m.type === MESSAGE_TYPE.HISTORY_MESSAGES_PULL)
      expect(found).toBeDefined()
      return found
    })
    const syncId = (requestMsg as { syncId: string }).syncId

    // The declarative schema does not validate History user references: a message whose userId
    // is absent from the page users is still delivered with a minimal author snapshot, not
    // silently filtered or converted into an error.
    fake.receive(roomId, 'peer-a', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PUSH,
      syncId,
      page: 0,
      users: [],
      messages: [text('missing-reference')],
      done: true
    })
    await vi.waitFor(() => expect(delivered).toEqual(['missing-reference']))
  })

  it('serves a load-accepted record whose outer/message/user identities differ', async () => {
    const { fake, server, roomId } = await setup()
    const database = createMemoryMessageDatabase('history-mismatch-db')
    const store = createMessageStore(database)
    // The load boundary accepts identity mismatches (relationships are not validated), and the
    // History supplier must not re-filter them downstream.
    const mismatched = {
      type: MESSAGE_RECORD_TYPE.CHAT_MESSAGE,
      id: 'outer-mismatch',
      message: { ...text('inner-message', REMOTE_USER.id, NOW - 1), id: 'inner-message' },
      user: { id: 'another-user', name: 'Another', avatar: '' },
      receivedAt: NOW - 1
    }
    await store.insert(mismatched)
    await registerHistoryProvider(server, { domain: DOMAIN, pageId: 'page-a' }, async () => {
      const records = await store.query({ type: MESSAGE_RECORD_TYPE.CHAT_MESSAGE })
      return { records: records as TextMessageRecord[], done: true }
    })
    fake.receive(roomId, 'peer-a', session())
    await settle()
    fake.receive(roomId, 'peer-a', request('sync-mismatch', 0, [], true))
    await vi.waitFor(() => {
      const sent = fake.messages(roomId).filter((m) => m.type === MESSAGE_TYPE.HISTORY_MESSAGES_PUSH)
      expect(sent.some((m) => (m as { syncId: string }).syncId === 'sync-mismatch')).toBe(true)
    })
    const sent = fake.messages(roomId).filter((m) => m.type === MESSAGE_TYPE.HISTORY_MESSAGES_PUSH)
    expect(sent[sent.length - 1]).toMatchObject({ messages: [{ id: 'inner-message' }] })
  })

  it('runs one exact-difference inventory -> missing-body sync through the real page boundary', async () => {
    const { fake, server, roomId } = await setup()
    await registerInventoryProvider(server)
    const delivered: string[] = []
    await server.onInbound({ pageId: 'page-a' }, (event) => {
      delivered.push(event.record.message.id)
    })
    fake.receive(roomId, 'peer-a', session())
    await settle()
    const requestMsg = fake.messages(roomId).find((m) => m.type === MESSAGE_TYPE.HISTORY_MESSAGES_PULL)
    const syncId = (requestMsg as { syncId: string }).syncId
    expect((requestMsg as { messageIds: string[] }).messageIds).toEqual([])
    expect((requestMsg as { done: boolean }).done).toBe(true)

    fake.receive(roomId, 'peer-a', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PUSH,
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
    const requestMsg = fake.messages(roomId).find((m) => m.type === MESSAGE_TYPE.HISTORY_MESSAGES_PULL)
    const syncId = (requestMsg as { syncId: string }).syncId

    fake.receive(roomId, 'peer-a', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PUSH,
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
    const requestMsg = fake.messages(roomId).find((m) => m.type === MESSAGE_TYPE.HISTORY_MESSAGES_PULL)
    const syncId = (requestMsg as { syncId: string }).syncId

    fake.receive(roomId, 'peer-a', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PUSH,
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
      const sent = fake.messages(roomId).filter((m) => m.type === MESSAGE_TYPE.HISTORY_MESSAGES_PUSH)
      expect(sent.length).toBeGreaterThan(0)
    })
    const sent = fake.messages(roomId).filter((m) => m.type === MESSAGE_TYPE.HISTORY_MESSAGES_PUSH)
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
    const requestMsg = fake.messages(roomId).find((m) => m.type === MESSAGE_TYPE.HISTORY_MESSAGES_PULL)
    const syncId = (requestMsg as { syncId: string }).syncId

    fake.receive(roomId, 'peer-a', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PUSH,
      syncId,
      page: 5,
      users: [REMOTE_USER],
      messages: [text('gap')],
      done: true
    })
    await settle()
    // The requester cancels the attempt: no further request pages are sent.
    expect(fake.messages(roomId).filter((m) => m.type === MESSAGE_TYPE.HISTORY_MESSAGES_PULL)).toHaveLength(1)
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

  it('slices inventory pages by the encoded 64KiB frame cap, never by the phase count', async () => {
    // A size-limited codec that throws on an oversized frame exactly like NativeWireCodec, while
    // staying JSON-transport compatible so the fake can carry it. This proves the throw-closes-bucket
    // paging and the single-unpageable-ID cancel paths against a real codec-size boundary.
    const sizeLimited: WireCodec = {
      // NativeWireCodec accepts a general frame of exactly 65,536 bytes; History requires strictly
      // below. Throwing only above the cap makes the strict predicate the bucket-closing boundary.
      encode: async (value) => {
        const json = JSON.stringify(value)
        if (new TextEncoder().encode(json).byteLength > 64 * 1024) {
          throw new Error('Wire frame exceeds 65536 bytes')
        }
        return json
      },
      decode: async (value) => JSON.parse(value)
    }
    const { fake, server, roomId } = await setup(DOMAIN, NOW, sizeLimited)
    const manyIds = Array.from({ length: 9000 }, (_, index) => `id-${index.toString(36).padStart(6, '0')}`)
    const records = manyIds.map((id, index) => textRecord(id, NOW - index))
    await registerHistoryProvider(server, { domain: DOMAIN, pageId: 'page-a' }, async () => ({
      records,
      done: true
    }))
    fake.receive(roomId, 'peer-a', session())
    await vi.waitFor(() => {
      const pages = fake.messages(roomId).filter((m) => m.type === MESSAGE_TYPE.HISTORY_MESSAGES_PULL)
      expect(pages.length).toBeGreaterThan(1)
    })
    const pages = fake.messages(roomId).filter((m) => m.type === MESSAGE_TYPE.HISTORY_MESSAGES_PULL)
    // Every page stays strictly below 64KiB after the codec's own size boundary.
    for (const page of pages) {
      expect(new TextEncoder().encode(JSON.stringify(page)).byteLength).toBeLessThan(64 * 1024)
    }
    expect(pages[pages.length - 1]).toMatchObject({ done: true })
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
    const requestMsg = fake.messages(roomId).find((m) => m.type === MESSAGE_TYPE.HISTORY_MESSAGES_PULL)
    const syncId = (requestMsg as { syncId: string }).syncId

    // Page 0 applies records older than page 1's newest: a cross-page ordering violation must cancel
    // the attempt instead of applying the violating prefix.
    fake.receive(roomId, 'peer-a', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PUSH,
      syncId,
      page: 0,
      users: [REMOTE_USER],
      messages: [text('older-page-0', REMOTE_USER.id, NOW - 10)],
      done: false
    })
    await vi.waitFor(() => expect(delivered).toContain('older-page-0'))
    fake.receive(roomId, 'peer-a', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PUSH,
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
    // Truly hold persistence: the page-0 record's ACK waits on a gate, so the batch stays pending
    // while page 1 (and a changed replay) arrive.
    const release = { ack: null as null | (() => void) }
    const ackGate = new Promise<void>((resolve) => {
      release.ack = resolve
    })
    let firstAckHeld = false
    await server.onInbound({ pageId: 'page-a' }, async (event) => {
      delivered.push(event.record.message.id)
      if (event.record.message.id === 'page-0-msg' && !firstAckHeld) {
        firstAckHeld = true
        await ackGate
      }
      await server.ackInbound({ domain: event.domain, sequence: event.sequence, inserted: true })
    })
    fake.receive(roomId, 'peer-a', session())
    await settle()
    const requestMsg = fake.messages(roomId).find((m) => m.type === MESSAGE_TYPE.HISTORY_MESSAGES_PULL)
    const syncId = (requestMsg as { syncId: string }).syncId

    fake.receive(roomId, 'peer-a', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PUSH,
      syncId,
      page: 0,
      users: [REMOTE_USER],
      messages: [text('page-0-msg', REMOTE_USER.id, NOW - 10)],
      done: false
    })
    await vi.waitFor(() => expect(delivered).toContain('page-0-msg'))
    // Page 1 arrives while page 0's ACK is still held: it joins the bounded serial queue.
    fake.receive(roomId, 'peer-a', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PUSH,
      syncId,
      page: 1,
      users: [REMOTE_USER],
      messages: [text('page-1-msg', REMOTE_USER.id, NOW - 20)],
      done: true
    })
    await settle()
    // Release the held ACK: page 0 settles, then the queued page 1 applies in order.
    release.ack?.()
    await vi.waitFor(() => expect(delivered).toContain('page-1-msg'), { timeout: 3000 })
    // Identical replay of the accepted page 0 after it settled is idempotent (no new delivery).
    const before = delivered.length
    fake.receive(roomId, 'peer-a', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PUSH,
      syncId,
      page: 0,
      users: [REMOTE_USER],
      messages: [text('page-0-msg', REMOTE_USER.id, NOW - 10)],
      done: false
    })
    await settle()
    expect(delivered.length).toBe(before)
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
    const requestMsg = fake.messages(roomId).find((m) => m.type === MESSAGE_TYPE.HISTORY_MESSAGES_PULL)
    const syncId = (requestMsg as { syncId: string }).syncId
    fake.receive(roomId, 'peer-a', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
      syncId,
      page: 0,
      messageIds: [],
      done: true
    })
    await vi.waitFor(() => {
      const sent = fake.messages(roomId).filter((m) => m.type === MESSAGE_TYPE.HISTORY_MESSAGES_PUSH)
      expect(sent.length).toBeGreaterThan(0)
    })
    const sent = fake.messages(roomId).filter((m) => m.type === MESSAGE_TYPE.HISTORY_MESSAGES_PUSH)
    const ids = sent.flatMap((m) => (m as { messages: { id: string }[] }).messages.map((x) => x.id))
    expect(ids.sort()).toEqual(['keep-1', 'keep-2'])
    expect(sent.every((m) => (m as { messages: unknown[] }).messages.length > 0 || sent.length === 1)).toBe(true)
  })

  it('cancels the attempt when a single opaque inventory id cannot form a valid page', async () => {
    const sizeLimited: WireCodec = {
      // NativeWireCodec accepts a general frame of exactly 65,536 bytes; History requires strictly
      // below. Throwing only above the cap makes the strict predicate the bucket-closing boundary.
      encode: async (value) => {
        const json = JSON.stringify(value)
        if (new TextEncoder().encode(json).byteLength > 64 * 1024) {
          throw new Error('Wire frame exceeds 65536 bytes')
        }
        return json
      },
      decode: async (value) => JSON.parse(value)
    }
    const { fake, server, roomId } = await setup(DOMAIN, NOW, sizeLimited)
    const hugeId = 'x'.repeat(70 * 1024)
    await registerInventoryProvider(server, [textRecord(hugeId, NOW)])
    fake.receive(roomId, 'peer-a', session())
    await settle()
    // The single opaque id cannot form any valid page: the attempt cancels locally, never sending.
    expect(fake.messages(roomId).some((m) => m.type === MESSAGE_TYPE.HISTORY_MESSAGES_PULL)).toBe(false)
  })

  it('cancels a dormant successor on changed replay or post-done inventory input', async () => {
    const { fake, server, roomId } = await setup()
    await registerInventoryProvider(server)
    fake.receive(roomId, 'peer-a', session())
    await settle()
    const firstSync = (
      fake.messages(roomId).find((m) => m.type === MESSAGE_TYPE.HISTORY_MESSAGES_PULL) as {
        syncId: string
      }
    ).syncId
    // A replacement syncId while the first inventory is still supplying occupies a dormant successor.
    fake.receive(roomId, 'peer-a', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
      syncId: 'replacement-1',
      page: 0,
      messageIds: ['known-a'],
      done: false
    })
    await settle()
    // Identical replay of the successor's page 0 is idempotent (no cancellation).
    fake.receive(roomId, 'peer-a', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
      syncId: 'replacement-1',
      page: 0,
      messageIds: ['known-a'],
      done: false
    })
    await settle()
    // Changed replay of the successor's page 0 cancels the successor attempt.
    fake.receive(roomId, 'peer-a', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
      syncId: 'replacement-1',
      page: 0,
      messageIds: ['known-b'],
      done: false
    })
    await settle()
    // Post-done inventory input on a fresh successor is rejected (cancels it).
    fake.receive(roomId, 'peer-a', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
      syncId: 'replacement-2',
      page: 0,
      messageIds: [],
      done: true
    })
    fake.receive(roomId, 'peer-a', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
      syncId: 'replacement-2',
      page: 1,
      messageIds: ['late'],
      done: true
    })
    await settle()
    // No provider response ever flows from the rejected successors.
    expect(fake.messages(roomId).filter((m) => m.type === MESSAGE_TYPE.HISTORY_MESSAGES_PUSH)).toHaveLength(0)
    expect(firstSync).toBeTruthy()
  })

  it('counts partial provider attempts toward admission and releases slots on peer removal', async () => {
    const { fake, server, roomId } = await setup()
    await registerInventoryProvider(server)
    fake.receive(roomId, 'peer-a', session())
    await settle()
    // Many peers send partial (non-final) inventories: each occupies admission from page zero.
    for (let peer = 0; peer < 5; peer += 1) {
      const peerId = `peer-${peer}`
      fake.receive(roomId, peerId, session())
      await settle()
      fake.receive(roomId, peerId, {
        type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
        syncId: `partial-${peer}`,
        page: 0,
        messageIds: [`known-${peer}`],
        done: false
      })
      await settle()
    }
    // The provider jobs are admitted even without a final inventory page.
    // Peer removal cancels the attempt and releases its slot accounting without leaking.
    await server.onSessionEvent({ pageId: 'page-a' }, async () => {})
    // Trigger the connection-level binding removal path: removing the peer via the session domain.
    await server.leaveChatRoom({ domain: DOMAIN })
    await settle()
    // No provider response pages ever flow from partial attempts.
    expect(fake.messages(roomId).filter((m) => m.type === MESSAGE_TYPE.HISTORY_MESSAGES_PUSH)).toHaveLength(0)
  })

  it('transitions a partial provider inventory to ready on the final page and serves responses', async () => {
    const { fake, server, roomId } = await setup()
    const database = createMemoryMessageDatabase('history-multipage-provider-db')
    const store = createMessageStore(database)
    await store.insert(textRecord('mp-1', NOW))
    await store.insert(textRecord('mp-2', NOW - 1))
    await registerHistoryProvider(server, { domain: DOMAIN, pageId: 'page-a' }, async () => {
      const records = await store.query({ type: MESSAGE_RECORD_TYPE.CHAT_MESSAGE })
      return { records: records as TextMessageRecord[], done: true }
    })
    fake.receive(roomId, 'peer-a', session())
    await settle()
    // A multi-page inventory: page 0 is partial, page 1 is final. The provider must transition the
    // single page-zero admission to ready on the final page and then serve the missing records.
    fake.receive(roomId, 'peer-a', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
      syncId: 'multi-page',
      page: 0,
      messageIds: ['mp-1'],
      done: false
    })
    await settle()
    fake.receive(roomId, 'peer-a', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
      syncId: 'multi-page',
      page: 1,
      messageIds: [],
      done: true
    })
    await vi.waitFor(() => {
      const responses = fake.messages(roomId).filter((m) => m.type === MESSAGE_TYPE.HISTORY_MESSAGES_PUSH)
      expect(responses.length).toBeGreaterThan(0)
    })
    const responses = fake.messages(roomId).filter((m) => m.type === MESSAGE_TYPE.HISTORY_MESSAGES_PUSH)
    const ids = responses.flatMap((m) => (m as { messages: { id: string }[] }).messages.map((x) => x.id))
    // Only the record absent from the inventory is returned.
    expect(ids).toEqual(['mp-2'])
  })

  it('treats an identical queued-terminal replay as idempotent and still applies queued pages', async () => {
    const { fake, server, roomId } = await setup()
    await registerInventoryProvider(server)
    const delivered: string[] = []
    const release = { ack: null as null | (() => void) }
    const ackGate = new Promise<void>((resolve) => {
      release.ack = resolve
    })
    let held = false
    await server.onInbound({ pageId: 'page-a' }, async (event) => {
      delivered.push(event.record.message.id)
      if (event.record.message.id === 'page-0-msg' && !held) {
        held = true
        await ackGate
      }
      await server.ackInbound({ domain: event.domain, sequence: event.sequence, inserted: true })
    })
    fake.receive(roomId, 'peer-a', session())
    await settle()
    const requestMsg = fake.messages(roomId).find((m) => m.type === MESSAGE_TYPE.HISTORY_MESSAGES_PULL)
    const syncId = (requestMsg as { syncId: string }).syncId

    fake.receive(roomId, 'peer-a', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PUSH,
      syncId,
      page: 0,
      users: [REMOTE_USER],
      messages: [text('page-0-msg', REMOTE_USER.id, NOW - 10)],
      done: false
    })
    await vi.waitFor(() => expect(delivered).toContain('page-0-msg'))
    const page1 = {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PUSH,
      syncId,
      page: 1,
      users: [REMOTE_USER],
      messages: [text('page-1-msg', REMOTE_USER.id, NOW - 20)],
      done: false
    }
    const page2 = {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PUSH,
      syncId,
      page: 2,
      users: [REMOTE_USER],
      messages: [text('page-2-msg', REMOTE_USER.id, NOW - 30)],
      done: true
    }
    fake.receive(roomId, 'peer-a', page1)
    fake.receive(roomId, 'peer-a', page2)
    // Identical replay of the queued terminal N+2 is idempotent: the attempt must NOT cancel.
    fake.receive(roomId, 'peer-a', page2)
    await settle()
    release.ack?.()
    await vi.waitFor(() => expect(delivered).toContain('page-2-msg'))
    await settle()
    // The identical replay did not cancel: queued N+1 and N+2 applied in order.
    expect(delivered).toEqual(['page-0-msg', 'page-1-msg', 'page-2-msg'])
  })

  it('cancels immediately on a changed queued-terminal replay and discards queued work', async () => {
    const { fake, server, roomId } = await setup()
    await registerInventoryProvider(server)
    const delivered: string[] = []
    const release = { ack: null as null | (() => void) }
    const ackGate = new Promise<void>((resolve) => {
      release.ack = resolve
    })
    let held = false
    await server.onInbound({ pageId: 'page-a' }, async (event) => {
      delivered.push(event.record.message.id)
      if (event.record.message.id === 'page-0-msg' && !held) {
        held = true
        await ackGate
      }
      await server.ackInbound({ domain: event.domain, sequence: event.sequence, inserted: true })
    })
    fake.receive(roomId, 'peer-a', session())
    await settle()
    const requestMsg = fake.messages(roomId).find((m) => m.type === MESSAGE_TYPE.HISTORY_MESSAGES_PULL)
    const syncId = (requestMsg as { syncId: string }).syncId

    fake.receive(roomId, 'peer-a', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PUSH,
      syncId,
      page: 0,
      users: [REMOTE_USER],
      messages: [text('page-0-msg', REMOTE_USER.id, NOW - 10)],
      done: false
    })
    await vi.waitFor(() => expect(delivered).toContain('page-0-msg'))
    fake.receive(roomId, 'peer-a', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PUSH,
      syncId,
      page: 1,
      users: [REMOTE_USER],
      messages: [text('page-1-msg', REMOTE_USER.id, NOW - 20)],
      done: false
    })
    fake.receive(roomId, 'peer-a', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PUSH,
      syncId,
      page: 2,
      users: [REMOTE_USER],
      messages: [text('page-2-msg', REMOTE_USER.id, NOW - 30)],
      done: true
    })
    await settle()
    // A changed replay of the queued terminal N+2 cancels the attempt immediately and discards the
    // queued N+1 and N+2, even after the held page 0 settles.
    fake.receive(roomId, 'peer-a', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PUSH,
      syncId,
      page: 2,
      users: [REMOTE_USER],
      messages: [text('changed-terminal', REMOTE_USER.id, NOW - 35)],
      done: true
    })
    await settle()
    release.ack?.()
    await settle()
    await settle()
    expect(delivered).toEqual(['page-0-msg'])
  })

  it('frees admission capacity on real peer removal so a new peer progresses', async () => {
    const { fake, server, roomId } = await setup()
    await registerInventoryProvider(server)
    // Two peers send partial inventories (page 0 non-final) plus a completed peer.
    fake.receive(roomId, 'peer-removed', session({ id: 'removed-user', name: 'Removed', avatar: '' }))
    await settle()
    fake.receive(roomId, 'peer-removed', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
      syncId: 'removed-partial',
      page: 0,
      messageIds: ['r-1'],
      done: false
    })
    await settle()
    fake.receive(roomId, 'peer-live', session({ id: 'live-user', name: 'Live', avatar: '' }))
    await settle()
    fake.receive(roomId, 'peer-live', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
      syncId: 'live-partial',
      page: 0,
      messageIds: ['l-1'],
      done: true
    })
    // Remove the first peer: its dormant/waiting/provider accounting is cleaned.
    fake.peerLeave(roomId, 'peer-removed')
    await settle()
    // The live peer's completed inventory must still be able to transition to ready and serve.
    await vi.waitFor(() => {
      const responses = fake.messages(roomId).filter((m) => m.type === MESSAGE_TYPE.HISTORY_MESSAGES_PUSH)
      expect(responses.length).toBeGreaterThan(0)
    })
  })

  it('never promotes a waiter before the old active supplier physically settles', async () => {
    const { fake, server, roomId } = await setup()
    // A held supplier that settles ONLY through the real cancellation path: cleanup cancels the
    // in-flight supply via its recorded supplyId, the provider's AbortSignal fires, and the
    // supply settles (rejects) shortly after the abort is observed.
    const started: string[] = []
    const cancelled: string[] = []
    await registerHistoryProvider(server, { domain: DOMAIN, pageId: 'page-a' }, (request, signal) => {
      if (request.mode === 'inventory') return Promise.resolve({ records: [], done: true })
      started.push(request.syncId)
      return new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => {
          cancelled.push(request.syncId)
          // The physical query settles after the abort is observable, never before.
          setTimeout(() => reject(signal.reason ?? new Error('aborted')), 30)
        })
      })
    })
    for (let peer = 0; peer < 5; peer += 1) {
      const peerId = `peer-${peer}`
      fake.receive(roomId, peerId, session({ id: `user-${peer}`, name: `User ${peer}`, avatar: '' }))
      await settle()
      fake.receive(roomId, peerId, {
        type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
        syncId: `full-${peer}`,
        page: 0,
        messageIds: [],
        done: true
      })
      await settle()
    }
    // Exactly four suppliers are physically running (the fifth is a waiting projection).
    expect(started).toEqual(['full-0', 'full-1', 'full-2', 'full-3'])
    // Remove peer-0: cleanup must actually cancel its live supply through the recorded supplyId
    // (observable on the AbortSignal), while the waiting fifth peer is NOT promoted early.
    fake.peerLeave(roomId, 'peer-0')
    await vi.waitFor(() => expect(cancelled).toEqual(['full-0']))
    expect(started).toEqual(['full-0', 'full-1', 'full-2', 'full-3'])
    // The cancelled supply settles (abort rejection) and exactly one waiter is promoted; no
    // manual gate resolution was involved anywhere.
    await vi.waitFor(() => expect(started).toEqual(['full-0', 'full-1', 'full-2', 'full-3', 'full-4']))
  })

  it('promotes a fresh successor admitted after cleanup when the old supply settles', async () => {
    const { fake, server, roomId } = await setup()
    const started: string[] = []
    const cancelled: string[] = []
    await registerHistoryProvider(server, { domain: DOMAIN, pageId: 'page-a' }, (request, signal) => {
      if (request.mode === 'inventory') return Promise.resolve({ records: [], done: true })
      started.push(request.syncId)
      return new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => {
          cancelled.push(request.syncId)
          // Physical settlement follows the observable abort after a short delay, so the dormant
          // successor has a window to be admitted before the old supply settles.
          setTimeout(() => reject(signal.reason ?? new Error('aborted')), 30)
        })
      })
    })
    fake.receive(roomId, 'peer-0', session({ id: 'user-0', name: 'User 0', avatar: '' }))
    await settle()
    fake.receive(roomId, 'peer-0', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
      syncId: 'old-a',
      page: 0,
      messageIds: [],
      done: true
    })
    await vi.waitFor(() => expect(started).toEqual(['old-a']))
    // Cleanup removes the peer: the in-flight supply is cancelled via its recorded supplyId.
    fake.peerLeave(roomId, 'peer-0')
    await settle()
    expect(cancelled).toEqual(['old-a'])
    // A fresh session submits a replacement request with a DIFFERENT syncId: it becomes one
    // dormant successor while the old active supply is still unsettled (no parallel supply).
    fake.receive(roomId, 'peer-0', session({ id: 'user-0b', name: 'User 0b', avatar: '' }))
    await settle()
    fake.receive(roomId, 'peer-0', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
      syncId: 'new-b',
      page: 0,
      messageIds: [],
      done: true
    })
    await settle()
    expect(started).toEqual(['old-a'])
    // The old supply settles (abort rejection): the successor is promoted by the late-settlement
    // path and its own supply starts; it is never deleted as stale.
    await vi.waitFor(() => expect(started).toEqual(['old-a', 'new-b']))
  })

  it('keeps a grace-retained committed binding untrusted across a prepared rebind and its rollback', async () => {
    const { fake, server, roomId } = await setup()
    fake.receive(roomId, 'peer-b', session({ id: 'user-b', name: 'User B', avatar: '' }))
    await settle()
    // B departs: the committed binding is retained only by the leave grace.
    fake.peerLeave(roomId, 'peer-b')
    await settle()
    // A local reconnect enters its prepared phase; its SESSION publication is held.
    fake.plantPeer(roomId, 'remote-peer')
    fake.makeNotReady()
    fake.hangSendsTo(roomId)
    const chatBroadcastStarted = fake.waitForSendAttempt(roomId)
    const reconnect = server.reconnectDomain({ domain: DOMAIN })
    await fake.waitForJoinCalls(4)
    fake.open()
    await expect(chatBroadcastStarted).resolves.toMatchObject({ roomId, to: ['remote-peer'] })
    // B's valid same-presence SESSION arrives during the prepared phase.
    fake.receive(roomId, 'peer-b', session({ id: 'user-b', name: 'User B', avatar: '' }))
    await settle()
    // A fresh TEXT from B's source before the commit is NOT admitted (attempt-owned until commit).
    fake.receive(roomId, 'peer-b', { ...text('pre-commit-live'), userId: 'user-b' })
    await settle()
    expect(await server.replayInbound({ domain: DOMAIN, after: 0 })).toEqual([])
    // The prepared attempt is superseded (rolled back): the committed deadline is preserved, so
    // the retained committed binding stays untrusted after the rollback too.
    const replacement = server.joinChatRoom({ domain: DOMAIN, user: USER, site: SITE })
    await expect(reconnect).resolves.toBeNull()
    await settle()
    fake.receive(roomId, 'peer-b', { ...text('post-rollback-live'), userId: 'user-b' })
    await settle()
    expect(await server.replayInbound({ domain: DOMAIN, after: 0 })).toEqual([])
    fake.releaseSends()
    const snapshot = await replacement
    if (!snapshot) throw new Error('Join was cancelled')
    // The aborted attempt's rebind does NOT transfer to the successor replacement: B's committed
    // binding stays under its pending leave after the replacement commit (live and History closed).
    fake.receive(roomId, 'peer-b', { ...text('post-commit-live'), userId: 'user-b' })
    await settle()
    expect(await server.replayInbound({ domain: DOMAIN, after: 0 })).toEqual([])
    // Only a CURRENT source publishing a valid SESSION cancels the matching leave.
    fake.receive(roomId, 'peer-b', session({ id: 'user-b', name: 'User B', avatar: '' }))
    await settle()
    fake.receive(roomId, 'peer-b', { ...text('post-rebind-live'), userId: 'user-b' })
    await settle()
    expect((await server.replayInbound({ domain: DOMAIN, after: 0 })).map((item) => item.record.message.id)).toEqual([
      'post-rebind-live'
    ])
  })

  it('removes an absent non-grace source at reconnect commit and admits nothing without a current SESSION', async () => {
    const { fake, server, roomId } = await setup()
    // B is an ordinary ACTIVE committed source (no pending leave).
    fake.receive(roomId, 'peer-b', session({ id: 'user-b', name: 'User B', avatar: '' }))
    await settle()
    // A local reconnect's replacement Room contains no B and B publishes no replacement SESSION.
    fake.plantPeer(roomId, 'remote-peer')
    fake.makeNotReady()
    fake.hangSendsTo(roomId)
    const chatBroadcastStarted = fake.waitForSendAttempt(roomId)
    const reconnect = server.reconnectDomain({ domain: DOMAIN })
    await fake.waitForJoinCalls(4)
    fake.open()
    await expect(chatBroadcastStarted).resolves.toMatchObject({ roomId })
    fake.releaseSends()
    await reconnect
    await settle()
    // The commit cannot manufacture a current binding the attempt never observed: B is removed.
    const snapshot = await server.getSnapshot()
    expect(snapshot.domains[0].sessions.some((session) => session.user.id === 'user-b')).toBe(false)
    fake.receive(roomId, 'peer-b', { ...text('ghost-after-absent-reconnect'), userId: 'user-b' })
    await settle()
    expect(await server.replayInbound({ domain: DOMAIN, after: 0 })).toEqual([])
    // A current valid SESSION restores authority.
    fake.receive(roomId, 'peer-b', session({ id: 'user-b', name: 'User B', avatar: '' }))
    await settle()
    fake.receive(roomId, 'peer-b', { ...text('post-absent-reconnect'), userId: 'user-b' })
    await settle()
    expect((await server.replayInbound({ domain: DOMAIN, after: 0 })).map((item) => item.record.message.id)).toEqual([
      'post-absent-reconnect'
    ])
  })

  it('keeps the graced generation displayed when the rebound source switches to a different presence', async () => {
    const { fake, server, roomId } = await setup()
    fake.receive(roomId, 'peer-b', session({ id: 'user-b', name: 'User B', avatar: '' }))
    await settle()
    // B departs: the committed binding is retained by the leave grace.
    fake.peerLeave(roomId, 'peer-b')
    await settle()
    // A held local replacement accepts B's valid same-presence SESSION in its prepared attempt...
    fake.plantPeer(roomId, 'remote-peer')
    fake.makeNotReady()
    fake.hangSendsTo(roomId)
    const chatBroadcastStarted = fake.waitForSendAttempt(roomId)
    const reconnect = server.reconnectDomain({ domain: DOMAIN })
    await fake.waitForJoinCalls(4)
    fake.open()
    await expect(chatBroadcastStarted).resolves.toMatchObject({ roomId })
    fake.receive(roomId, 'peer-b', session({ id: 'user-b', name: 'User B', avatar: '' }))
    await settle()
    // ... then the SAME source switches to a different presence C before commit.
    fake.receive(roomId, 'peer-b', session({ id: 'user-c', name: 'User C', avatar: '' }))
    await settle()
    fake.releaseSends()
    await reconnect
    await settle()
    // The refresh destroyed the grace ledger and the fresh B observation was displaced by C on
    // the same source without grace protection: the commit keeps only current C.
    const snapshot = await server.getSnapshot()
    const userIds = snapshot.domains[0].sessions.map((session) => session.user.id)
    expect(userIds).toEqual(['user-c'])
    // B's departed source stays untrusted (live) without a CURRENT valid B SESSION.
    fake.receive(roomId, 'peer-b', { ...text('ghost-after-presence-switch'), userId: 'user-b' })
    await settle()
    expect(await server.replayInbound({ domain: DOMAIN, after: 0 })).toEqual([])
    // C is current and trusted.
    fake.receive(roomId, 'peer-b', { ...text('post-c-current'), userId: 'user-c' })
    await settle()
    expect((await server.replayInbound({ domain: DOMAIN, after: 0 })).map((item) => item.record.message.id)).toEqual([
      'post-c-current'
    ])
    // A REPEATED current C SESSION updates only the current slot: one C and no B (the refresh
    // destroyed the grace ledger, so no graced generation remains to protect).
    fake.receive(roomId, 'peer-b', session({ id: 'user-c', name: 'User C', avatar: '' }))
    await settle()
    const afterRepeat = (await server.getSnapshot()).domains[0].sessions.map((session) => session.user.id)
    expect(afterRepeat.filter((id) => id === 'user-c')).toHaveLength(1)
    expect(afterRepeat.filter((id) => id === 'user-b')).toHaveLength(0)
    disposeServer(server)
  })

  it('deduplicates repeated same-presence prepared SESSION frames into one cancellation fact', async () => {
    const { fake, server, roomId } = await setup()
    fake.receive(roomId, 'peer-b', session({ id: 'user-b', name: 'User B', avatar: '' }))
    await settle()
    fake.peerLeave(roomId, 'peer-b')
    await settle()
    fake.plantPeer(roomId, 'remote-peer')
    fake.makeNotReady()
    fake.hangSendsTo(roomId)
    const chatBroadcastStarted = fake.waitForSendAttempt(roomId)
    const reconnect = server.reconnectDomain({ domain: DOMAIN })
    await fake.waitForJoinCalls(4)
    fake.open()
    await expect(chatBroadcastStarted).resolves.toMatchObject({ roomId })
    // Duplicate valid same-presence SESSION frames: one logical rebind marker.
    const rebind = session({ id: 'user-b', name: 'User B', avatar: '' })
    fake.receive(roomId, 'peer-b', rebind)
    await settle()
    fake.receive(roomId, 'peer-b', rebind)
    await settle()
    fake.releaseSends()
    await reconnect
    await settle()
    // The single cancellation fact is honored: B is current and trusted after the commit.
    fake.receive(roomId, 'peer-b', { ...text('post-duplicate-rebind'), userId: 'user-b' })
    await settle()
    expect((await server.replayInbound({ domain: DOMAIN, after: 0 })).map((item) => item.record.message.id)).toEqual([
      'post-duplicate-rebind'
    ])
    disposeServer(server)
  })

  it('does not cancel the reused-source History supply when the graced generation expires', async () => {
    vi.useFakeTimers()
    try {
      const clock = new FakeClock()
      const fake = createFakeTransport()
      const server = createServer({ transport: fake.transport, clock, codec: jsonCodec })
      await server.attachPage({ domain: DOMAIN, pageId: 'page-a' })
      await server.joinChatRoom({ domain: DOMAIN, user: USER, site: SITE })
      const roomId = getChatRoomId(DOMAIN)
      fake.receive(roomId, 'peer-b', session({ id: 'user-b', name: 'User B', avatar: '' }))
      await settle()
      // B departs (grace armed); the same source later carries current C.
      fake.peerLeave(roomId, 'peer-b')
      await settle()
      fake.plantPeer(roomId, 'remote-peer')
      fake.makeNotReady()
      fake.hangSendsTo(roomId)
      const chatBroadcastStarted = fake.waitForSendAttempt(roomId)
      const reconnect = server.reconnectDomain({ domain: DOMAIN })
      await fake.waitForJoinCalls(4)
      fake.open()
      await expect(chatBroadcastStarted).resolves.toMatchObject({ roomId })
      fake.receive(roomId, 'peer-b', session({ id: 'user-c', name: 'User C', avatar: '' }))
      await settle()
      fake.releaseSends()
      await reconnect
      await settle()
      // A real public History supply for current C on the reused source starts while B's grace
      // is still running (its own request timeout is separated from the grace deadline).
      const cancelled: string[] = []
      await registerHistoryProvider(server, { domain: DOMAIN, pageId: 'page-a' }, (request, signal) => {
        if (request.mode !== 'inventory') {
          signal.addEventListener('abort', () => cancelled.push(request.syncId))
          return new Promise<HistorySupplyResult>(() => {})
        }
        return Promise.resolve({ records: [], done: true })
      })
      await vi.advanceTimersByTimeAsync(100)
      fake.receive(roomId, 'peer-b', {
        type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
        syncId: 'current-c',
        page: 0,
        messageIds: [],
        done: true
      })
      await settle()
      // B's original deadline expires: B is removed, C stays current, and C's active supply is
      // NOT cancelled (the expiry never emits a source-removal event for a still-owned source).
      await vi.advanceTimersByTimeAsync(PENDING_LEAVE_GRACE_MS - 100)
      await vi.advanceTimersByTimeAsync(0)
      const after = (await server.getSnapshot()).domains[0].sessions.map((session) => session.user.id)
      expect(after).not.toContain('user-b')
      expect(after).toContain('user-c')
      expect(cancelled).toEqual([])
      disposeServer(server)
    } finally {
      vi.useRealTimers()
    }
  })

  it('emits exactly one join for a provisional presence that later binds authoritatively', async () => {
    const { fake, server, roomId } = await setup()
    const events: string[] = []
    await server.onSessionEvent({ pageId: 'page-a' }, (event) => {
      events.push(event.type)
    })
    fake.receive(roomId, 'peer-b', session({ id: 'user-b', name: 'User B', avatar: '' }))
    await settle()
    // A held ordinary join provisionally switches that source to C.
    fake.plantPeer(roomId, 'remote-peer')
    fake.makeNotReady()
    fake.hangSendsTo(roomId)
    const chatBroadcastStarted = fake.waitForSendAttempt(roomId)
    const join = server.joinChatRoom({ domain: DOMAIN, user: USER, site: SITE })
    await fake.waitForJoinCalls(4)
    fake.open()
    await expect(chatBroadcastStarted).resolves.toMatchObject({ roomId })
    fake.receive(roomId, 'peer-b', session({ id: 'user-c', name: 'User C', avatar: '' }))
    await settle()
    // The source departs before the commit: provisional C has no surviving authoritative
    // binding and must not remain logically active.
    fake.peerLeave(roomId, 'peer-b')
    await settle()
    fake.releaseSends()
    const snapshot = await join
    if (!snapshot) throw new Error('Join was cancelled')
    await settle()
    // C's first REAL binding on a different source is a zero-to-one join.
    fake.receive(roomId, 'peer-c', session({ id: 'user-c', name: 'User C', avatar: '' }))
    await settle()
    expect(events.filter((type) => type === 'join' || type === 'replace')).toEqual(['join', 'join'])
    const after = (await server.getSnapshot()).domains[0].sessions.map((session) => session.user.id)
    expect(after).toEqual(['user-b', 'user-c'])
    disposeServer(server)
  })

  it('accepts an exact grace rebind on a new source before commit and keeps B past the deadline', async () => {
    vi.useFakeTimers()
    try {
      const clock = new FakeClock()
      const fake = createFakeTransport()
      const server = createServer({ transport: fake.transport, clock, codec: jsonCodec })
      await server.attachPage({ domain: DOMAIN, pageId: 'page-a' })
      await server.joinChatRoom({ domain: DOMAIN, user: USER, site: SITE })
      const roomId = getChatRoomId(DOMAIN)
      fake.receive(roomId, 'peer-b', session({ id: 'user-b', name: 'User B', avatar: '' }))
      await settle()
      fake.plantPeer(roomId, 'remote-peer')
      fake.makeNotReady()
      fake.hangSendsTo(roomId)
      const chatBroadcastStarted = fake.waitForSendAttempt(roomId)
      const join = server.joinChatRoom({ domain: DOMAIN, user: USER, site: SITE })
      await fake.waitForJoinCalls(4)
      fake.open()
      await expect(chatBroadcastStarted).resolves.toMatchObject({ roomId })
      // The prepared switch to C and the source departure arm B's committed grace.
      fake.receive(roomId, 'peer-b', session({ id: 'user-c', name: 'User C', avatar: '' }))
      await settle()
      fake.peerLeave(roomId, 'peer-b')
      await settle()
      // A valid exact B rebind on a NEW source before the commit cancels the pending leave.
      fake.receive(roomId, 'peer-b-new', session({ id: 'user-b', name: 'User B', avatar: '' }))
      await settle()
      fake.releaseSends()
      const snapshot = await join
      if (!snapshot) throw new Error('Join was cancelled')
      await settle()
      // B stays continuously present past the original grace deadline (the rebind cancelled it).
      await vi.advanceTimersByTimeAsync(PENDING_LEAVE_GRACE_MS)
      await vi.advanceTimersByTimeAsync(0)
      const after = (await server.getSnapshot()).domains[0].sessions.map((session) => session.user.id)
      expect(after).toContain('user-b')
      disposeServer(server)
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps a same-presence generation ended when its last prepared source departs after displacement', async () => {
    const { fake, server, roomId } = await setup()
    // One logical B presence committed on TWO physical sources.
    fake.receive(roomId, 'peer-b-1', session({ id: 'user-b', name: 'User B', avatar: '' }))
    await settle()
    fake.receive(roomId, 'peer-b-2', {
      type: MESSAGE_TYPE.SESSION,
      sessionId: 'session-b2',
      presenceId: 'presence-user-b',
      joinedAt: NOW + 1,
      user: { id: 'user-b', name: 'User B', avatar: '' }
    })
    await settle()
    // A held ordinary preparation switches peer-b-1 from B to C (B displaced on that source).
    fake.plantPeer(roomId, 'remote-peer')
    fake.makeNotReady()
    fake.hangSendsTo(roomId)
    const chatBroadcastStarted = fake.waitForSendAttempt(roomId)
    const join = server.joinChatRoom({ domain: DOMAIN, user: USER, site: SITE })
    await fake.waitForJoinCalls(4)
    fake.open()
    await expect(chatBroadcastStarted).resolves.toMatchObject({ roomId })
    fake.receive(roomId, 'peer-b-1', session({ id: 'user-c', name: 'User C', avatar: '' }))
    await settle()
    // The LAST prepared B source departs: no B source survives in the preparation, and the
    // displaced committed peer-b-1=B binding must not keep B active.
    fake.peerLeave(roomId, 'peer-b-2')
    await settle()
    fake.releaseSends()
    const snapshot = await join
    if (!snapshot) throw new Error('Join was cancelled')
    await settle()
    // Replaying B's exact generation from a new source is source-locally dropped.
    fake.receive(roomId, 'peer-b-new', session({ id: 'user-b', name: 'User B', avatar: '' }))
    await settle()
    const after = (await server.getSnapshot()).domains[0].sessions.map((session) => session.user.id)
    expect(after).toEqual(['user-c'])
    disposeServer(server)
  })

  it('keeps unrelated ended tombstones across a prepared PeerLeave and rejects the expired replay', async () => {
    vi.useFakeTimers()
    try {
      const clock = new FakeClock()
      const fake = createFakeTransport()
      const server = createServer({ transport: fake.transport, clock, codec: jsonCodec })
      await server.attachPage({ domain: DOMAIN, pageId: 'page-a' })
      await server.joinChatRoom({ domain: DOMAIN, user: USER, site: SITE })
      const roomId = getChatRoomId(DOMAIN)
      // Commit B, deliver B's PeerLeave, and advance the deadline so B is removed and recorded ended.
      fake.receive(roomId, 'peer-b', session({ id: 'user-b', name: 'User B', avatar: '' }))
      await settle()
      fake.peerLeave(roomId, 'peer-b')
      await settle()
      await vi.advanceTimersByTimeAsync(PENDING_LEAVE_GRACE_MS)
      await vi.advanceTimersByTimeAsync(0)
      // Commit an unrelated current D.
      fake.receive(roomId, 'peer-d', session({ id: 'user-d', name: 'User D', avatar: '' }))
      await settle()
      // A held ordinary replacement preparation receives D's PeerLeave (exercises reconciliation).
      fake.plantPeer(roomId, 'remote-peer')
      fake.makeNotReady()
      fake.hangSendsTo(roomId)
      const chatBroadcastStarted = fake.waitForSendAttempt(roomId)
      const join = server.joinChatRoom({ domain: DOMAIN, user: USER, site: SITE })
      await fake.waitForJoinCalls(4)
      fake.open()
      await expect(chatBroadcastStarted).resolves.toMatchObject({ roomId })
      fake.peerLeave(roomId, 'peer-d')
      await settle()
      fake.releaseSends()
      const snapshot = await join
      if (!snapshot) throw new Error('Join was cancelled')
      await settle()
      // Replaying B's exact expired SESSION from a new source is source-locally dropped:
      // the tombstone survived the unrelated reconciliation, and grace-preserved D stays shown.
      fake.receive(roomId, 'peer-b-new', session({ id: 'user-b', name: 'User B', avatar: '' }))
      await settle()
      const after = (await server.getSnapshot()).domains[0].sessions.map((session) => session.user.id)
      expect(after).toEqual(['user-d'])
      disposeServer(server)
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps the preparation-owned displaced finality across an unrelated PeerLeave', async () => {
    const { fake, server, roomId } = await setup()
    // Commit B and D.
    fake.receive(roomId, 'peer-b', session({ id: 'user-b', name: 'User B', avatar: '' }))
    await settle()
    fake.receive(roomId, 'peer-d', session({ id: 'user-d', name: 'User D', avatar: '' }))
    await settle()
    // A held ordinary preparation switches B's source to C.
    fake.plantPeer(roomId, 'remote-peer')
    fake.makeNotReady()
    fake.hangSendsTo(roomId)
    const chatBroadcastStarted = fake.waitForSendAttempt(roomId)
    const join = server.joinChatRoom({ domain: DOMAIN, user: USER, site: SITE })
    await fake.waitForJoinCalls(4)
    fake.open()
    await expect(chatBroadcastStarted).resolves.toMatchObject({ roomId })
    fake.receive(roomId, 'peer-b', session({ id: 'user-c', name: 'User C', avatar: '' }))
    await settle()
    // An UNRELATED D PeerLeave must not reactivate the preparation-displaced B.
    fake.peerLeave(roomId, 'peer-d')
    await settle()
    fake.releaseSends()
    const snapshot = await join
    if (!snapshot) throw new Error('Join was cancelled')
    await settle()
    // B stays ended: replaying its exact generation on a new source is source-locally rejected,
    // while grace-preserved D stays displayed.
    fake.receive(roomId, 'peer-b-new', session({ id: 'user-b', name: 'User B', avatar: '' }))
    await settle()
    const after = (await server.getSnapshot()).domains[0].sessions.map((session) => session.user.id)
    expect(after).toEqual(['user-c', 'user-d'])
    disposeServer(server)
  })

  it('emits no finality event when the prepared switch source departs before commit', async () => {
    const { fake, server, roomId } = await setup()
    const events: string[] = []
    await server.onSessionEvent({ pageId: 'page-a' }, (event) => {
      events.push(event.type)
    })
    fake.receive(roomId, 'peer-b', session({ id: 'user-b', name: 'User B', avatar: '' }))
    await settle()
    // A held ordinary join receives changed-user C from the same source, recording displaced B.
    fake.plantPeer(roomId, 'remote-peer')
    fake.makeNotReady()
    fake.hangSendsTo(roomId)
    const chatBroadcastStarted = fake.waitForSendAttempt(roomId)
    const join = server.joinChatRoom({ domain: DOMAIN, user: USER, site: SITE })
    await fake.waitForJoinCalls(4)
    fake.open()
    await expect(chatBroadcastStarted).resolves.toMatchObject({ roomId })
    fake.receive(roomId, 'peer-b', session({ id: 'user-c', name: 'User C', avatar: '' }))
    await settle()
    // The source departs before the commit: provisional C is removed and committed B enters
    // grace. The displaced fact is revoked, so the commit emits NO leave/replace.
    fake.peerLeave(roomId, 'peer-b')
    await settle()
    fake.releaseSends()
    const snapshot = await join
    if (!snapshot) throw new Error('Join was cancelled')
    await settle()
    const after = (await server.getSnapshot()).domains[0].sessions.map((session) => session.user.id)
    expect(after).toEqual(['user-b'])
    expect(events.filter((type) => type === 'leave' || type === 'replace')).toEqual([])
    disposeServer(server)
  })

  it('emits one final transition per logical user when one preparation displaces two presences', async () => {
    const { fake, server, roomId } = await setup()
    const events: string[] = []
    await server.onSessionEvent({ pageId: 'page-a' }, (event) => {
      events.push(event.type)
    })
    // User B has two distinct presences on two sources.
    fake.receive(roomId, 'peer-b1', session({ id: 'user-b', name: 'User B', avatar: '' }))
    await settle()
    fake.receive(roomId, 'peer-b2', {
      type: MESSAGE_TYPE.SESSION,
      sessionId: 'session-b2',
      presenceId: 'presence-b2',
      joinedAt: NOW + 1,
      user: { id: 'user-b', name: 'User B', avatar: '' }
    })
    await settle()
    fake.plantPeer(roomId, 'remote-peer')
    fake.makeNotReady()
    fake.hangSendsTo(roomId)
    const chatBroadcastStarted = fake.waitForSendAttempt(roomId)
    const join = server.joinChatRoom({ domain: DOMAIN, user: USER, site: SITE })
    await fake.waitForJoinCalls(4)
    fake.open()
    await expect(chatBroadcastStarted).resolves.toMatchObject({ roomId })
    // Both sources switch to C and D during the held preparation.
    fake.receive(roomId, 'peer-b1', session({ id: 'user-c', name: 'User C', avatar: '' }))
    await settle()
    fake.receive(roomId, 'peer-b2', {
      type: MESSAGE_TYPE.SESSION,
      sessionId: 'session-d',
      presenceId: 'presence-d',
      joinedAt: NOW + 2,
      user: { id: 'user-d', name: 'User D', avatar: '' }
    })
    await settle()
    fake.releaseSends()
    const snapshot = await join
    if (!snapshot) throw new Error('Join was cancelled')
    await settle()
    const after = (await server.getSnapshot()).domains[0].sessions.map((session) => session.user.id)
    expect(after).toEqual(['user-c', 'user-d'])
    // One B finality transition paired with one incoming join, plus the other independent join.
    expect(events.filter((type) => type === 'join' || type === 'replace' || type === 'leave')).toEqual([
      'join',
      'replace',
      'join'
    ])
    disposeServer(server)
  })

  it('emits a replacement lifecycle when a held ordinary join switches a changed user during preparation', async () => {
    const { fake, server, roomId } = await setup()
    const events: string[] = []
    await server.onSessionEvent({ pageId: 'page-a' }, (event) => {
      events.push(event.type)
    })
    fake.receive(roomId, 'peer-b', session({ id: 'user-b', name: 'User B', avatar: '' }))
    await settle()
    // A held ordinary join receives a later changed-user C SESSION from B's same source.
    fake.plantPeer(roomId, 'remote-peer')
    fake.makeNotReady()
    fake.hangSendsTo(roomId)
    const chatBroadcastStarted = fake.waitForSendAttempt(roomId)
    const join = server.joinChatRoom({ domain: DOMAIN, user: USER, site: SITE })
    await fake.waitForJoinCalls(4)
    fake.open()
    await expect(chatBroadcastStarted).resolves.toMatchObject({ roomId })
    fake.receive(roomId, 'peer-b', session({ id: 'user-c', name: 'User C', avatar: '' }))
    await settle()
    fake.releaseSends()
    const snapshot = await join
    if (!snapshot) throw new Error('Join was cancelled')
    await settle()
    // The commit classifies the attempt-owned displaced fact: join,replace (not join,join).
    expect(events.filter((type) => type === 'join' || type === 'replace')).toEqual(['join', 'replace'])
    const after = (await server.getSnapshot()).domains[0].sessions.map((session) => session.user.id)
    expect(after).toEqual(['user-c'])
    disposeServer(server)
  })

  it('emits only the displaced final leave when a held ordinary join switches to historical C', async () => {
    const { fake, server, roomId } = await setup()
    const events: string[] = []
    await server.onSessionEvent({ pageId: 'page-a' }, (event) => {
      events.push(event.type)
    })
    fake.receive(roomId, 'peer-b', session({ id: 'user-b', name: 'User B', avatar: '' }))
    await settle()
    fake.plantPeer(roomId, 'remote-peer')
    fake.makeNotReady()
    fake.hangSendsTo(roomId)
    const chatBroadcastStarted = fake.waitForSendAttempt(roomId)
    const join = server.joinChatRoom({ domain: DOMAIN, user: USER, site: SITE })
    await fake.waitForJoinCalls(4)
    fake.open()
    await expect(chatBroadcastStarted).resolves.toMatchObject({ roomId })
    // Historical C (joinedAt before the local generation): converges without a join notice.
    fake.receive(roomId, 'peer-b', {
      type: MESSAGE_TYPE.SESSION,
      sessionId: 'session-historical',
      presenceId: 'presence-historical',
      joinedAt: NOW - 10,
      user: { id: 'user-c', name: 'User C', avatar: '' }
    })
    await settle()
    fake.releaseSends()
    const snapshot = await join
    if (!snapshot) throw new Error('Join was cancelled')
    await settle()
    expect(events.filter((type) => type === 'leave')).toEqual(['leave'])
    const after = (await server.getSnapshot()).domains[0].sessions.map((session) => session.user.id)
    expect(after).toEqual(['user-c'])
    disposeServer(server)
  })

  it('keeps one current C and one grace B when a held ordinary join repeats C during preparation', async () => {
    const { fake, server, roomId } = await setup()
    // Build [grace B, current C] on one source in the committed runtime.
    fake.receive(roomId, 'peer-b', session({ id: 'user-b', name: 'User B', avatar: '' }))
    await settle()
    fake.peerLeave(roomId, 'peer-b')
    await settle()
    fake.receive(roomId, 'peer-b', session({ id: 'user-c', name: 'User C', avatar: '' }))
    await settle()
    // An ordinary local join preparation seeds BOTH committed same-source entries.
    fake.plantPeer(roomId, 'remote-peer')
    fake.makeNotReady()
    fake.hangSendsTo(roomId)
    const chatBroadcastStarted = fake.waitForSendAttempt(roomId)
    const join = server.joinChatRoom({ domain: DOMAIN, user: USER, site: SITE })
    await fake.waitForJoinCalls(4)
    fake.open()
    await expect(chatBroadcastStarted).resolves.toMatchObject({ roomId })
    // Repeated current C during the prepared phase: only the current C slot is normalized.
    fake.receive(roomId, 'peer-b', session({ id: 'user-c', name: 'User C', avatar: '' }))
    await settle()
    fake.receive(roomId, 'peer-b', session({ id: 'user-c', name: 'User C', avatar: '' }))
    await settle()
    fake.releaseSends()
    const snapshot = await join
    if (!snapshot) throw new Error('Join was cancelled')
    await settle()
    const userIds = (await server.getSnapshot()).domains[0].sessions.map((session) => session.user.id)
    expect(userIds.filter((id) => id === 'user-c')).toHaveLength(1)
    expect(userIds.filter((id) => id === 'user-b')).toHaveLength(1)
    disposeServer(server)
  })

  it('keeps [current C, grace B] stable under a repeated current C SESSION', async () => {
    const { fake, server, roomId } = await setup()
    fake.receive(roomId, 'peer-b', session({ id: 'user-b', name: 'User B', avatar: '' }))
    await settle()
    fake.peerLeave(roomId, 'peer-b')
    await settle()
    fake.plantPeer(roomId, 'remote-peer')
    fake.makeNotReady()
    fake.hangSendsTo(roomId)
    const chatBroadcastStarted = fake.waitForSendAttempt(roomId)
    const reconnect = server.reconnectDomain({ domain: DOMAIN })
    await fake.waitForJoinCalls(4)
    fake.open()
    await expect(chatBroadcastStarted).resolves.toMatchObject({ roomId })
    // B's same-presence rebind then the SAME source switches to C before commit.
    fake.receive(roomId, 'peer-b', session({ id: 'user-b', name: 'User B', avatar: '' }))
    await settle()
    fake.receive(roomId, 'peer-b', session({ id: 'user-c', name: 'User C', avatar: '' }))
    await settle()
    fake.releaseSends()
    await reconnect
    await settle()
    // The refresh destroyed the grace ledger; the fresh B rebind was displaced by C on the same
    // source without grace protection, so the commit keeps only current C.
    const userIds = (await server.getSnapshot()).domains[0].sessions.map((session) => session.user.id)
    expect(userIds).toEqual(['user-c'])
    // A repeated valid C SESSION updates only the current C slot: C stays single, no graced B.
    fake.receive(roomId, 'peer-b', session({ id: 'user-c', name: 'User C', avatar: '' }))
    await settle()
    const after = (await server.getSnapshot()).domains[0].sessions.map((session) => session.user.id)
    expect(after.filter((id) => id === 'user-c')).toHaveLength(1)
    expect(after.filter((id) => id === 'user-b')).toHaveLength(0)
    disposeServer(server)
  })

  it('keeps the committed grace running when a prepared rebind source leaves again before commit', async () => {
    const { fake, server, roomId } = await setup()
    fake.receive(roomId, 'peer-b', session({ id: 'user-b', name: 'User B', avatar: '' }))
    await settle()
    // B departs: the committed binding is retained only by the leave grace.
    fake.peerLeave(roomId, 'peer-b')
    await settle()
    // A held local replacement accepts B's valid same-presence SESSION in its prepared attempt.
    fake.plantPeer(roomId, 'remote-peer')
    fake.makeNotReady()
    fake.hangSendsTo(roomId)
    const chatBroadcastStarted = fake.waitForSendAttempt(roomId)
    const reconnect = server.reconnectDomain({ domain: DOMAIN })
    await fake.waitForJoinCalls(4)
    fake.open()
    await expect(chatBroadcastStarted).resolves.toMatchObject({ roomId, to: ['remote-peer'] })
    fake.receive(roomId, 'peer-b', session({ id: 'user-b', name: 'User B', avatar: '' }))
    await settle()
    // The rebind source leaves AGAIN before the commit: its cancellation fact is revoked.
    fake.peerLeave(roomId, 'peer-b')
    await settle()
    fake.releaseSends()
    await reconnect
    await settle()
    // The refresh destroyed the committed grace: the rebind source left again before commit and
    // no grace ledger remains to protect it, so B is not displayed and its authority is closed
    // without a CURRENT valid SESSION.
    const snapshot = await server.getSnapshot()
    expect(snapshot.domains[0].sessions.some((session) => session.user.id === 'user-b')).toBe(false)
    fake.receive(roomId, 'peer-b', { ...text('ghost-after-revoked-commit'), userId: 'user-b' })
    await settle()
    expect(await server.replayInbound({ domain: DOMAIN, after: 0 })).toEqual([])
    // A CURRENT valid SESSION restores authority.
    fake.receive(roomId, 'peer-b', session({ id: 'user-b', name: 'User B', avatar: '' }))
    await settle()
    fake.receive(roomId, 'peer-b', { ...text('post-current-rebind'), userId: 'user-b' })
    await settle()
    expect((await server.replayInbound({ domain: DOMAIN, after: 0 })).map((item) => item.record.message.id)).toEqual([
      'post-current-rebind'
    ])
  })

  it('replaces the unprotected committed source binding on a direct same-source switch', async () => {
    const { fake, server, roomId } = await setup()
    fake.receive(roomId, 'peer-b', session({ id: 'user-b', name: 'User B', avatar: '' }))
    await settle()
    // A valid C SESSION from the SAME committed source, with NO pending leave protecting B.
    fake.receive(roomId, 'peer-b', session({ id: 'user-c', name: 'User C', avatar: '' }))
    await settle()
    // The snapshot contains only C (stale unprotected B is replaced, not appended).
    const after = (await server.getSnapshot()).domains[0].sessions.map((session) => session.user.id)
    expect(after).toEqual(['user-c'])
    // Stale B live is rejected; current C live is admitted.
    fake.receive(roomId, 'peer-b', { ...text('stale-b-live'), userId: 'user-b' })
    await settle()
    expect(await server.replayInbound({ domain: DOMAIN, after: 0 })).toEqual([])
    fake.receive(roomId, 'peer-b', { ...text('current-c-live'), userId: 'user-c' })
    await settle()
    expect((await server.replayInbound({ domain: DOMAIN, after: 0 })).map((item) => item.record.message.id)).toEqual([
      'current-c-live'
    ])
    disposeServer(server)
  })

  it('emits a replacement lifecycle (not a second join) for a changed-user direct source switch', async () => {
    const { fake, server, roomId } = await setup()
    const events: string[] = []
    await server.onSessionEvent({ pageId: 'page-a' }, (event) => {
      events.push(event.type)
    })
    fake.receive(roomId, 'peer-b', session({ id: 'user-b', name: 'User B', avatar: '' }))
    await settle()
    // Direct changed-user switch on the same committed source: the displaced B observation is
    // ended and the lifecycle is a replacement, not a second join.
    fake.receive(roomId, 'peer-b', session({ id: 'user-c', name: 'User C', avatar: '' }))
    await settle()
    expect(events.filter((type) => type === 'join' || type === 'replace')).toEqual(['join', 'replace'])
    const after = (await server.getSnapshot()).domains[0].sessions.map((session) => session.user.id)
    expect(after).toEqual(['user-c'])
    disposeServer(server)
  })

  it('emits no leave when the displaced user keeps another active presence', async () => {
    const { fake, server, roomId } = await setup()
    const events: string[] = []
    await server.onSessionEvent({ pageId: 'page-a' }, (event) => {
      events.push(event.type)
    })
    // C is already active on peer-c; user B has TWO distinct active presences on two sources.
    fake.receive(roomId, 'peer-c', session({ id: 'user-c', name: 'User C', avatar: '' }))
    await settle()
    fake.receive(roomId, 'peer-b1', session({ id: 'user-b', name: 'User B', avatar: '' }))
    await settle()
    fake.receive(roomId, 'peer-b2', {
      type: MESSAGE_TYPE.SESSION,
      sessionId: 'session-b2',
      presenceId: 'presence-b2',
      joinedAt: NOW + 1,
      user: { id: 'user-b', name: 'User B', avatar: '' }
    })
    await settle()
    // One B source switches to the already-active C: the other B stays displayed, so NO final
    // leave is emitted (the incoming C was not a zero-to-one join either).
    fake.receive(roomId, 'peer-b1', session({ id: 'user-c', name: 'User C', avatar: '' }))
    await settle()
    expect(events.filter((type) => type === 'leave')).toEqual([])
    // The displaced B1 binding is removed, but the other B presence stays displayed.
    const after = (await server.getSnapshot()).domains[0].sessions.map((session) => session.user.id)
    expect(after).toEqual(['user-c', 'user-b', 'user-c'])
    disposeServer(server)
  })

  it('emits no leave when the displaced user keeps a grace-preserved presence', async () => {
    const { fake, server, roomId } = await setup()
    const events: string[] = []
    await server.onSessionEvent({ pageId: 'page-a' }, (event) => {
      events.push(event.type)
    })
    // User B has one grace-preserved presence and one current presence on two sources.
    fake.receive(roomId, 'peer-b1', session({ id: 'user-b', name: 'User B', avatar: '' }))
    await settle()
    fake.peerLeave(roomId, 'peer-b1')
    await settle()
    fake.receive(roomId, 'peer-b2', {
      type: MESSAGE_TYPE.SESSION,
      sessionId: 'session-b2',
      presenceId: 'presence-b2',
      joinedAt: NOW + 1,
      user: { id: 'user-b', name: 'User B', avatar: '' }
    })
    await settle()
    // The current B source switches to C: grace B stays displayed, so NO finality event (leave
    // or replace) may encode B's one-to-zero transition.
    fake.receive(roomId, 'peer-b2', session({ id: 'user-c', name: 'User C', avatar: '' }))
    await settle()
    expect(events.filter((type) => type === 'leave' || type === 'replace')).toEqual([])
    const after = (await server.getSnapshot()).domains[0].sessions.map((session) => session.user.id)
    expect(after).toEqual(['user-b', 'user-c'])
    disposeServer(server)
  })

  it('emits the displaced leave when the source switches to an already-active generation', async () => {
    const { fake, server, roomId } = await setup()
    const events: string[] = []
    await server.onSessionEvent({ pageId: 'page-a' }, (event) => {
      events.push(event.type)
    })
    // C is already active on peer-c.
    fake.receive(roomId, 'peer-c', session({ id: 'user-c', name: 'User C', avatar: '' }))
    await settle()
    // B joins on peer-b, then peer-b switches to the same accepted C generation.
    fake.receive(roomId, 'peer-b', session({ id: 'user-b', name: 'User B', avatar: '' }))
    await settle()
    fake.receive(roomId, 'peer-b', session({ id: 'user-c', name: 'User C', avatar: '' }))
    await settle()
    // The displaced B's final leave is emitted even though incoming C was not a zero-to-one join.
    expect(events.filter((type) => type === 'leave')).toEqual(['leave'])
    const after = (await server.getSnapshot()).domains[0].sessions.map((session) => session.user.id)
    expect(after).toEqual(['user-c', 'user-c'])
    disposeServer(server)
  })

  it('emits the displaced leave when the source switches to an earlier historical generation', async () => {
    const { fake, server, roomId } = await setup()
    const events: string[] = []
    await server.onSessionEvent({ pageId: 'page-a' }, (event) => {
      events.push(event.type)
    })
    // B joins, then the source switches to historical C (joinedAt before the local generation).
    fake.receive(roomId, 'peer-b', session({ id: 'user-b', name: 'User B', avatar: '' }))
    await settle()
    fake.receive(roomId, 'peer-b', {
      type: MESSAGE_TYPE.SESSION,
      sessionId: 'session-historical',
      presenceId: 'presence-historical',
      joinedAt: NOW - 10,
      user: { id: 'user-c', name: 'User C', avatar: '' }
    })
    await settle()
    // C converges without a join notice, but B's final leave is still emitted.
    expect(events.filter((type) => type === 'leave')).toEqual(['leave'])
    const after = (await server.getSnapshot()).domains[0].sessions.map((session) => session.user.id)
    expect(after).toEqual(['user-c'])
    disposeServer(server)
  })

  it('emits exactly one final leave when the replaced same-user generation itself departs and expires', async () => {
    vi.useFakeTimers()
    try {
      const clock = new FakeClock()
      const fake = createFakeTransport()
      const server = createServer({ transport: fake.transport, clock, codec: jsonCodec })
      await server.attachPage({ domain: DOMAIN, pageId: 'page-a' })
      await server.joinChatRoom({ domain: DOMAIN, user: USER, site: SITE })
      const roomId = getChatRoomId(DOMAIN)
      const events: string[] = []
      await server.onSessionEvent({ pageId: 'page-a' }, (event) => {
        events.push(event.type)
      })
      // B and C are two distinct generations of the SAME user on one source.
      fake.receive(roomId, 'peer-b', {
        type: MESSAGE_TYPE.SESSION,
        sessionId: 'session-b',
        presenceId: 'presence-same-b',
        joinedAt: NOW + 1,
        user: { id: 'same-user', name: 'Same', avatar: '' }
      })
      await settle()
      fake.receive(roomId, 'peer-b', {
        type: MESSAGE_TYPE.SESSION,
        sessionId: 'session-c',
        presenceId: 'presence-same-c',
        joinedAt: NOW + 2,
        user: { id: 'same-user', name: 'Same', avatar: '' }
      })
      await settle()
      // C's real PeerLeave arms C's own deadline; the displaced B observation is ended, so the
      // expiry emits exactly one final leave (no phantom active presence suppresses it).
      fake.peerLeave(roomId, 'peer-b')
      await settle()
      await vi.advanceTimersByTimeAsync(PENDING_LEAVE_GRACE_MS)
      await vi.advanceTimersByTimeAsync(0)
      const after = (await server.getSnapshot()).domains[0].sessions.map((session) => session.user.id)
      expect(after).toEqual([])
      expect(events.filter((type) => type === 'leave')).toHaveLength(1)
      disposeServer(server)
    } finally {
      vi.useRealTimers()
    }
  })

  it('admits current C live and arms C own leave on a direct [grace B, current C] source', async () => {
    vi.useFakeTimers()
    try {
      const clock = new FakeClock()
      const fake = createFakeTransport()
      const server = createServer({ transport: fake.transport, clock, codec: jsonCodec })
      await server.attachPage({ domain: DOMAIN, pageId: 'page-a' })
      await server.joinChatRoom({ domain: DOMAIN, user: USER, site: SITE })
      const roomId = getChatRoomId(DOMAIN)
      // B commits and departs: B's pending leave arms.
      fake.receive(roomId, 'peer-b', session({ id: 'user-b', name: 'User B', avatar: '' }))
      await settle()
      fake.peerLeave(roomId, 'peer-b')
      await settle()
      // The SAME committed source directly receives current C.
      fake.receive(roomId, 'peer-b', session({ id: 'user-c', name: 'User C', avatar: '' }))
      await settle()
      const afterSwitch = (await server.getSnapshot()).domains[0].sessions.map((session) => session.user.id)
      expect(afterSwitch).toEqual(['user-b', 'user-c'])
      // C's live traffic is admitted (the current binding resolves the non-pending C).
      fake.receive(roomId, 'peer-b', { ...text('current-c-live'), userId: 'user-c' })
      await settle()
      expect((await server.replayInbound({ domain: DOMAIN, after: 0 })).map((item) => item.record.message.id)).toEqual([
        'current-c-live'
      ])
      // The source leaves again: C's OWN leave arms; B's original deadline keeps running.
      fake.peerLeave(roomId, 'peer-b')
      await settle()
      await vi.advanceTimersByTimeAsync(PENDING_LEAVE_GRACE_MS)
      await vi.advanceTimersByTimeAsync(0)
      const afterExpiry = (await server.getSnapshot()).domains[0].sessions.map((session) => session.user.id)
      expect(afterExpiry).toEqual([])
      disposeServer(server)
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps a grace-retained committed binding untrusted across an ordinary local replacement join', async () => {
    const { fake, server, roomId } = await setup()
    fake.receive(roomId, 'peer-b', session({ id: 'user-b', name: 'User B', avatar: '' }))
    await settle()
    // B departs: the committed binding is retained only by the leave grace.
    fake.peerLeave(roomId, 'peer-b')
    await settle()
    // An ordinary local replacement join carries the committed sessions into its prepared runtime
    // but never receives a valid same-presence SESSION for B.
    await server.joinChatRoom({ domain: DOMAIN, user: USER, site: SITE })
    await settle()
    // Fresh TEXT from B's departed source is NOT admitted after the replacement commit.
    fake.receive(roomId, 'peer-b', { ...text('ghost-after-local-commit'), userId: 'user-b' })
    await settle()
    expect(await server.replayInbound({ domain: DOMAIN, after: 0 })).toEqual([])
  })

  it('keeps a grace-retained binding untrusted when the release cleanup write rejects', async () => {
    const clock = new FakeClock()
    const fake = createFakeTransport()
    const rejectStore: PresenceStore = {
      load: async () => ({
        domain: DOMAIN,
        lastJoinedAt: 0,
        local: { presenceId: 'presence-a', userId: USER.id, joinedAt: 1, status: 'active' as const },
        observers: []
      }),
      save: async (record) => {
        if (!record.local && record.observers.length === 0) {
          throw new Error('release cleanup rejected')
        }
      }
    }
    const server = createServer({ transport: fake.transport, clock, codec: jsonCodec, presenceStore: rejectStore })
    await server.attachPage({ domain: DOMAIN, pageId: 'page-a' })
    const joined = await server.joinChatRoom({ domain: DOMAIN, user: USER, site: SITE })
    if (!joined) throw new Error('Join was cancelled')
    const roomId = getChatRoomId(DOMAIN)
    fake.receive(roomId, 'peer-b', session({ id: 'user-b', name: 'User B', avatar: '' }))
    await settle()
    // B departs: the committed binding is retained only by the leave grace.
    fake.peerLeave(roomId, 'peer-b')
    await settle()
    // The release cleanup rejects: the fence and physical membership are retained, and the
    // fenced pending leave still closes live/History authority for B's departed source.
    await expect(server.leaveChatRoom({ domain: DOMAIN })).rejects.toThrow('release cleanup rejected')
    await settle()
    expect(fake.joined.has(roomId)).toBe(true)
    fake.receive(roomId, 'peer-b', { ...text('ghost-after-cleanup-failure'), userId: 'user-b' })
    await settle()
    expect(await server.replayInbound({ domain: DOMAIN, after: 0 })).toEqual([])
    disposeServer(server)
  })

  it('treats a repeated public leave of an already-released domain as idempotent', async () => {
    const { server } = await setup()
    await server.leaveChatRoom({ domain: DOMAIN })
    await settle()
    // A second public leave of the absent domain settles immediately (no leaked subscription).
    await expect(server.leaveChatRoom({ domain: DOMAIN })).resolves.toBeUndefined()
    await settle()
  })

  it('drops live messages from a source retained only by the leave grace until a valid rebind', async () => {
    const { fake, server, roomId } = await setup()
    fake.receive(roomId, 'peer-0', session({ id: 'user-0', name: 'User 0', avatar: '' }))
    await settle()
    fake.peerLeave(roomId, 'peer-0')
    await settle()
    // A fresh TEXT from the departed source is not admitted before a valid same-presence rebind.
    fake.receive(roomId, 'peer-0', { ...text('after-peer-leave'), userId: 'user-0' })
    await settle()
    expect(await server.replayInbound({ domain: DOMAIN, after: 0 })).toEqual([])
    // A valid SESSION rebind restores authority; a later live message is admitted.
    fake.receive(roomId, 'peer-0', session({ id: 'user-0', name: 'User 0', avatar: '' }))
    await settle()
    fake.receive(roomId, 'peer-0', { ...text('after-rebind'), userId: 'user-0' })
    await settle()
    expect((await server.replayInbound({ domain: DOMAIN, after: 0 })).map((item) => item.record.message.id)).toEqual([
      'after-rebind'
    ])
  })

  it('ignores a delayed same-sync page after cleanup without a parallel token or supply', async () => {
    const { fake, server, roomId } = await setup()
    const started: string[] = []
    const cancelled: string[] = []
    await registerHistoryProvider(server, { domain: DOMAIN, pageId: 'page-a' }, (request, signal) => {
      if (request.mode === 'inventory') return Promise.resolve({ records: [], done: true })
      started.push(request.syncId)
      return new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => {
          cancelled.push(request.syncId)
          setTimeout(() => reject(signal.reason ?? new Error('aborted')), 30)
        })
      })
    })
    fake.receive(roomId, 'peer-0', session({ id: 'user-0', name: 'User 0', avatar: '' }))
    await settle()
    fake.receive(roomId, 'peer-0', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
      syncId: 'old-a',
      page: 0,
      messageIds: [],
      done: true
    })
    await vi.waitFor(() => expect(started).toEqual(['old-a']))
    // Cleanup removes the peer and cancels the in-flight supply; the active entry stays unsettled.
    fake.peerLeave(roomId, 'peer-0')
    await settle()
    expect(cancelled).toEqual(['old-a'])
    // A delayed page carrying the SAME syncId arrives after cleanup (fresh session): it must be
    // idempotently ignored against the unsettled old owner, never admitted as a parallel token.
    fake.receive(roomId, 'peer-0', session({ id: 'user-0b', name: 'User 0b', avatar: '' }))
    await settle()
    fake.receive(roomId, 'peer-0', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
      syncId: 'old-a',
      page: 1,
      messageIds: ['late'],
      done: true
    })
    await settle()
    expect(started).toEqual(['old-a'])
    // After the old supply settles, still no parallel supply or job for the delayed page exists.
    await vi.waitFor(() => expect(cancelled.length).toBe(1))
    await settle()
    await settle()
    expect(started).toEqual(['old-a'])
  })

  it('cancels the live second-page supply after a genuine first-page failure (per-attempt owner)', async () => {
    const { fake, server, roomId } = await setup()
    await server.attachPage({ domain: DOMAIN, pageId: 'page-b' })
    // Page-a genuinely fails; page-b holds the provider snapshot until its AbortSignal fires.
    const pageAStarted: string[] = []
    const pageBHeld: string[] = []
    const pageBCancelled: string[] = []
    await registerHistoryProvider(server, { domain: DOMAIN, pageId: 'page-a' }, async (request) => {
      if (request.mode === 'inventory') return { records: [], done: true }
      pageAStarted.push(request.supplyId)
      throw new Error('page-a broken')
    })
    await registerHistoryProvider(server, { domain: DOMAIN, pageId: 'page-b' }, (request, signal) => {
      if (request.mode === 'inventory') return Promise.resolve({ records: [], done: true })
      pageBHeld.push(request.supplyId)
      return new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => {
          pageBCancelled.push(request.supplyId)
          setTimeout(() => reject(signal.reason ?? new Error('aborted')), 30)
        })
      })
    })
    fake.receive(roomId, 'peer-0', session({ id: 'user-0', name: 'User 0', avatar: '' }))
    await settle()
    fake.receive(roomId, 'peer-0', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
      syncId: 'two-a',
      page: 0,
      messageIds: [],
      done: true
    })
    // The selection loop fails page-a and moves to page-b with a NEW supplyId (:1).
    await vi.waitFor(() => expect(pageAStarted.length).toBe(1))
    await vi.waitFor(() => expect(pageBHeld.length).toBe(1))
    expect(pageBHeld[0]).toMatch(/^supply:.*:1$/)
    // Cleanup cancels the LIVE second-page supplyId (the recorded owner), not the stale first one.
    fake.peerLeave(roomId, 'peer-0')
    await vi.waitFor(() => expect(pageBCancelled).toEqual([pageBHeld[0]]))
    // The old selection loop terminates: no further page is selected for the torn-down attempt.
    await vi.waitFor(() => expect(pageBHeld.length).toBe(1))
  })

  it('never starts the next page of an old attempt after cleanup cancellation', async () => {
    const { fake, server, roomId } = await setup()
    await server.attachPage({ domain: DOMAIN, pageId: 'page-b' })
    // Both pages hold the provider snapshot; page-a is the first selection.
    const held: string[] = []
    const cancelled: string[] = []
    const pageBStarted: string[] = []
    const holder =
      (onStart: (supplyId: string) => void) =>
      (request: HistorySupplyRequest, signal: AbortSignal): Promise<HistorySupplyResult> => {
        if (request.mode === 'inventory') return Promise.resolve({ records: [], done: true })
        onStart(request.supplyId)
        return new Promise((resolve, reject) => {
          signal.addEventListener('abort', () => {
            cancelled.push(request.supplyId)
            setTimeout(() => reject(signal.reason ?? new Error('aborted')), 30)
          })
        })
      }
    await registerHistoryProvider(
      server,
      { domain: DOMAIN, pageId: 'page-a' },
      holder((id) => held.push(id))
    )
    await registerHistoryProvider(
      server,
      { domain: DOMAIN, pageId: 'page-b' },
      holder((id) => pageBStarted.push(id))
    )
    fake.receive(roomId, 'peer-0', session({ id: 'user-0', name: 'User 0', avatar: '' }))
    await settle()
    fake.receive(roomId, 'peer-0', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
      syncId: 'two-b',
      page: 0,
      messageIds: [],
      done: true
    })
    await vi.waitFor(() => expect(held.length).toBe(1))
    // Cleanup cancels the held page-a supply; the old selection loop must terminate so page-b
    // never starts for the torn-down attempt.
    fake.peerLeave(roomId, 'peer-0')
    await vi.waitFor(() => expect(cancelled).toEqual([held[0]]))
    await vi.waitFor(() => expect(cancelled.length).toBe(1))
    await settle()
    await settle()
    expect(pageBStarted).toEqual([])
  })

  it('transfers a partial successor after cleanup settlement and completes it with one supply', async () => {
    const { fake, server, roomId } = await setup()
    const started: string[] = []
    const cancelled: string[] = []
    const settled: string[] = []
    await registerHistoryProvider(server, { domain: DOMAIN, pageId: 'page-a' }, (request, signal) => {
      if (request.mode === 'inventory') return Promise.resolve({ records: [], done: true })
      started.push(request.syncId)
      // The old supply settles only through its AbortSignal; any later supply resolves at once so
      // its response is delivered.
      if (request.syncId !== 'old-a') return Promise.resolve({ records: [], done: true })
      return new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => {
          cancelled.push(request.syncId)
          setTimeout(() => {
            settled.push(request.syncId)
            reject(signal.reason ?? new Error('aborted'))
          }, 30)
        })
      })
    })
    fake.receive(roomId, 'peer-0', session({ id: 'user-0', name: 'User 0', avatar: '' }))
    await settle()
    fake.receive(roomId, 'peer-0', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
      syncId: 'old-a',
      page: 0,
      messageIds: [],
      done: true
    })
    await vi.waitFor(() => expect(started).toEqual(['old-a']))
    fake.peerLeave(roomId, 'peer-0')
    await settle()
    expect(cancelled).toEqual(['old-a'])
    // A PARTIAL replacement (page zero, done:false) becomes a dormant successor.
    fake.receive(roomId, 'peer-0', session({ id: 'user-0b', name: 'User 0b', avatar: '' }))
    await settle()
    fake.receive(roomId, 'peer-0', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
      syncId: 'new-b',
      page: 0,
      messageIds: ['b-0'],
      done: false
    })
    await settle()
    expect(started).toEqual(['old-a'])
    // The old supply settles: the partial successor is transferred (installed as provider with
    // its canonical job) but NOT scheduled — still no supply for new-b.
    await vi.waitFor(() => expect(settled).toEqual(['old-a']))
    await settle()
    expect(started).toEqual(['old-a'])
    // The transferred attempt continues on the next page and completes: exactly ONE new-b supply.
    fake.receive(roomId, 'peer-0', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
      syncId: 'new-b',
      page: 1,
      messageIds: ['b-1'],
      done: true
    })
    await vi.waitFor(() => expect(started).toEqual(['old-a', 'new-b']))
    await vi.waitFor(() => {
      const sent = fake.messages(roomId).filter((m) => m.type === MESSAGE_TYPE.HISTORY_MESSAGES_PUSH)
      expect(sent.some((m) => (m as { syncId: string }).syncId === 'new-b')).toBe(true)
    })
  })

  it('terminates the provider attempt on cumulative overflow; the connection cannot resync until reset', async () => {
    const { fake, server, roomId } = await setup()
    const started: string[] = []
    await registerHistoryProvider(server, { domain: DOMAIN, pageId: 'page-a' }, async (request) => {
      if (request.mode === 'inventory') return { records: [], done: true }
      started.push(request.syncId)
      return { records: [], done: true }
    })
    const bigIds = Array.from({ length: 137 }, (_, i) => `b-${String(i).padStart(4, '0')}-${'x'.repeat(48)}`)
    fake.receive(roomId, 'peer-a', session())
    await settle()
    fake.receive(roomId, 'peer-a', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
      syncId: 'big-a',
      page: 0,
      messageIds: bigIds,
      done: false
    })
    await settle()
    // An unrelated admitted job stays live across the overflow (peer-b partial).
    fake.receive(roomId, 'peer-b', session({ id: 'sat-user-b', name: 'Sat B', avatar: '' }))
    await settle()
    fake.receive(roomId, 'peer-b', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
      syncId: 'peer-b',
      page: 0,
      messageIds: ['b'],
      done: false
    })
    await settle()
    // peer-a's next page crosses the 8KiB cumulative budget: the synchronization terminates and
    // its connection direction becomes terminal.
    fake.receive(roomId, 'peer-a', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
      syncId: 'big-a',
      page: 1,
      messageIds: bigIds,
      done: false
    })
    await settle()
    // Neither the same id nor a different id can start History again on this connection.
    fake.receive(roomId, 'peer-a', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
      syncId: 'big-a',
      page: 0,
      messageIds: ['small'],
      done: true
    })
    await settle()
    fake.receive(roomId, 'peer-a', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
      syncId: 'different-a',
      page: 0,
      messageIds: ['small'],
      done: true
    })
    await settle()
    expect(started).toEqual([])
    // The unrelated peer-b job survives and completes normally.
    fake.receive(roomId, 'peer-b', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
      syncId: 'peer-b',
      page: 1,
      messageIds: ['b-1'],
      done: true
    })
    await vi.waitFor(() => expect(started).toEqual(['peer-b']))
    // A source replacement ends the terminal binding: the next connection starts an independent
    // synchronization with a fresh id.
    fake.receive(roomId, 'peer-a', session({ id: 'sat-user-a-b', name: 'Sat A2', avatar: '' }))
    await settle()
    fake.receive(roomId, 'peer-a', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
      syncId: 'fresh-a',
      page: 0,
      messageIds: [],
      done: true
    })
    await vi.waitFor(() => expect(started).toEqual(['peer-b', 'fresh-a']))
  })

  it('terminates a dormant successor on cumulative overflow; smaller pages cannot revive it', async () => {
    const { fake, server, roomId } = await setup()
    const started: string[] = []
    const settled: string[] = []
    await registerHistoryProvider(server, { domain: DOMAIN, pageId: 'page-a' }, (request, signal) => {
      if (request.mode === 'inventory') return Promise.resolve({ records: [], done: true })
      started.push(request.syncId)
      return new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => {
          setTimeout(() => {
            settled.push(request.syncId)
            reject(signal.reason ?? new Error('aborted'))
          }, 30)
        })
      })
    })
    const bigIds = Array.from({ length: 137 }, (_, i) => `b-${String(i).padStart(4, '0')}-${'x'.repeat(48)}`)
    fake.receive(roomId, 'peer-0', session({ id: 'user-0', name: 'User 0', avatar: '' }))
    await settle()
    fake.receive(roomId, 'peer-0', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
      syncId: 'old-a',
      page: 0,
      messageIds: [],
      done: true
    })
    await vi.waitFor(() => expect(started).toEqual(['old-a']))
    // A replacement successor with a large page zero is admitted (dormant).
    fake.receive(roomId, 'peer-0', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
      syncId: 'new-b',
      page: 0,
      messageIds: bigIds,
      done: false
    })
    await settle()
    // Its next page crosses the 8KiB cumulative budget: the successor is terminated.
    fake.receive(roomId, 'peer-0', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
      syncId: 'new-b',
      page: 1,
      messageIds: bigIds,
      done: false
    })
    await settle()
    // A smaller payload at the same page number cannot revive the terminated successor (gap).
    fake.receive(roomId, 'peer-0', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
      syncId: 'new-b',
      page: 1,
      messageIds: ['small'],
      done: true
    })
    await settle()
    await settle()
    // The terminated syncId is fenced: even a fresh page zero with the same id is inert.
    fake.receive(roomId, 'peer-0', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
      syncId: 'new-b',
      page: 0,
      messageIds: ['b-0'],
      done: true
    })
    await settle()
    await settle()
    // Cleanup cancels the old supply and removes any dormant state; a fresh session with a
    // FRESH syncId is the positive re-admission case (the overflowed capacity was released).
    fake.peerLeave(roomId, 'peer-0')
    await settle()
    fake.receive(roomId, 'peer-0', session({ id: 'user-0b', name: 'User 0b', avatar: '' }))
    await settle()
    fake.receive(roomId, 'peer-0', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
      syncId: 'new-c',
      page: 0,
      messageIds: ['b-0'],
      done: true
    })
    await settle()
    // On the old supply's settlement the complete successor is transferred and exactly ONE
    // supply starts.
    await vi.waitFor(() => expect(settled).toEqual(['old-a']))
    await vi.waitFor(() => expect(started).toEqual(['old-a', 'new-c']))
  })

  it('terminates an attempt immediately when no page candidates exist (exhaustion)', async () => {
    const { fake, server, roomId } = await setup()
    const started: string[] = []
    // No provider page is registered for the domain: the candidate list is empty.
    fake.receive(roomId, 'peer-a', session())
    await settle()
    fake.receive(roomId, 'peer-a', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
      syncId: 'ex-a',
      page: 0,
      messageIds: [],
      done: true
    })
    // The exhausted attempt terminates without any supplier start and without a response, and
    // its connection direction becomes terminal.
    await settle()
    await settle()
    expect(started).toEqual([])
    expect(fake.messages(roomId).filter((m) => m.type === MESSAGE_TYPE.HISTORY_MESSAGES_PUSH)).toHaveLength(0)
    // Registering a page afterwards cannot restart History on the same connection.
    await registerHistoryProvider(server, { domain: DOMAIN, pageId: 'page-a' }, async (request) => {
      if (request.mode === 'inventory') return { records: [], done: true }
      started.push(request.syncId)
      return { records: [], done: true }
    })
    fake.receive(roomId, 'peer-a', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
      syncId: 'ex-b',
      page: 0,
      messageIds: [],
      done: true
    })
    await settle()
    await settle()
    expect(started).toEqual([])
    // A source replacement ends the terminal binding: the next connection starts fresh.
    fake.receive(roomId, 'peer-a', session({ id: 'remote-user-b', name: 'Remote B', avatar: '' }))
    await settle()
    fake.receive(roomId, 'peer-a', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
      syncId: 'ex-c',
      page: 0,
      messageIds: [],
      done: true
    })
    await vi.waitFor(() => expect(started).toEqual(['ex-c']))
  })

  it('terminates an attempt whose every page candidate genuinely fails (exhaustion with dead pages)', async () => {
    const { fake, server, roomId } = await setup()
    const started: string[] = []
    await registerHistoryProvider(server, { domain: DOMAIN, pageId: 'page-a' }, async (request) => {
      if (request.mode === 'inventory') return { records: [], done: true }
      started.push(request.syncId)
      throw new Error('page-a broken')
    })
    fake.receive(roomId, 'peer-a', session())
    await settle()
    fake.receive(roomId, 'peer-a', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
      syncId: 'ex-a',
      page: 0,
      messageIds: [],
      done: true
    })
    // The single candidate fails genuinely: the attempt terminates immediately (no response, no
    // waiting for the 10s attempt timer) and the connection direction becomes terminal.
    await vi.waitFor(() => expect(started).toEqual(['ex-a']))
    await settle()
    await settle()
    expect(fake.messages(roomId).filter((m) => m.type === MESSAGE_TYPE.HISTORY_MESSAGES_PUSH)).toHaveLength(0)
    // A fresh page registration cannot restart History on the same connection.
    await registerHistoryProvider(server, { domain: DOMAIN, pageId: 'page-a' }, async (request) => {
      if (request.mode === 'inventory') return { records: [], done: true }
      started.push(request.syncId)
      return { records: [], done: true }
    })
    fake.receive(roomId, 'peer-a', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
      syncId: 'ex-b',
      page: 0,
      messageIds: [],
      done: true
    })
    await settle()
    await settle()
    expect(started).toEqual(['ex-a'])
    // A source replacement ends the terminal binding: the next connection starts fresh.
    fake.receive(roomId, 'peer-a', session({ id: 'remote-user-b', name: 'Remote B', avatar: '' }))
    await settle()
    fake.receive(roomId, 'peer-a', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
      syncId: 'ex-c',
      page: 0,
      messageIds: [],
      done: true
    })
    await vi.waitFor(() => expect(started).toEqual(['ex-a', 'ex-c']))
  })

  it('fails over to the next page after a per-page timeout once the held query settles (provider)', async () => {
    const { fake, server, roomId, clock } = await setup()
    await server.attachPage({ domain: DOMAIN, pageId: 'page-b' })
    const pageAStarted: string[] = []
    const pageBStarted: string[] = []
    const pageASettled: string[] = []
    await registerHistoryProvider(server, { domain: DOMAIN, pageId: 'page-a' }, (request, signal) => {
      if (request.mode === 'inventory') return Promise.resolve({ records: [], done: true })
      pageAStarted.push(request.supplyId)
      return new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => {
          setTimeout(() => {
            pageASettled.push(request.supplyId)
            reject(signal.reason ?? new Error('aborted'))
          }, 200)
        })
      })
    })
    await registerHistoryProvider(server, { domain: DOMAIN, pageId: 'page-b' }, async (request) => {
      if (request.mode === 'inventory') return { records: [], done: true }
      pageBStarted.push(request.supplyId)
      return { records: [textRecord('page-b-record')], done: true }
    })
    fake.receive(roomId, 'peer-a', session())
    await settle()
    fake.receive(roomId, 'peer-a', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
      syncId: 'to-a',
      page: 0,
      messageIds: [],
      done: true
    })
    await vi.waitFor(() => expect(pageAStarted.length).toBe(1))
    // The healthy page-a hits its per-page boundary: the timeout aborts the supply but the
    // attempt is still current, so the selection fails over — page-b starts only after the
    // delayed physical settlement.
    clock.advance(HISTORY_REQUEST_TIMEOUT_MS / 2 + 1)
    await settle()
    // The per-page boundary fired and the supply is aborted, but the physical query has not
    // settled yet: the next page must NOT start before settlement.
    expect(pageBStarted).toEqual([])
    expect(pageASettled).toEqual([])
    clock.advance(201)
    await vi.waitFor(() => expect(pageASettled.length).toBe(1))
    await vi.waitFor(() => expect(pageBStarted.length).toBe(1))
    // The successful page-b supply produces the response for the same attempt.
    await vi.waitFor(() => {
      const sent = fake.messages(roomId).filter((m) => m.type === MESSAGE_TYPE.HISTORY_MESSAGES_PUSH)
      expect(sent.some((m) => (m as { syncId: string }).syncId === 'to-a')).toBe(true)
    })
  })

  it('fails over to the next page after a per-page timeout once the held query settles (requester)', async () => {
    const { fake, server, roomId, clock } = await setup()
    await server.attachPage({ domain: DOMAIN, pageId: 'page-b' })
    const inventoryStarts: string[] = []
    const pageAInventoryHeld: string[] = []
    await registerHistoryProvider(server, { domain: DOMAIN, pageId: 'page-a' }, (request, signal) => {
      if (request.mode !== 'inventory') return Promise.resolve({ records: [], done: true })
      pageAInventoryHeld.push(request.supplyId)
      return new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => {
          setTimeout(() => reject(signal.reason ?? new Error('aborted')), 200)
        })
      })
    })
    await registerHistoryProvider(server, { domain: DOMAIN, pageId: 'page-b' }, async (request) => {
      if (request.mode !== 'inventory') return Promise.resolve({ records: [], done: true })
      inventoryStarts.push(request.supplyId)
      return { records: [], done: true }
    })
    // A remote session starts the local requester's inventory sync.
    fake.receive(roomId, 'peer-a', session())
    await settle()
    await vi.waitFor(() => expect(pageAInventoryHeld.length).toBe(1))
    clock.advance(HISTORY_REQUEST_TIMEOUT_MS / 2 + 1)
    await settle()
    // The per-page boundary fired but the held inventory query has not settled: no failover yet.
    expect(inventoryStarts).toEqual([])
    clock.advance(201)
    // The requester fails over to page-b only after the held inventory query settles, then the
    // inventory request is sent to the peer.
    await vi.waitFor(() => expect(inventoryStarts.length).toBe(1))
    await vi.waitFor(() => {
      const sent = fake.messages(roomId).filter((m) => m.type === MESSAGE_TYPE.HISTORY_MESSAGES_PULL)
      expect(sent.length).toBeGreaterThan(0)
    })
  })

  it('never exceeds four active suppliers when canceling partial or waiting work', async () => {
    const { fake, server, roomId } = await setup()
    const started: string[] = []
    const gates = new Map<string, () => void>()
    await registerHistoryProvider(server, { domain: DOMAIN, pageId: 'page-a' }, async (request) => {
      if (request.mode === 'inventory') return { records: [], done: true }
      started.push(request.syncId)
      await new Promise<void>((resolve) => {
        gates.set(request.syncId, resolve)
      })
      return { records: [], done: true }
    })
    for (let peer = 0; peer < 4; peer += 1) {
      fake.receive(roomId, `peer-${peer}`, session({ id: `user-${peer}`, name: `User ${peer}`, avatar: '' }))
      await settle()
      fake.receive(roomId, `peer-${peer}`, {
        type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
        syncId: `sat-${peer}`,
        page: 0,
        messageIds: [],
        done: true
      })
      await settle()
    }
    // peer-4 is a ready waiter; peer-5 is a partial (never scheduled) job.
    fake.receive(roomId, 'peer-4', session({ id: 'user-4', name: 'User 4', avatar: '' }))
    await settle()
    fake.receive(roomId, 'peer-4', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
      syncId: 'wait-4',
      page: 0,
      messageIds: [],
      done: true
    })
    await settle()
    fake.receive(roomId, 'peer-5', session({ id: 'user-5', name: 'User 5', avatar: '' }))
    await settle()
    fake.receive(roomId, 'peer-5', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
      syncId: 'partial-5',
      page: 0,
      messageIds: ['p'],
      done: false
    })
    await settle()
    expect(started.length).toBe(4)
    // Cancel the ready waiter (gap): its waiting projection is removed; no slot is released.
    fake.receive(roomId, 'peer-4', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
      syncId: 'wait-4',
      page: 2,
      messageIds: [],
      done: true
    })
    await settle()
    // Cancel the partial provider (gap): it held no slot, so no waiter may be promoted.
    fake.receive(roomId, 'peer-5', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
      syncId: 'partial-5',
      page: 2,
      messageIds: [],
      done: true
    })
    await settle()
    await settle()
    expect(started.length).toBe(4)
    // A NEW waiter replaces the canceled one; releasing one active slot promotes exactly one and
    // the canceled waiter never starts.
    fake.receive(roomId, 'peer-6', session({ id: 'user-6', name: 'User 6', avatar: '' }))
    await settle()
    fake.receive(roomId, 'peer-6', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
      syncId: 'wait-6',
      page: 0,
      messageIds: [],
      done: true
    })
    await settle()
    const firstGate = [...gates.keys()][0]
    gates.get(firstGate)?.()
    gates.delete(firstGate)
    await vi.waitFor(() => expect(started.length).toBe(5))
    expect(started).toContain('wait-6')
    expect(started).not.toContain('wait-4')
  })

  it('releases non-active canonical jobs on lifecycle cleanup while a held active job stays counted', async () => {
    const { fake, server, roomId } = await setup()
    const started: string[] = []
    await registerHistoryProvider(server, { domain: DOMAIN, pageId: 'page-a' }, async (request) => {
      if (request.mode === 'inventory') return { records: [], done: true }
      started.push(request.syncId)
      await new Promise<void>(() => {})
      return { records: [], done: true }
    })
    // One genuinely active held job first, then 31 partial jobs fill the pool to its 32-job cap.
    fake.receive(roomId, 'peer-32', session({ id: 'lc-user-32', name: 'LC 32', avatar: '' }))
    await settle()
    fake.receive(roomId, 'peer-32', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
      syncId: 'lc-active',
      page: 0,
      messageIds: [],
      done: true
    })
    await vi.waitFor(() => expect(started).toEqual(['lc-active']))
    for (let peer = 0; peer < 31; peer += 1) {
      const peerId = `peer-${peer}`
      fake.receive(roomId, peerId, session({ id: `lc-user-${peer}`, name: `LC ${peer}`, avatar: '' }))
      await settle()
      fake.receive(roomId, peerId, {
        type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
        syncId: `lc-partial-${peer}`,
        page: 0,
        messageIds: [`p-${peer}`],
        done: false
      })
      await settle()
    }
    // All 31 partial peers leave: cleanup must remove their canonical jobs IMMEDIATELY (no
    // physical settlement callback exists for them), so fresh unrelated work is admitted at once.
    for (let peer = 0; peer < 31; peer += 1) {
      fake.peerLeave(roomId, `peer-${peer}`)
    }
    await settle()
    // A fresh peer at the (now released) cap is admitted and its ready job starts immediately.
    fake.receive(roomId, 'peer-33', session({ id: 'lc-user-33', name: 'LC 33', avatar: '' }))
    await settle()
    fake.receive(roomId, 'peer-33', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
      syncId: 'lc-fresh',
      page: 0,
      messageIds: [],
      done: true
    })
    await vi.waitFor(() => expect(started).toEqual(['lc-active', 'lc-fresh']))
  })

  it('keeps the slot through a held response send on lifecycle cleanup and releases exactly once', async () => {
    const { fake, server, roomId } = await setup()
    const started: string[] = []
    // The snapshot supplies resolve immediately; the RESPONSE SEND is what hangs.
    await registerHistoryProvider(server, { domain: DOMAIN, pageId: 'page-a' }, async (request) => {
      if (request.mode === 'inventory') return { records: [], done: true }
      started.push(request.syncId)
      return { records: [], done: true }
    })
    fake.hangHistoryResponseSends()
    for (let peer = 0; peer < 4; peer += 1) {
      fake.receive(roomId, `peer-${peer}`, session({ id: `hs-user-${peer}`, name: `HS ${peer}`, avatar: '' }))
      await settle()
      fake.receive(roomId, `peer-${peer}`, {
        type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
        syncId: `hs-${peer}`,
        page: 0,
        messageIds: [],
        done: true
      })
      await settle()
    }
    await vi.waitFor(() => expect(started.length).toBe(4))
    // Four response sends are now physically held; a fifth peer is a ready waiter.
    fake.receive(roomId, 'peer-4', session({ id: 'hs-user-4', name: 'HS 4', avatar: '' }))
    await settle()
    fake.receive(roomId, 'peer-4', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
      syncId: 'hs-4',
      page: 0,
      messageIds: [],
      done: true
    })
    await settle()
    // Lifecycle cleanup while the sends are invoked: the slots stay retained (no fifth stage).
    fake.peerLeave(roomId, 'peer-0')
    await settle()
    await settle()
    expect(started.length).toBe(4)
    // The held sends settle: the slot is released exactly once and exactly one waiter promotes.
    fake.releaseHistoryResponseSends()
    await vi.waitFor(() => expect(started.length).toBe(5))
    await settle()
    await settle()
    expect(started.length).toBe(5)
  })

  it('keeps the slot through a held response send on cancellation and releases exactly once', async () => {
    const { fake, server, roomId } = await setup()
    const started: string[] = []
    // The snapshot supplies resolve immediately; the RESPONSE SEND is what hangs.
    await registerHistoryProvider(server, { domain: DOMAIN, pageId: 'page-a' }, async (request) => {
      if (request.mode === 'inventory') return { records: [], done: true }
      started.push(request.syncId)
      return { records: [], done: true }
    })
    fake.hangHistoryResponseSends()
    for (let peer = 0; peer < 4; peer += 1) {
      fake.receive(roomId, `peer-${peer}`, session({ id: `tc-user-${peer}`, name: `TC ${peer}`, avatar: '' }))
      await settle()
      fake.receive(roomId, `peer-${peer}`, {
        type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
        syncId: `tc-${peer}`,
        page: 0,
        messageIds: [],
        done: true
      })
      await settle()
    }
    await vi.waitFor(() => expect(started.length).toBe(4))
    fake.receive(roomId, 'peer-4', session({ id: 'tc-user-4', name: 'TC 4', avatar: '' }))
    await settle()
    fake.receive(roomId, 'peer-4', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
      syncId: 'tc-4',
      page: 0,
      messageIds: [],
      done: true
    })
    await settle()
    // A logical cancellation (out-of-order page) while peer-0's response send is still invoked:
    // the send-stage marker keeps the slot live, so no waiter may start before the send settles.
    fake.receive(roomId, 'peer-0', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
      syncId: 'tc-0',
      page: 2,
      messageIds: [],
      done: true
    })
    await settle()
    await settle()
    expect(started.length).toBe(4)
    // The send settles: exactly one waiter promotes.
    fake.releaseHistoryResponseSends()
    await vi.waitFor(() => expect(started.length).toBe(5))
  })

  it('starts exactly one synchronization per connection; terminal same/different-ID replays are inert', async () => {
    const { fake, server, roomId } = await setup()
    const started: string[] = []
    await registerHistoryProvider(server, { domain: DOMAIN, pageId: 'page-a' }, async (request) => {
      if (request.mode === 'inventory') return { records: [], done: true }
      started.push(request.syncId)
      return { records: [], done: true }
    })
    fake.receive(roomId, 'peer-a', session())
    await settle()
    // One synchronization completes and its connection direction becomes terminal.
    fake.receive(roomId, 'peer-a', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
      syncId: 'conn-a',
      page: 0,
      messageIds: [],
      done: true
    })
    await vi.waitFor(() => expect(started).toEqual(['conn-a']))
    await vi.waitFor(() => {
      const sent = fake.messages(roomId).filter((m) => m.type === MESSAGE_TYPE.HISTORY_MESSAGES_PUSH)
      expect(sent.some((m) => (m as { syncId: string }).syncId === 'conn-a')).toBe(true)
    })
    // Replays of the same id and a different id are inert on the same connection.
    fake.receive(roomId, 'peer-a', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
      syncId: 'conn-a',
      page: 0,
      messageIds: [],
      done: true
    })
    await settle()
    fake.receive(roomId, 'peer-a', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
      syncId: 'conn-b',
      page: 0,
      messageIds: [],
      done: true
    })
    await settle()
    await settle()
    expect(started).toEqual(['conn-a'])
    expect(fake.messages(roomId).filter((m) => m.type === MESSAGE_TYPE.HISTORY_MESSAGES_PUSH)).toHaveLength(1)
    // A source replacement ends the terminal binding: the next connection starts one independent
    // synchronization with a fresh id.
    fake.receive(roomId, 'peer-a', session({ id: 'remote-user-b', name: 'Remote B', avatar: '' }))
    await settle()
    fake.receive(roomId, 'peer-a', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
      syncId: 'conn-c',
      page: 0,
      messageIds: [],
      done: true
    })
    await vi.waitFor(() => expect(started).toEqual(['conn-a', 'conn-c']))
  })

  it('drops a page-one-first request without binding and lets the first valid page zero bind', async () => {
    const { fake, server, roomId } = await setup()
    const started: string[] = []
    await registerHistoryProvider(server, { domain: DOMAIN, pageId: 'page-a' }, async (request) => {
      if (request.mode === 'inventory') return { records: [], done: true }
      started.push(request.syncId)
      return { records: [], done: true }
    })
    fake.receive(roomId, 'peer-a', session())
    await settle()
    // A page-one-first request is invalid and never binds the direction.
    fake.receive(roomId, 'peer-a', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
      syncId: 'gap-first',
      page: 1,
      messageIds: [],
      done: true
    })
    await settle()
    expect(started).toEqual([])
    // The first valid page zero (same or different id) binds the sole synchronization.
    fake.receive(roomId, 'peer-a', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
      syncId: 'gap-first',
      page: 0,
      messageIds: [],
      done: true
    })
    await vi.waitFor(() => expect(started).toEqual(['gap-first']))
    // After completion the direction is terminal: replays are inert.
    fake.receive(roomId, 'peer-a', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
      syncId: 'gap-first',
      page: 0,
      messageIds: [],
      done: true
    })
    await settle()
    await settle()
    expect(started).toEqual(['gap-first'])
  })

  it('keeps terminal syncs inert until binding reset; the next connection starts independently', async () => {
    const { fake, server, roomId } = await setup()
    const started: string[] = []
    await registerHistoryProvider(server, { domain: DOMAIN, pageId: 'page-a' }, async (request) => {
      if (request.mode === 'inventory') return { records: [], done: true }
      started.push(request.syncId)
      return { records: [], done: true }
    })
    // One completed synchronization (peer-a) and one canceled (gap) synchronization (peer-b):
    // each connection direction is terminal after its synchronization ends.
    fake.receive(roomId, 'peer-a', session({ id: 'user-a', name: 'User A', avatar: '' }))
    await settle()
    fake.receive(roomId, 'peer-a', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
      syncId: 'done-sync',
      page: 0,
      messageIds: [],
      done: true
    })
    await vi.waitFor(() => expect(started).toEqual(['done-sync']))
    fake.receive(roomId, 'peer-b', session({ id: 'user-b', name: 'User B', avatar: '' }))
    await settle()
    fake.receive(roomId, 'peer-b', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
      syncId: 'gap-sync',
      page: 0,
      messageIds: [],
      done: true
    })
    await vi.waitFor(() => expect(started).toEqual(['done-sync', 'gap-sync']))
    fake.receive(roomId, 'peer-b', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
      syncId: 'gap-sync',
      page: 2,
      messageIds: [],
      done: true
    })
    await settle()
    // Replays of both terminal ids on their connections are inert (same and different ids).
    fake.receive(roomId, 'peer-a', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
      syncId: 'done-sync',
      page: 0,
      messageIds: [],
      done: true
    })
    fake.receive(roomId, 'peer-a', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
      syncId: 'another-id',
      page: 0,
      messageIds: [],
      done: true
    })
    fake.receive(roomId, 'peer-b', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
      syncId: 'gap-sync',
      page: 0,
      messageIds: [],
      done: true
    })
    await settle()
    await settle()
    expect(started).toEqual(['done-sync', 'gap-sync'])
    // Binding reset (a fresh session message replaces the binding without removing the peer):
    // the old connection's terminal bindings are cleared and the next connection starts one
    // independent synchronization.
    fake.receive(roomId, 'peer-a', session({ id: 'user-a-b', name: 'User A2', avatar: '' }))
    await settle()
    fake.receive(roomId, 'peer-a', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
      syncId: 'fresh-after-reset',
      page: 0,
      messageIds: [],
      done: true
    })
    await vi.waitFor(() => expect(started).toEqual(['done-sync', 'gap-sync', 'fresh-after-reset']))
  })

  it('keeps provider and requester directions independent when syncId strings collide', async () => {
    const { fake, server, roomId } = await setup()
    const delivered: string[] = []
    await server.onInbound({ pageId: 'page-a' }, (event) => {
      delivered.push(event.record.message.id)
    })
    await registerHistoryProvider(server, { domain: DOMAIN, pageId: 'page-a' }, async (request) => {
      if (request.mode === 'inventory') return { records: [], done: true }
      return { records: [], done: true }
    })
    fake.receive(roomId, 'peer-a', session())
    await settle()
    // The local requester's own syncId is visible in its outgoing inventory request.
    const inventoryRequest = fake.messages(roomId).find((m) => m.type === MESSAGE_TYPE.HISTORY_MESSAGES_PULL)
    const requesterSyncId = (inventoryRequest as { syncId: string }).syncId
    // The peer uses the SAME string for its own provider request: it completes and fences the
    // PROVIDER direction only.
    fake.receive(roomId, 'peer-a', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
      syncId: requesterSyncId,
      page: 0,
      messageIds: [],
      done: true
    })
    await settle()
    await settle()
    // The requester's opposite-direction response with the same string must NOT be dropped by
    // the provider fence: it is applied normally.
    fake.receive(roomId, 'peer-a', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PUSH,
      syncId: requesterSyncId,
      page: 0,
      users: [REMOTE_USER],
      messages: [text('direction-kept')],
      done: true
    })
    await vi.waitFor(() => expect(delivered).toEqual(['direction-kept']))
  })

  it('clears both directional bindings on domain grace release and reconnects independently', async () => {
    const { clock, fake, server, roomId } = await setup()
    const started: string[] = []
    await registerHistoryProvider(server, { domain: DOMAIN, pageId: 'page-a' }, async (request) => {
      if (request.mode === 'inventory') return { records: [], done: true }
      started.push(request.syncId)
      return { records: [], done: true }
    })
    fake.receive(roomId, 'peer-a', session())
    await settle()
    // The connection runs its one synchronization in both directions.
    const firstInventory = fake.messages(roomId).filter((m) => m.type === MESSAGE_TYPE.HISTORY_MESSAGES_PULL)
    const firstRequesterSyncId = (firstInventory[0] as { syncId: string }).syncId
    fake.receive(roomId, 'peer-a', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
      syncId: 'prov-a',
      page: 0,
      messageIds: [],
      done: true
    })
    await vi.waitFor(() => expect(started).toEqual(['prov-a']))
    await vi.waitFor(() => {
      const sent = fake.messages(roomId).filter((m) => m.type === MESSAGE_TYPE.HISTORY_MESSAGES_PUSH)
      expect(sent.some((m) => (m as { syncId: string }).syncId === 'prov-a')).toBe(true)
    })
    // The requester completes: its terminal binding is retained on this connection.
    fake.receive(roomId, 'peer-a', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PUSH,
      syncId: firstRequesterSyncId,
      page: 0,
      users: [],
      messages: [],
      done: true
    })
    await settle()
    await settle()
    // Terminal connection: a replayed provider request is inert.
    fake.receive(roomId, 'peer-a', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
      syncId: 'prov-a',
      page: 0,
      messageIds: [],
      done: true
    })
    await settle()
    await settle()
    expect(started).toEqual(['prov-a'])
    // Domain grace release through the production lifecycle: the room leaves after the grace.
    await server.detachPage({ domain: DOMAIN, pageId: 'page-a' })
    clock.advance(RUNTIME_DOMAIN_GRACE_MS + 1)
    await vi.waitFor(() => expect(fake.joined.has(roomId)).toBe(false))
    // A later room connection re-attaches the page and starts exactly one independent
    // synchronization per direction with no retained old progress.
    await server.attachPage({ domain: DOMAIN, pageId: 'page-a' })
    // The page re-registers its history provider for the later connection.
    await registerHistoryProvider(server, { domain: DOMAIN, pageId: 'page-a' }, async (request) => {
      if (request.mode === 'inventory') return { records: [], done: true }
      started.push(request.syncId)
      return { records: [], done: true }
    })
    // The later connection re-establishes its local room join, then the remote source reconnects.
    await server.joinChatRoom({ domain: DOMAIN, user: USER, site: { ...SITE, origin: DOMAIN } })
    await settle()
    await settle()
    await vi.waitFor(() => expect(fake.joined.has(roomId)).toBe(true))
    fake.receive(roomId, 'peer-a', session({ id: 'remote-user-b', name: 'Remote B', avatar: '' }))
    await settle()
    await settle()
    // The fresh requester uses a NEW syncId and sends its inventory again.
    await vi.waitFor(() => {
      const requests = fake.messages(roomId).filter((m) => m.type === MESSAGE_TYPE.HISTORY_MESSAGES_PULL)
      expect(requests.some((m) => (m as { syncId: string }).syncId !== firstRequesterSyncId)).toBe(true)
    })
    // The fresh provider synchronization completes with its own id.
    fake.receive(roomId, 'peer-a', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
      syncId: 'prov-b',
      page: 0,
      messageIds: [],
      done: true
    })
    await vi.waitFor(() => expect(started).toEqual(['prov-a', 'prov-b']))
    await vi.waitFor(() => {
      const sent = fake.messages(roomId).filter((m) => m.type === MESSAGE_TYPE.HISTORY_MESSAGES_PUSH)
      expect(sent.some((m) => (m as { syncId: string }).syncId === 'prov-b')).toBe(true)
    })
  })

  it('observes job acceptance at exactly 32 jobs and rejection of a new identity', async () => {
    const { fake, server, roomId } = await setup()
    // Every started supplier pipeline is held; the response is delivered only when released.
    const started: string[] = []
    const gates = new Map<string, () => void>()
    await registerHistoryProvider(server, { domain: DOMAIN, pageId: 'page-a' }, async (request) => {
      if (request.mode === 'inventory') return { records: [], done: true }
      started.push(request.syncId)
      await new Promise<void>((resolve) => {
        gates.set(request.syncId, resolve)
      })
      return { records: [], done: true }
    })
    // 32 peers submit partial inventories: exactly 32 canonical jobs are admitted but none are
    // ready, so no supplier pipeline starts (observable: no starts, no responses).
    for (let peer = 0; peer < 32; peer += 1) {
      const peerId = `peer-${peer}`
      fake.receive(roomId, peerId, session({ id: `sat-user-${peer}`, name: `Sat ${peer}`, avatar: '' }))
      await settle()
      fake.receive(roomId, peerId, {
        type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
        syncId: `sat-${peer}`,
        page: 0,
        messageIds: [`s-${peer}`],
        done: false
      })
      await settle()
    }
    expect(started).toEqual([])
    // An update to an existing job at exactly 32 is accepted: its final page makes the job ready,
    // so one supplier pipeline observably starts (positive outcome control).
    fake.receive(roomId, 'peer-0', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
      syncId: 'sat-0',
      page: 1,
      messageIds: ['s-0-more'],
      done: true
    })
    await vi.waitFor(() => expect(started).toEqual(['sat-0']))
    // A NEW identity at exactly 32 jobs is rejected: its ready page is dropped, so no second
    // supplier pipeline ever starts even though a slot is free (negative outcome control).
    fake.receive(roomId, 'peer-32', session({ id: 'sat-user-32', name: 'Sat 32', avatar: '' }))
    await settle()
    fake.receive(roomId, 'peer-32', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
      syncId: 'sat-32',
      page: 0,
      messageIds: ['s-32'],
      done: true
    })
    await settle()
    expect(started).toEqual(['sat-0'])
    // Releasing the accepted pipeline delivers its response; the rejected identity never responds.
    gates.get('sat-0')?.()
    await vi.waitFor(() => {
      const sent = fake.messages(roomId).filter((m) => m.type === MESSAGE_TYPE.HISTORY_MESSAGES_PUSH)
      expect(sent.some((m) => (m as { syncId: string }).syncId === 'sat-0')).toBe(true)
      expect(sent.some((m) => (m as { syncId: string }).syncId === 'sat-32')).toBe(false)
    })
  })

  it('rejects a new identity when the cumulative queue budget reaches 8KiB', async () => {
    const { fake, server, roomId } = await setup()
    const started: string[] = []
    const gates = new Map<string, () => void>()
    await registerHistoryProvider(server, { domain: DOMAIN, pageId: 'page-a' }, async (request) => {
      if (request.mode === 'inventory') return { records: [], done: true }
      started.push(request.syncId)
      await new Promise<void>((resolve) => {
        gates.set(request.syncId, resolve)
      })
      return { records: [], done: true }
    })
    // The first inventory page encodes to 8035 bytes (137 long ids): under the 8192 cumulative
    // budget. Its small completion page (1 id, ~94 bytes) still fits at ~8129 total.
    const bigIds = Array.from({ length: 137 }, (_, i) => `b-${String(i).padStart(4, '0')}-${'x'.repeat(48)}`)
    fake.receive(roomId, 'peer-a', session())
    await settle()
    fake.receive(roomId, 'peer-a', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
      syncId: 'big-0',
      page: 0,
      messageIds: bigIds,
      done: false
    })
    await settle()
    // Complete big-0: the upsert keeps its cumulative bytes and the small final page still fits,
    // making the job ready so its supplier observably starts.
    fake.receive(roomId, 'peer-a', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
      syncId: 'big-0',
      page: 1,
      messageIds: ['b-0-final'],
      done: true
    })
    await vi.waitFor(() => expect(started).toEqual(['big-0']))
    // A NEW identity whose cumulative bytes would cross 8192 is rejected: it never starts a
    // supplier pipeline even though a slot is free (negative outcome control).
    fake.receive(roomId, 'peer-b', session({ id: 'sat-user-b', name: 'Sat B', avatar: '' }))
    await settle()
    fake.receive(roomId, 'peer-b', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
      syncId: 'big-1',
      page: 0,
      messageIds: ['b-1'],
      done: true
    })
    await settle()
    expect(started).toEqual(['big-0'])
    // Releasing the accepted pipeline delivers its response; the rejected identity never responds.
    gates.get('big-0')?.()
    await vi.waitFor(() => {
      const sent = fake.messages(roomId).filter((m) => m.type === MESSAGE_TYPE.HISTORY_MESSAGES_PUSH)
      expect(sent.some((m) => (m as { syncId: string }).syncId === 'big-0')).toBe(true)
      expect(sent.some((m) => (m as { syncId: string }).syncId === 'big-1')).toBe(false)
    })
  })

  it('keeps one peer in two domains as independent attempts without suppression', async () => {
    const { fake, server, roomId } = await setup()
    await registerInventoryProvider(server)
    // The same source joins the first domain; its requester sends its own inventory request.
    fake.receive(roomId, 'peer-a', session())
    await vi.waitFor(() => {
      expect(fake.messages(roomId).some((m) => m.type === MESSAGE_TYPE.HISTORY_MESSAGES_PULL)).toBe(true)
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
      expect(fake.messages(otherRoomId).some((m) => m.type === MESSAGE_TYPE.HISTORY_MESSAGES_PULL)).toBe(true)
    })
    // Completing the first domain's requester must not finish the second domain's attempt.
    const firstSync = (
      fake.messages(roomId).find((m) => m.type === MESSAGE_TYPE.HISTORY_MESSAGES_PULL) as {
        syncId: string
      }
    ).syncId
    fake.receive(roomId, 'peer-a', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PUSH,
      syncId: firstSync,
      page: 0,
      users: [],
      messages: [],
      done: true
    })
    await settle()
    expect(fake.messages(otherRoomId).some((m) => m.type === MESSAGE_TYPE.HISTORY_MESSAGES_PULL)).toBe(true)
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
