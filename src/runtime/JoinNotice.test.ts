import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Remesh } from 'remesh'
import ChatRoomDomain from '@/domain/ChatRoom'
import MessageListDomain from '@/domain/MessageList'
import UserInfoDomain, { type UserInfo } from '@/domain/UserInfo'
import { ChatRoomExtern } from '@/domain/externs/ChatRoom'
import { ReadinessExtern } from '@/domain/externs/Readiness'
import { BrowserSyncStorageExtern, type Storage, type StorageValue } from '@/domain/externs/Storage'
import { createMemoryMessageDatabase } from '@/domain/impls/database/Memory'
import { ChatRoom as RuntimeChatRoom } from '@/domain/impls/runtime/ChatRoom'
import { MessageDatabaseExtern, createMessageStore } from '@/domain/MessageStore'
import { MESSAGE_RECORD_TYPE, NOTICE_TYPE, type NoticeType, type SystemNoticeRecord } from '@/domain/Message'
import type { Clock } from '@/domain/runtime/externs/Clock'
import type { PresenceStore } from '@/domain/runtime/externs/PresenceStore'
import { MESSAGE_TYPE, REACTION_TYPE, type ChatMessage, type ChatUser, type WireCodec } from '@/protocol'
import { createMemoryPresenceStore } from '@/runtime/PresenceStore'
import { createServer, disposeServer, getChatRoomId, getWorldRoomId } from '@/runtime/Server'
import type { RuntimeServer, RuntimeSessionEvent, RuntimeSnapshot } from '@/runtime/Contract'
import type { RoomTransport } from '@/runtime/RoomTransport'

const DOMAIN = 'https://example.test'
const SITE = { origin: DOMAIN, title: 'Example' }
const NOW = 1_800_000_000_000

const jsonCodec: WireCodec = {
  encode: async (value) => JSON.stringify(value),
  decode: async (payload) => JSON.parse(payload)
}

interface Endpoint {
  rooms: Set<string>
  messages: Set<(roomId: string, sourcePeerId: string, payload: string) => void>
  joins: Set<(roomId: string, peerId: string) => void>
  leaves: Set<(roomId: string, peerId: string) => void>
  closes: Set<(roomId: string) => void>
}

interface HeldFrame {
  roomId: string
  sourcePeerId: string
  targetPeerId: string
  payload: string
}

interface HeldSessionEnd {
  notifyStarted(): void
  settled: Promise<void>
}

class DeterministicNetwork {
  private readonly endpoints = new Map<string, Endpoint>()
  private readonly heldDiscoveries = new Set<string>()
  private readonly heldRoutes = new Set<string>()
  private readonly heldFrames: HeldFrame[] = []
  private readonly deliveredFrames: HeldFrame[] = []
  private readonly lifecycleEvents: string[] = []
  private readonly rejectedSessionEnds = new Set<string>()
  private readonly heldSessionEnds = new Map<string, HeldSessionEnd>()
  private readonly announcedPairs = new Set<string>()
  private readonly releaseOnSessionSend = new Map<string, { sourcePeerId: string; targetPeerId: string }>()

  holdSession(sourcePeerId: string, targetPeerId: string) {
    this.heldRoutes.add(`${sourcePeerId}->${targetPeerId}`)
  }

  holdDiscovery(roomId: string, leftPeerId: string, rightPeerId: string) {
    this.heldDiscoveries.add(this.pairKey(roomId, leftPeerId, rightPeerId))
  }

  releaseDiscovery(roomId: string, leftPeerId: string, rightPeerId: string) {
    const pair = this.pairKey(roomId, leftPeerId, rightPeerId)
    this.heldDiscoveries.delete(pair)
    this.announce(roomId, leftPeerId, rightPeerId)
  }

  releaseSessionWhenPeerPublishes(publishingPeerId: string, sourcePeerId: string, targetPeerId: string) {
    this.releaseOnSessionSend.set(publishingPeerId, { sourcePeerId, targetPeerId })
  }

  releaseSession(sourcePeerId: string, targetPeerId: string) {
    const route = `${sourcePeerId}->${targetPeerId}`
    this.heldRoutes.delete(route)
    const frames = this.heldFrames.filter(
      (frame) => frame.sourcePeerId === sourcePeerId && frame.targetPeerId === targetPeerId
    )
    this.heldFrames.splice(
      0,
      this.heldFrames.length,
      ...this.heldFrames.filter((frame) => frame.sourcePeerId !== sourcePeerId || frame.targetPeerId !== targetPeerId)
    )
    frames.forEach((frame) => this.deliver(frame))
  }

  lastSession(sourcePeerId: string) {
    const frame = this.deliveredFrames.findLast(
      (item) =>
        item.sourcePeerId === sourcePeerId &&
        (JSON.parse(item.payload) as { type?: unknown }).type === MESSAGE_TYPE.SESSION
    )
    if (!frame) throw new Error(`Missing SESSION frame from ${sourcePeerId}`)
    return JSON.parse(frame.payload)
  }

  messageCount(sourcePeerId: string, type: string) {
    return this.deliveredFrames.filter(
      (item) => item.sourcePeerId === sourcePeerId && (JSON.parse(item.payload) as { type?: unknown }).type === type
    ).length
  }

  isJoined(peerId: string, roomId: string) {
    return this.endpoints.get(peerId)?.rooms.has(roomId) ?? false
  }

  rejectNextSessionEnd(peerId: string) {
    this.rejectedSessionEnds.add(peerId)
  }

  holdNextSessionEnd(peerId: string) {
    let notifyStarted!: () => void
    const started = new Promise<void>((resolve) => {
      notifyStarted = resolve
    })
    let settle!: () => void
    const settled = new Promise<void>((resolve) => {
      settle = resolve
    })
    this.heldSessionEnds.set(peerId, { notifyStarted, settled })
    return { started, settle }
  }

  recordLifecycle(event: string) {
    this.lifecycleEvents.push(event)
  }

  lifecycle() {
    return [...this.lifecycleEvents]
  }

  disconnectPeer(peerId: string) {
    const endpoint = this.endpoints.get(peerId)
    if (!endpoint) return
    ;[...endpoint.rooms].forEach((roomId) => {
      endpoint.rooms.delete(roomId)
      this.endpoints.forEach((other, otherPeerId) => {
        if (otherPeerId !== peerId && other.rooms.has(roomId)) {
          this.announcedPairs.delete(this.pairKey(roomId, peerId, otherPeerId))
          other.leaves.forEach((listener) => listener(roomId, peerId))
        }
      })
    })
    this.endpoints.delete(peerId)
  }

  redeliverLastMessage(sourcePeerId: string, targetPeerId: string, type: string) {
    const frame = this.deliveredFrames.findLast(
      (item) =>
        item.sourcePeerId === sourcePeerId &&
        item.targetPeerId === targetPeerId &&
        (JSON.parse(item.payload) as { type?: unknown }).type === type
    )
    if (!frame) throw new Error(`Missing ${type} frame ${sourcePeerId}->${targetPeerId}`)
    this.deliver(frame)
  }

  redeliverLastSession(sourcePeerId: string, targetPeerId: string) {
    this.redeliverLastMessage(sourcePeerId, targetPeerId, MESSAGE_TYPE.SESSION)
  }

  transport(peerId: string): RoomTransport {
    const endpoint: Endpoint = {
      rooms: new Set(),
      messages: new Set(),
      joins: new Set(),
      leaves: new Set(),
      closes: new Set()
    }
    this.endpoints.set(peerId, endpoint)

    const subscribe = <Listener>(listeners: Set<Listener>, listener: Listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    }

    return {
      peerId,
      join: async (roomId) => {
        endpoint.rooms.add(roomId)
      },
      leave: (roomId) => {
        if (!endpoint.rooms.delete(roomId)) return
        this.recordLifecycle(`physical-leave:${peerId}:${roomId}`)
        this.endpoints.forEach((other, otherPeerId) => {
          if (otherPeerId !== peerId && other.rooms.has(roomId)) {
            this.announcedPairs.delete(this.pairKey(roomId, peerId, otherPeerId))
            other.leaves.forEach((listener) => listener(roomId, peerId))
          }
        })
      },
      send: async (roomId, payload, to) => {
        const selected = to === undefined ? null : new Set(Array.isArray(to) ? to : [to])
        const parsed = JSON.parse(payload) as { type?: unknown }
        const heldEnd = parsed.type === MESSAGE_TYPE.SESSION_END ? this.heldSessionEnds.get(peerId) : undefined
        if (heldEnd) {
          this.heldSessionEnds.delete(peerId)
          this.recordLifecycle(`session-end-held:${peerId}:${roomId}`)
          heldEnd.notifyStarted()
          await heldEnd.settled
        }
        if (parsed.type === MESSAGE_TYPE.SESSION_END && this.rejectedSessionEnds.delete(peerId)) {
          this.recordLifecycle(`session-end-rejected:${peerId}:${roomId}`)
          throw new Error('session end send rejected')
        }
        this.discover(roomId, peerId)
        await Promise.resolve()
        await Promise.resolve()
        const release = parsed.type === MESSAGE_TYPE.SESSION ? this.releaseOnSessionSend.get(peerId) : undefined
        if (release) {
          this.releaseOnSessionSend.delete(peerId)
          this.releaseSession(release.sourcePeerId, release.targetPeerId)
        }
        this.endpoints.forEach((target, targetPeerId) => {
          if (targetPeerId === peerId || !target.rooms.has(roomId) || (selected && !selected.has(targetPeerId))) return
          const frame = { roomId, sourcePeerId: peerId, targetPeerId, payload }
          const route = `${peerId}->${targetPeerId}`
          if (parsed.type === MESSAGE_TYPE.SESSION && this.heldRoutes.has(route)) this.heldFrames.push(frame)
          else this.deliver(frame)
        })
        if (parsed.type === MESSAGE_TYPE.SESSION_END) {
          this.recordLifecycle(`session-end-settled:${peerId}:${roomId}`)
        }
      },
      onMessage: (listener) => subscribe(endpoint.messages, listener),
      onPeerJoin: (listener) => subscribe(endpoint.joins, listener),
      onPeerLeave: (listener) => subscribe(endpoint.leaves, listener),
      onRoomClose: (listener) => subscribe(endpoint.closes, listener),
      onError: () => () => {},
      dispose: () => {
        ;[...endpoint.rooms].forEach((roomId) => {
          this.endpoints.forEach((other, otherPeerId) => {
            if (otherPeerId !== peerId && other.rooms.has(roomId)) {
              other.leaves.forEach((listener) => listener(roomId, peerId))
            }
          })
        })
        this.endpoints.delete(peerId)
      }
    }
  }

  private discover(roomId: string, peerId: string) {
    const endpoint = this.endpoints.get(peerId)
    if (!endpoint) return
    this.endpoints.forEach((other, otherPeerId) => {
      if (otherPeerId === peerId || !other.rooms.has(roomId)) return
      const pair = this.pairKey(roomId, peerId, otherPeerId)
      if (this.heldDiscoveries.has(pair)) return
      this.announce(roomId, peerId, otherPeerId)
    })
  }

  private announce(roomId: string, leftPeerId: string, rightPeerId: string) {
    const left = this.endpoints.get(leftPeerId)
    const right = this.endpoints.get(rightPeerId)
    const pair = this.pairKey(roomId, leftPeerId, rightPeerId)
    if (!left?.rooms.has(roomId) || !right?.rooms.has(roomId) || this.announcedPairs.has(pair)) return
    this.announcedPairs.add(pair)
    left.joins.forEach((listener) => listener(roomId, rightPeerId))
    right.joins.forEach((listener) => listener(roomId, leftPeerId))
  }

  private pairKey(roomId: string, leftPeerId: string, rightPeerId: string) {
    return `${roomId}:${[leftPeerId, rightPeerId].sort().join(':')}`
  }

  private deliver(frame: HeldFrame) {
    this.deliveredFrames.push(frame)
    this.endpoints
      .get(frame.targetPeerId)
      ?.messages.forEach((listener) => listener(frame.roomId, frame.sourcePeerId, frame.payload))
  }
}

interface ApplicationStack {
  server: RuntimeServer
  adapter: RuntimeChatRoom
  store: ReturnType<typeof Remesh.store>
  sessionEvents: RuntimeSessionEvent[]
  errors: string[]
  join(): Promise<void>
  rejoin(): Promise<void>
  reload(): void
  notices(): Promise<SystemNoticeRecord[]>
  projectedNoticeUsers(): string[]
  crash(): void
  dispose(): Promise<void>
}

let databaseId = 0
const stacks: ApplicationStack[] = []

const userInfo = (user: ChatUser): UserInfo => ({
  ...user,
  createTime: NOW,
  themeMode: 'system',
  danmakuEnabled: true,
  notificationEnabled: true,
  notificationType: 'all'
})

const createStack = async (
  network: DeterministicNetwork,
  peerId: string,
  user: ChatUser,
  options: {
    presenceStore?: PresenceStore
    now?: number
    onAllocateText?: () => void
    onAllocateReaction?: () => void
  } = {}
): Promise<ApplicationStack> => {
  const now = options.now ?? NOW + stacks.length
  const clock: Clock = { now: () => now }
  const server = createServer({
    transport: network.transport(peerId),
    clock,
    codec: jsonCodec,
    presenceStore: options.presenceStore
  })
  const pageId = `page-${peerId}`
  const initialSnapshot = await server.attachPage({ domain: DOMAIN, pageId })
  const database = createMemoryMessageDatabase(`join-notice-${databaseId++}`)
  const messageStore = createMessageStore(database)
  const sessionEvents: RuntimeSessionEvent[] = []
  const errors: string[] = []
  const observedServer: RuntimeServer = {
    ...server,
    allocateTextMessage: (payload) => {
      options.onAllocateText?.()
      return server.allocateTextMessage(payload)
    },
    allocateReactionMessage: (payload) => {
      options.onAllocateReaction?.()
      return server.allocateReactionMessage(payload)
    },
    onSessionEvent: (payload, listener) =>
      server.onSessionEvent(payload, async (event) => {
        sessionEvents.push(event)
        await listener(event)
      })
  }
  let snapshot: RuntimeSnapshot = initialSnapshot
  const adapter = new RuntimeChatRoom({
    server: observedServer,
    messageStore,
    pageDomain: DOMAIN,
    pageId,
    getSnapshot: () => snapshot,
    whenReady: (listener) => {
      listener()
      return () => {}
    }
  })
  adapter.onError((error) => errors.push(error.message))
  const storage: Storage = {
    get: async <Value extends StorageValue>() => userInfo(user) as Value,
    set: async () => {},
    watch: async () => async () => {}
  }
  const store = Remesh.store({
    externs: [
      ChatRoomExtern.impl(adapter),
      ReadinessExtern.impl({ onState: () => () => {} }),
      MessageDatabaseExtern.impl(database),
      BrowserSyncStorageExtern.impl(storage)
    ]
  })
  const roomAction = ChatRoomDomain()
  const listAction = MessageListDomain()
  const userAction = UserInfoDomain()
  const room = store.getDomain(roomAction)
  const list = store.getDomain(listAction)
  const userDomain = store.getDomain(userAction)
  store.igniteDomain(roomAction)
  store.send(userDomain.command.UpdateUserInfoCommand(userInfo(user)))

  let serverDisposed = false
  const stack: ApplicationStack = {
    server,
    adapter,
    store,
    sessionEvents,
    errors,
    join: async () => {
      store.send(room.command.JoinRoomCommand())
      await vi.waitFor(() => expect(store.query(room.query.JoinIsFinishedQuery())).toBe(true))
      snapshot = await server.getSnapshot()
      await vi.waitFor(() => expect(store.query(list.query.LoadIsFinishedQuery())).toBe(true))
    },
    rejoin: async () => {
      await adapter.joinRoom({ user, site: SITE })
      snapshot = await server.getSnapshot()
    },
    reload: () => store.send(list.command.ReloadCommand()),
    notices: async () =>
      (await messageStore.query({ type: MESSAGE_RECORD_TYPE.SYSTEM_NOTICE })).filter(
        (record): record is SystemNoticeRecord => record.type === MESSAGE_RECORD_TYPE.SYSTEM_NOTICE
      ),
    projectedNoticeUsers: () =>
      store
        .query(list.query.ListQuery())
        .flatMap((message) =>
          message.type === MESSAGE_RECORD_TYPE.SYSTEM_NOTICE && message.noticeType === NOTICE_TYPE.JOIN
            ? [message.user.id]
            : []
        ),
    crash: () => {
      if (serverDisposed) return
      serverDisposed = true
      disposeServer(server)
    },
    dispose: async () => {
      store.discard()
      adapter.dispose()
      stack.crash()
      await database.close()
    }
  }
  stacks.push(stack)
  return stack
}

const noticeUsers = async (stack: ApplicationStack, type: NoticeType = NOTICE_TYPE.JOIN) =>
  (await stack.notices()).filter((notice) => notice.notice.type === type).map((notice) => notice.user.id)

const completeInterruptedRelease = async (stack: ApplicationStack, user: ChatUser) => {
  const snapshot = await stack.server.joinChatRoom({ domain: DOMAIN, user, site: SITE })
  expect(snapshot?.domains.find(({ domain }) => domain === DOMAIN)?.localSession?.user.id).toBe(user.id)
  return snapshot
}

const expectFinalReleaseFence = async (
  stack: ApplicationStack,
  network: DeterministicNetwork,
  peerId: string,
  retainedMessage: ChatMessage
) => {
  const textCount = network.messageCount(peerId, MESSAGE_TYPE.TEXT)
  await expect(
    stack.server.allocateTextMessage({ domain: DOMAIN, body: 'blocked during final release', mentions: [] })
  ).rejects.toMatchObject({ name: 'AbortError' })
  await expect(
    stack.server.allocateReactionMessage({
      domain: DOMAIN,
      targetId: retainedMessage.id,
      reaction: 'like',
      active: true
    })
  ).rejects.toMatchObject({ name: 'AbortError' })
  await expect(stack.server.sendChatMessage({ domain: DOMAIN, event: retainedMessage })).rejects.toMatchObject({
    name: 'AbortError'
  })
  expect(network.messageCount(peerId, MESSAGE_TYPE.TEXT)).toBe(textCount)
}

beforeEach(() => {
  vi.stubGlobal('document', {
    location: { origin: DOMAIN },
    title: 'Example',
    querySelector: () => null
  })
})

afterEach(async () => {
  await Promise.all(stacks.splice(0).map((stack) => stack.dispose()))
  vi.unstubAllGlobals()
})

describe('join notice observation baseline', () => {
  it('does not persist an earlier peer join when discovery and SESSION both arrive after local commit', async () => {
    const network = new DeterministicNetwork()
    const a = await createStack(
      network,
      'both-late-peer-a',
      { id: 'both-late-user-a', name: 'A', avatar: '' },
      {
        now: NOW
      }
    )
    const b = await createStack(
      network,
      'both-late-peer-b',
      { id: 'both-late-user-b', name: 'B', avatar: '' },
      {
        now: NOW + 1
      }
    )

    await a.join()
    network.holdDiscovery(getChatRoomId(DOMAIN), 'both-late-peer-a', 'both-late-peer-b')
    await b.join()
    expect(await noticeUsers(b)).toEqual(['both-late-user-b'])

    network.releaseDiscovery(getChatRoomId(DOMAIN), 'both-late-peer-a', 'both-late-peer-b')
    await vi.waitFor(() =>
      expect(
        b.sessionEvents.some((event) =>
          event.snapshot.sessions.some((session) => session.user.id === 'both-late-user-a')
        )
      ).toBe(true)
    )
    await vi.waitFor(async () => expect(await noticeUsers(b)).toEqual(['both-late-user-b']))
    await vi.waitFor(async () =>
      expect(await noticeUsers(a)).toEqual(expect.arrayContaining(['both-late-user-a', 'both-late-user-b']))
    )
  })

  it.each([
    { name: 'SESSION arrives during B preparation', holdBaselineSession: false },
    { name: 'pre-existing SESSION arrives immediately after B commit', holdBaselineSession: true }
  ])('$name', async ({ holdBaselineSession }) => {
    const network = new DeterministicNetwork()
    const a = await createStack(network, 'peer-a', { id: 'user-a', name: 'A', avatar: '' })
    const b = await createStack(network, 'peer-b', { id: 'user-b', name: 'B', avatar: '' })

    await a.join()
    await vi.waitFor(async () => expect(await noticeUsers(a)).toEqual(['user-a']))
    network.holdSession('peer-a', 'peer-b')
    if (!holdBaselineSession) network.releaseSessionWhenPeerPublishes('peer-b', 'peer-a', 'peer-b')

    await b.join()
    await vi.waitFor(async () => expect(await noticeUsers(a)).toEqual(expect.arrayContaining(['user-a', 'user-b'])))
    await vi.waitFor(async () => expect(await noticeUsers(b)).toContain('user-b'))
    if (holdBaselineSession) network.releaseSession('peer-a', 'peer-b')

    await vi.waitFor(() =>
      expect(
        b.sessionEvents.some((event) => event.snapshot.sessions.some((session) => session.user.id === 'user-a'))
      ).toBe(true)
    )
    await vi.waitFor(async () => expect(await noticeUsers(b)).toEqual(['user-b']))

    const c = await createStack(network, 'peer-c', { id: 'user-c', name: 'C', avatar: '' })
    await c.join()
    await vi.waitFor(async () => expect(await noticeUsers(b)).toEqual(expect.arrayContaining(['user-b', 'user-c'])))
    expect((await noticeUsers(a)).filter((id) => id === 'user-b')).toHaveLength(1)
    expect((await noticeUsers(b)).filter((id) => id === 'user-a')).toHaveLength(0)
    expect((await noticeUsers(b)).filter((id) => id === 'user-b')).toHaveLength(1)
    expect((await noticeUsers(b)).filter((id) => id === 'user-c')).toHaveLength(1)

    network.redeliverLastSession('peer-c', 'peer-b')
    b.reload()
    await b.server.attachPage({ domain: DOMAIN, pageId: 'page-b-reattached' })
    await b.server.reconnectDomain({ domain: DOMAIN })
    await b.rejoin()

    await vi.waitFor(() => expect(b.projectedNoticeUsers()).toEqual(expect.arrayContaining(['user-b', 'user-c'])))
    const aAfterRecovery = await noticeUsers(a)
    const bAfterRecovery = await noticeUsers(b)
    expect(aAfterRecovery.filter((id) => id === 'user-b')).toHaveLength(1)
    expect(bAfterRecovery.filter((id) => id === 'user-a')).toHaveLength(0)
    expect(bAfterRecovery.filter((id) => id === 'user-b')).toHaveLength(1)
    expect(bAfterRecovery.filter((id) => id === 'user-c')).toHaveLength(1)
    expect(await noticeUsers(b)).toEqual(bAfterRecovery)
  })

  it('classifies the six-timepoint A/B/C/D lifecycle by logical generation', async () => {
    const network = new DeterministicNetwork()
    const sharedPresence = createMemoryPresenceStore()
    const observerPresence = createMemoryPresenceStore()
    const a = await createStack(
      network,
      'peer-a',
      { id: 'user-a', name: 'A', avatar: '' },
      { presenceStore: observerPresence }
    )
    const b = await createStack(
      network,
      'peer-b',
      { id: 'user-b', name: 'B', avatar: '' },
      { presenceStore: sharedPresence }
    )

    // T0-T1: A is the observer; B owns one local and one observer-visible logical join.
    await a.join()
    await b.join()
    await vi.waitFor(async () => expect(await noticeUsers(a)).toEqual(expect.arrayContaining(['user-a', 'user-b'])))
    await vi.waitFor(async () => expect(await noticeUsers(b)).toEqual(['user-b']))

    // T2: duplicate facts and C's additional physical session reuse B's generation.
    network.redeliverLastSession('peer-b', 'peer-a')
    const roomId = getChatRoomId(DOMAIN)
    const c = network.transport('peer-c')
    await c.join(roomId)
    await c.send(roomId, JSON.stringify({ ...network.lastSession('peer-b'), sessionId: 'session-c-additional' }))
    c.leave(roomId)
    await vi.waitFor(async () => expect((await noticeUsers(a)).filter((id) => id === 'user-b')).toHaveLength(1))

    // T3: B's physical host disappears; D restores the same generation from session storage.
    network.disconnectPeer('peer-b')
    b.crash()
    const d = await createStack(
      network,
      'peer-d',
      { id: 'user-b', name: 'B', avatar: '' },
      { presenceStore: sharedPresence }
    )
    await d.join()
    await vi.waitFor(() =>
      expect(d.sessionEvents.some((event) => event.snapshot.localSession?.user.id === 'user-b')).toBe(true)
    )
    expect((await noticeUsers(a)).filter((id) => id === 'user-b')).toHaveLength(1)
    expect(await noticeUsers(d)).toEqual([])
    expect(await noticeUsers(a, NOTICE_TYPE.LEAVE)).toEqual([])

    network.disconnectPeer('peer-a')
    a.crash()
    const observerReplacement = await createStack(
      network,
      'peer-a-replacement',
      { id: 'user-a', name: 'A', avatar: '' },
      { presenceStore: observerPresence }
    )
    await observerReplacement.join()
    expect(await noticeUsers(observerReplacement)).toEqual([])

    // T4: D retires the generation, publishes its end fact, then leaves the room.
    await d.server.leaveChatRoom({ domain: DOMAIN })
    await vi.waitFor(async () => expect(await noticeUsers(observerReplacement, NOTICE_TYPE.LEAVE)).toEqual(['user-b']))
    network.redeliverLastMessage('peer-d', 'peer-a-replacement', MESSAGE_TYPE.SESSION_END)
    network.redeliverLastSession('peer-d', 'peer-a-replacement')
    expect((await noticeUsers(a)).filter((id) => id === 'user-b')).toHaveLength(1)
    expect((await noticeUsers(observerReplacement, NOTICE_TYPE.LEAVE)).filter((id) => id === 'user-b')).toHaveLength(1)

    // T5: a later return allocates a fresh generation and therefore a fresh join.
    const returned = await createStack(
      network,
      'peer-returned',
      { id: 'user-b', name: 'B', avatar: '' },
      { presenceStore: sharedPresence }
    )
    await returned.join()
    await vi.waitFor(async () =>
      expect((await noticeUsers(observerReplacement)).filter((id) => id === 'user-b')).toHaveLength(1)
    )
    expect(
      (await noticeUsers(a)).filter((id) => id === 'user-b').length +
        (await noticeUsers(observerReplacement)).filter((id) => id === 'user-b').length
    ).toBe(2)
    await vi.waitFor(async () => expect(await noticeUsers(returned)).toEqual(['user-b']))
  })
})

describe('application reconnect and durable retirement controls', () => {
  it('keeps the application reconnect composition inside one logical generation', async () => {
    const network = new DeterministicNetwork()
    const a = await createStack(network, 'reconnect-peer-a', { id: 'reconnect-user-a', name: 'A', avatar: '' })
    const b = await createStack(network, 'reconnect-peer-b', { id: 'reconnect-user-b', name: 'B', avatar: '' })
    await a.join()
    await b.join()
    await vi.waitFor(async () =>
      expect((await noticeUsers(a)).filter((id) => id === 'reconnect-user-b')).toHaveLength(1)
    )
    const before = network.lastSession('reconnect-peer-b') as { presenceId: string; sessionId: string }

    await b.adapter.leaveRoom()
    await b.adapter.joinRoom({ user: { id: 'reconnect-user-b', name: 'B', avatar: '' }, site: SITE })
    const after = network.lastSession('reconnect-peer-b') as { presenceId: string; sessionId: string }

    expect(after.presenceId).toBe(before.presenceId)
    expect(after.sessionId).not.toBe(before.sessionId)
    expect(network.isJoined('reconnect-peer-b', getChatRoomId(DOMAIN))).toBe(true)
    expect(network.isJoined('reconnect-peer-b', getWorldRoomId())).toBe(true)
    expect(network.lifecycle().filter((event) => event.includes('reconnect-peer-b'))).toEqual([
      `physical-leave:reconnect-peer-b:${getChatRoomId(DOMAIN)}`
    ])
    expect((await noticeUsers(a)).filter((id) => id === 'reconnect-user-b')).toHaveLength(1)
    expect((await noticeUsers(b)).filter((id) => id === 'reconnect-user-b')).toHaveLength(1)
    expect(await noticeUsers(a, NOTICE_TYPE.LEAVE)).toEqual([])
  })

  it('retains active durable and physical presence after a rejected retirement, then retries in strict order', async () => {
    const network = new DeterministicNetwork()
    const durable = createMemoryPresenceStore()
    let rejectRetirement = true
    let retirementAttempts = 0
    let cleanupWrites = 0
    const rejectingPresenceStore: PresenceStore = {
      load: (domain) => durable.load(domain),
      save: async (record) => {
        const chatRoomId = getChatRoomId(DOMAIN)
        const hasUnsettledFinalEnd = Boolean(record.inflightEnd || record.pendingEnd)
        const endSettled = network.lifecycle().includes(`session-end-settled:retirement-peer-b:${chatRoomId}`)
        if (!record.local && (hasUnsettledFinalEnd || !endSettled)) {
          retirementAttempts += 1
          if (rejectRetirement) throw new Error('retirement write rejected')
          await durable.save(record)
          network.recordLifecycle(`durable-retired:retirement-peer-b:${chatRoomId}`)
          return
        }
        if (!record.local && endSettled && !hasUnsettledFinalEnd && !record.settledEnd) cleanupWrites += 1
        await durable.save(record)
      }
    }
    const a = await createStack(network, 'retirement-peer-a', { id: 'retirement-user-a', name: 'A', avatar: '' })
    const b = await createStack(
      network,
      'retirement-peer-b',
      { id: 'retirement-user-b', name: 'B', avatar: '' },
      { presenceStore: rejectingPresenceStore }
    )
    await a.join()
    await b.join()
    const activeLease = (await durable.load(DOMAIN))?.local
    expect(activeLease).toMatchObject({ userId: 'retirement-user-b', status: 'active' })

    await b.server.leaveChatRoom({ domain: DOMAIN })
    await vi.waitFor(() => expect(b.errors).toContain('retirement write rejected'))

    const failedSnapshot = await b.server.getSnapshot()
    expect((await durable.load(DOMAIN))?.local).toEqual(activeLease)
    expect(failedSnapshot.domains.find(({ domain }) => domain === DOMAIN)?.chatRoomJoined).toBe(true)
    expect(failedSnapshot.world.joined).toBe(true)
    expect(network.isJoined('retirement-peer-b', getChatRoomId(DOMAIN))).toBe(true)
    expect(network.isJoined('retirement-peer-b', getWorldRoomId())).toBe(true)
    expect(network.lifecycle().filter((event) => event.includes('retirement-peer-b'))).toEqual([])
    expect(await noticeUsers(a, NOTICE_TYPE.LEAVE)).toEqual([])

    const textCount = network.messageCount('retirement-peer-b', MESSAGE_TYPE.TEXT)
    const activeMessage = await b.server.allocateTextMessage({
      domain: DOMAIN,
      body: 'active after rejected retirement',
      mentions: []
    })
    await b.server.allocateReactionMessage({
      domain: DOMAIN,
      targetId: activeMessage.message.id,
      reaction: 'like',
      active: true
    })
    await b.server.sendChatMessage({ domain: DOMAIN, event: activeMessage.message })
    expect(network.messageCount('retirement-peer-b', MESSAGE_TYPE.TEXT)).toBe(textCount + 1)

    rejectRetirement = false
    await b.server.leaveChatRoom({ domain: DOMAIN })
    await vi.waitFor(async () =>
      expect((await noticeUsers(a, NOTICE_TYPE.LEAVE)).filter((id) => id === 'retirement-user-b')).toHaveLength(1)
    )

    const chatRoomId = getChatRoomId(DOMAIN)
    const settled = await durable.load(DOMAIN)
    expect(settled?.local).toBeUndefined()
    expect(settled?.inflightEnd).toBeUndefined()
    expect(settled?.pendingEnd).toBeUndefined()
    expect(settled?.settledEnd).toBeUndefined()
    expect(retirementAttempts).toBe(2)
    expect(cleanupWrites).toBe(1)
    expect(
      network
        .lifecycle()
        .filter(
          (event) =>
            event === `durable-retired:retirement-peer-b:${chatRoomId}` ||
            event === `session-end-settled:retirement-peer-b:${chatRoomId}` ||
            event === `physical-leave:retirement-peer-b:${chatRoomId}`
        )
    ).toEqual([
      `durable-retired:retirement-peer-b:${chatRoomId}`,
      `session-end-settled:retirement-peer-b:${chatRoomId}`,
      `physical-leave:retirement-peer-b:${chatRoomId}`
    ])
    expect(network.isJoined('retirement-peer-b', chatRoomId)).toBe(false)
    expect(network.isJoined('retirement-peer-b', getWorldRoomId())).toBe(false)
  })

  it('does not let an inbound presence update queued during release resurrect a retired lease', async () => {
    const network = new DeterministicNetwork()
    const durable = createMemoryPresenceStore()
    let signalRetirementStarted = () => {}
    const retirementStarted = new Promise<void>((resolve) => {
      signalRetirementStarted = resolve
    })
    let releaseRetirement = () => {}
    const heldRetirement = new Promise<void>((resolve) => {
      releaseRetirement = resolve
    })
    const heldPresenceStore: PresenceStore = {
      load: (domain) => durable.load(domain),
      save: async (record) => {
        if (!record.local) {
          signalRetirementStarted()
          await heldRetirement
        }
        await durable.save(record)
      }
    }
    const a = await createStack(network, 'held-peer-a', { id: 'held-user-a', name: 'A', avatar: '' })
    const b = await createStack(
      network,
      'held-peer-b',
      { id: 'held-user-b', name: 'B', avatar: '' },
      { presenceStore: heldPresenceStore }
    )
    await a.join()
    await b.join()
    const retainedMessage = await b.server.allocateTextMessage({
      domain: DOMAIN,
      body: 'held across retirement persistence',
      mentions: []
    })

    await b.server.leaveChatRoom({ domain: DOMAIN })
    await retirementStarted
    await expectFinalReleaseFence(b, network, 'held-peer-b', retainedMessage.message)
    const c = await createStack(network, 'held-peer-c', { id: 'held-user-c', name: 'C', avatar: '' })
    await c.join()
    releaseRetirement()
    await vi.waitFor(() => expect(network.isJoined('held-peer-b', getChatRoomId(DOMAIN))).toBe(false))

    expect((await durable.load(DOMAIN))?.local).toBeUndefined()
    expect((await noticeUsers(a, NOTICE_TYPE.LEAVE)).filter((id) => id === 'held-user-b')).toHaveLength(1)
  })

  it('carries one text and reaction port operation when recovery and final release start in the same turn', async () => {
    const network = new DeterministicNetwork()
    const durable = createMemoryPresenceStore()
    let signalRetirementStarted = () => {}
    const retirementStarted = new Promise<void>((resolve) => {
      signalRetirementStarted = resolve
    })
    let releaseRetirement = () => {}
    const heldRetirement = new Promise<void>((resolve) => {
      releaseRetirement = resolve
    })
    let holdRecoveryLoads = false
    let recoveryLoads = 0
    let signalSecondRecoveryLoad = () => {}
    const secondRecoveryLoad = new Promise<void>((resolve) => {
      signalSecondRecoveryLoad = resolve
    })
    let releaseSecondRecoveryLoad = () => {}
    const heldSecondRecoveryLoad = new Promise<void>((resolve) => {
      releaseSecondRecoveryLoad = resolve
    })
    const heldPresenceStore: PresenceStore = {
      load: async (domain) => {
        if (holdRecoveryLoads && ++recoveryLoads === 2) {
          signalSecondRecoveryLoad()
          await heldSecondRecoveryLoad
        }
        return durable.load(domain)
      },
      save: async (record) => {
        if (!record.local) {
          signalRetirementStarted()
          await heldRetirement
        }
        await durable.save(record)
      }
    }
    const user = { id: 'operation-recovery-user', name: 'Operation Recovery', avatar: '' }
    let textAllocations = 0
    let reactionAllocations = 0
    const observer = await createStack(network, 'operation-recovery-observer', {
      id: 'operation-recovery-observer-user',
      name: 'Observer',
      avatar: ''
    })
    const stack = await createStack(network, 'operation-recovery-peer', user, {
      presenceStore: heldPresenceStore,
      onAllocateText: () => {
        textAllocations += 1
      },
      onAllocateReaction: () => {
        reactionAllocations += 1
      }
    })
    await observer.join()
    await stack.join()
    const target = await stack.adapter.sendMessage({ type: 'text', body: 'reaction target', mentions: [] })
    textAllocations = 0
    const textCount = network.messageCount('operation-recovery-peer', MESSAGE_TYPE.TEXT)
    const reactionCount = network.messageCount('operation-recovery-peer', MESSAGE_TYPE.REACTION)

    const recoveries = [
      stack.server.joinChatRoom({ domain: DOMAIN, user, site: SITE }),
      stack.server.joinChatRoom({ domain: DOMAIN, user, site: SITE })
    ].map((recovery) =>
      recovery.then(
        (snapshot) => ({ ok: true as const, snapshot }),
        (error) => ({ ok: false as const, error })
      )
    )
    const release = stack.server.leaveChatRoom({ domain: DOMAIN })
    const textOutcome = stack.adapter.sendMessage({ type: 'text', body: 'held text', mentions: [] }).then(
      (message) => ({ ok: true as const, message }),
      (error) => ({ ok: false as const, error })
    )
    const reactionOutcome = stack.adapter
      .sendMessage({ type: 'reaction', targetId: target.id, reaction: REACTION_TYPE.LIKE, active: true })
      .then(
        (message) => ({ ok: true as const, message }),
        (error) => ({ ok: false as const, error })
      )

    await release
    await retirementStarted
    holdRecoveryLoads = true
    releaseRetirement()
    await secondRecoveryLoad

    await expect(textOutcome).resolves.toMatchObject({
      ok: true,
      message: { type: MESSAGE_TYPE.TEXT, body: 'held text' }
    })
    await expect(reactionOutcome).resolves.toMatchObject({
      ok: true,
      message: { type: MESSAGE_TYPE.REACTION, targetId: target.id, reaction: REACTION_TYPE.LIKE }
    })
    expect(network.messageCount('operation-recovery-peer', MESSAGE_TYPE.TEXT)).toBe(textCount + 1)
    expect(network.messageCount('operation-recovery-peer', MESSAGE_TYPE.REACTION)).toBe(reactionCount + 1)
    expect(textAllocations).toBe(1)
    expect(reactionAllocations).toBe(1)
    expect(stack.errors).toEqual([])
    releaseSecondRecoveryLoad()
    expect((await Promise.all(recoveries)).every(({ ok }) => ok)).toBe(true)
    expect(
      (await stack.server.getSnapshot()).domains.find(({ domain }) => domain === DOMAIN)?.localSession?.user.id
    ).toBe(user.id)
  })

  it('settles held operations after every concurrent recovery attempt fails', async () => {
    const network = new DeterministicNetwork()
    const durable = createMemoryPresenceStore()
    const user = { id: 'failed-recovery-user', name: 'Failed Recovery', avatar: '' }
    const original = await createStack(network, 'failed-recovery-original', user, { presenceStore: durable })
    await original.join()
    network.rejectNextSessionEnd('failed-recovery-original')
    await original.server.leaveChatRoom({ domain: DOMAIN })
    await vi.waitFor(() => expect(original.errors).toContain('session end send rejected'))
    network.disconnectPeer('failed-recovery-original')
    original.crash()

    let signalRetryStarted = () => {}
    const retryStarted = new Promise<void>((resolve) => {
      signalRetryStarted = resolve
    })
    let rejectRetry = () => {}
    const heldRetry = new Promise<void>((resolve) => {
      rejectRetry = resolve
    })
    let replacementLoads = 0
    let releaseReplacementLoads = () => {}
    const bothReplacementLoads = new Promise<void>((resolve) => {
      releaseReplacementLoads = resolve
    })
    const rejectingStore: PresenceStore = {
      load: async (domain) => {
        const record = await durable.load(domain)
        replacementLoads += 1
        if (replacementLoads === 2) releaseReplacementLoads()
        await bothReplacementLoads
        return record
      },
      save: async (record) => {
        if (record.inflightEnd) {
          signalRetryStarted()
          await heldRetry
          throw new Error('concurrent recovery rejected')
        }
        await durable.save(record)
      }
    }
    const replacement = await createStack(network, 'failed-recovery-replacement', user, {
      presenceStore: rejectingStore
    })
    let unsuccessfulRecoveries = 0
    const recoveries = [
      replacement.server.joinChatRoom({ domain: DOMAIN, user, site: SITE }),
      replacement.server.joinChatRoom({ domain: DOMAIN, user, site: SITE })
    ].map((recovery) =>
      recovery.then(
        (snapshot) => {
          if (snapshot === null) unsuccessfulRecoveries += 1
          return snapshot
        },
        (error) => {
          unsuccessfulRecoveries += 1
          throw error
        }
      )
    )
    await retryStarted
    const text = replacement.server.allocateTextMessage({ domain: DOMAIN, body: 'held until failure', mentions: [] })

    rejectRetry()

    await expect(Promise.all(recoveries)).rejects.toThrow('concurrent recovery rejected')
    await expect(text).rejects.toMatchObject({ name: 'AbortError' })
    expect(unsuccessfulRecoveries).toBe(2)
  })

  it('settles a held operation when the server is disposed during recovery', async () => {
    const network = new DeterministicNetwork()
    const durable = createMemoryPresenceStore()
    let signalRetirementStarted = () => {}
    const retirementStarted = new Promise<void>((resolve) => {
      signalRetirementStarted = resolve
    })
    let releaseRetirement = () => {}
    const heldRetirement = new Promise<void>((resolve) => {
      releaseRetirement = resolve
    })
    const heldPresenceStore: PresenceStore = {
      load: (domain) => durable.load(domain),
      save: async (record) => {
        if (!record.local) {
          signalRetirementStarted()
          await heldRetirement
        }
        await durable.save(record)
      }
    }
    const user = { id: 'disposed-recovery-user', name: 'Disposed Recovery', avatar: '' }
    const stack = await createStack(network, 'disposed-recovery-peer', user, { presenceStore: heldPresenceStore })
    await stack.join()
    void completeInterruptedRelease(stack, user).catch(() => {})
    await stack.server.leaveChatRoom({ domain: DOMAIN })
    await retirementStarted
    const text = stack.server.allocateTextMessage({ domain: DOMAIN, body: 'held until dispose', mentions: [] })

    stack.crash()

    await expect(text).rejects.toMatchObject({ name: 'AbortError' })
    releaseRetirement()
  })

  it('does not physically depart until a rejected SESSION_END is retried and settled', async () => {
    const network = new DeterministicNetwork()
    const durable = createMemoryPresenceStore()
    const a = await createStack(network, 'end-peer-a', { id: 'end-user-a', name: 'A', avatar: '' })
    const b = await createStack(
      network,
      'end-peer-b',
      { id: 'end-user-b', name: 'B', avatar: '' },
      { presenceStore: durable }
    )
    await a.join()
    await b.join()
    const retainedMessage = await b.server.allocateTextMessage({
      domain: DOMAIN,
      body: 'held across a rejected end',
      mentions: []
    })
    network.rejectNextSessionEnd('end-peer-b')

    await b.server.leaveChatRoom({ domain: DOMAIN })
    await vi.waitFor(() => expect(b.errors).toContain('session end send rejected'))

    const chatRoomId = getChatRoomId(DOMAIN)
    const pendingEnd = await durable.load(DOMAIN)
    expect(pendingEnd?.local).toBeUndefined()
    expect(pendingEnd?.pendingEnd).toMatchObject({ userId: 'end-user-b' })
    expect(network.isJoined('end-peer-b', chatRoomId)).toBe(true)
    expect(network.isJoined('end-peer-b', getWorldRoomId())).toBe(true)
    expect(await noticeUsers(a, NOTICE_TYPE.LEAVE)).toEqual([])
    expect(network.lifecycle().filter((event) => event.includes('end-peer-b'))).toEqual([
      `session-end-rejected:end-peer-b:${chatRoomId}`
    ])
    await expectFinalReleaseFence(b, network, 'end-peer-b', retainedMessage.message)

    await b.server.leaveChatRoom({ domain: DOMAIN })
    await vi.waitFor(async () =>
      expect((await noticeUsers(a, NOTICE_TYPE.LEAVE)).filter((id) => id === 'end-user-b')).toHaveLength(1)
    )

    expect(network.lifecycle().filter((event) => event.includes('end-peer-b'))).toEqual([
      `session-end-rejected:end-peer-b:${chatRoomId}`,
      `session-end-settled:end-peer-b:${chatRoomId}`,
      `physical-leave:end-peer-b:${chatRoomId}`,
      `physical-leave:end-peer-b:${getWorldRoomId()}`
    ])
    const settled = await durable.load(DOMAIN)
    expect(settled?.inflightEnd).toBeUndefined()
    expect(settled?.pendingEnd).toBeUndefined()
    expect(settled?.settledEnd).toBeUndefined()
  })

  it('completes a rejected final end across host replacement without orphaning the generation', async () => {
    const network = new DeterministicNetwork()
    const sharedPresence = createMemoryPresenceStore()
    const observer = await createStack(network, 'pending-end-observer', {
      id: 'pending-end-observer-user',
      name: 'Observer',
      avatar: ''
    })
    const original = await createStack(
      network,
      'pending-end-original',
      { id: 'pending-end-user', name: 'Pending End', avatar: '' },
      { presenceStore: sharedPresence }
    )
    await observer.join()
    await original.join()
    await vi.waitFor(async () =>
      expect((await noticeUsers(observer)).filter((id) => id === 'pending-end-user')).toHaveLength(1)
    )
    const originalSession = network.lastSession('pending-end-original') as {
      presenceId: string
      sessionId: string
    }
    network.rejectNextSessionEnd('pending-end-original')

    await original.server.leaveChatRoom({ domain: DOMAIN })
    await vi.waitFor(() => expect(original.errors).toContain('session end send rejected'))
    expect((await sharedPresence.load(DOMAIN))?.pendingEnd).toMatchObject({
      presenceId: originalSession.presenceId,
      userId: 'pending-end-user'
    })
    expect(await noticeUsers(observer, NOTICE_TYPE.LEAVE)).toEqual([])

    network.disconnectPeer('pending-end-original')
    original.crash()
    const replacement = await createStack(
      network,
      'pending-end-replacement',
      { id: 'pending-end-user', name: 'Pending End', avatar: '' },
      { presenceStore: sharedPresence }
    )
    const replacementUser = { id: 'pending-end-user', name: 'Pending End', avatar: '' }
    await completeInterruptedRelease(replacement, replacementUser)
    const returnedSession = network.lastSession('pending-end-replacement') as {
      presenceId: string
      sessionId: string
    }
    expect(returnedSession.presenceId).not.toBe(originalSession.presenceId)
    expect(returnedSession.sessionId).not.toBe(originalSession.sessionId)
    await vi.waitFor(async () =>
      expect((await noticeUsers(observer, NOTICE_TYPE.LEAVE)).filter((id) => id === 'pending-end-user')).toHaveLength(1)
    )
    const settled = await sharedPresence.load(DOMAIN)
    expect(settled?.local?.presenceId).toBe(returnedSession.presenceId)
    expect(settled?.inflightEnd).toBeUndefined()
    expect(settled?.pendingEnd).toBeUndefined()
    expect(settled?.settledEnd).toBeUndefined()
    expect(network.isJoined('pending-end-replacement', getChatRoomId(DOMAIN))).toBe(true)
    expect(network.isJoined('pending-end-replacement', getWorldRoomId())).toBe(true)

    await vi.waitFor(async () =>
      expect((await noticeUsers(observer)).filter((id) => id === 'pending-end-user')).toHaveLength(2)
    )
  })

  it('continues the same final-end transaction when the first attempt is unsettled', async () => {
    const network = new DeterministicNetwork()
    const sharedPresence = createMemoryPresenceStore()
    const observer = await createStack(network, 'first-inflight-observer', {
      id: 'first-inflight-observer-user',
      name: 'Observer',
      avatar: ''
    })
    const original = await createStack(
      network,
      'first-inflight-original',
      { id: 'first-inflight-user', name: 'First Inflight', avatar: '' },
      { presenceStore: sharedPresence }
    )
    await observer.join()
    await original.join()
    await vi.waitFor(async () =>
      expect((await noticeUsers(observer)).filter((id) => id === 'first-inflight-user')).toHaveLength(1)
    )
    const originalSession = network.lastSession('first-inflight-original') as {
      presenceId: string
      sessionId: string
    }
    const retainedMessage = await original.server.allocateTextMessage({
      domain: DOMAIN,
      body: 'held across an unsettled end',
      mentions: []
    })
    const held = network.holdNextSessionEnd('first-inflight-original')

    await original.server.leaveChatRoom({ domain: DOMAIN })
    await held.started
    expect((await sharedPresence.load(DOMAIN))?.inflightEnd).toMatchObject({
      presenceId: originalSession.presenceId,
      userId: 'first-inflight-user'
    })
    expect(await noticeUsers(observer, NOTICE_TYPE.LEAVE)).toEqual([])
    await expectFinalReleaseFence(original, network, 'first-inflight-original', retainedMessage.message)

    network.disconnectPeer('first-inflight-original')
    original.crash()
    const replacement = await createStack(
      network,
      'first-inflight-replacement',
      { id: 'first-inflight-user', name: 'First Inflight', avatar: '' },
      { presenceStore: sharedPresence }
    )
    const replacementUser = { id: 'first-inflight-user', name: 'First Inflight', avatar: '' }
    await completeInterruptedRelease(replacement, replacementUser)
    const returnedSession = network.lastSession('first-inflight-replacement') as {
      presenceId: string
      sessionId: string
    }
    expect(returnedSession.presenceId).not.toBe(originalSession.presenceId)
    expect(returnedSession.sessionId).not.toBe(originalSession.sessionId)
    await vi.waitFor(async () =>
      expect(
        (await noticeUsers(observer, NOTICE_TYPE.LEAVE)).filter((id) => id === 'first-inflight-user')
      ).toHaveLength(1)
    )
    const settled = await sharedPresence.load(DOMAIN)
    expect(settled?.local?.presenceId).toBe(returnedSession.presenceId)
    expect(settled?.inflightEnd).toBeUndefined()
    expect(settled?.pendingEnd).toBeUndefined()
    expect(settled?.settledEnd).toBeUndefined()

    await vi.waitFor(async () =>
      expect((await noticeUsers(observer)).filter((id) => id === 'first-inflight-user')).toHaveLength(2)
    )
  })

  it('continues the same final-end transaction when the retry is unsettled', async () => {
    const network = new DeterministicNetwork()
    const sharedPresence = createMemoryPresenceStore()
    const observer = await createStack(network, 'retry-inflight-observer', {
      id: 'retry-inflight-observer-user',
      name: 'Observer',
      avatar: ''
    })
    const original = await createStack(
      network,
      'retry-inflight-original',
      { id: 'retry-inflight-user', name: 'Retry Inflight', avatar: '' },
      { presenceStore: sharedPresence }
    )
    await observer.join()
    await original.join()
    await vi.waitFor(async () =>
      expect((await noticeUsers(observer)).filter((id) => id === 'retry-inflight-user')).toHaveLength(1)
    )
    const originalSession = network.lastSession('retry-inflight-original') as {
      presenceId: string
      sessionId: string
    }
    network.rejectNextSessionEnd('retry-inflight-original')
    await original.server.leaveChatRoom({ domain: DOMAIN })
    await vi.waitFor(() => expect(original.errors).toContain('session end send rejected'))
    expect((await sharedPresence.load(DOMAIN))?.pendingEnd?.presenceId).toBe(originalSession.presenceId)

    const held = network.holdNextSessionEnd('retry-inflight-original')
    await original.server.leaveChatRoom({ domain: DOMAIN })
    await held.started
    const retrying = await sharedPresence.load(DOMAIN)
    expect(retrying?.local).toBeUndefined()
    expect(retrying?.pendingEnd).toBeUndefined()
    expect(retrying?.inflightEnd?.presenceId).toBe(originalSession.presenceId)

    network.disconnectPeer('retry-inflight-original')
    original.crash()
    const replacement = await createStack(
      network,
      'retry-inflight-replacement',
      { id: 'retry-inflight-user', name: 'Retry Inflight', avatar: '' },
      { presenceStore: sharedPresence }
    )
    const replacementUser = { id: 'retry-inflight-user', name: 'Retry Inflight', avatar: '' }
    await completeInterruptedRelease(replacement, replacementUser)
    const returnedSession = network.lastSession('retry-inflight-replacement') as {
      presenceId: string
      sessionId: string
    }
    expect(returnedSession.presenceId).not.toBe(originalSession.presenceId)
    expect(returnedSession.sessionId).not.toBe(originalSession.sessionId)
    await vi.waitFor(async () =>
      expect(
        (await noticeUsers(observer, NOTICE_TYPE.LEAVE)).filter((id) => id === 'retry-inflight-user')
      ).toHaveLength(1)
    )
    const settled = await sharedPresence.load(DOMAIN)
    expect(settled?.local?.presenceId).toBe(returnedSession.presenceId)
    expect(settled?.inflightEnd).toBeUndefined()
    expect(settled?.pendingEnd).toBeUndefined()
    expect(settled?.settledEnd).toBeUndefined()

    await vi.waitFor(async () =>
      expect((await noticeUsers(observer)).filter((id) => id === 'retry-inflight-user')).toHaveLength(2)
    )
  })

  it('retains the pending generation when the retry transition rejects', async () => {
    const network = new DeterministicNetwork()
    const durable = createMemoryPresenceStore()
    let rejectRetryTransition = false
    const retryRejectingStore: PresenceStore = {
      load: (domain) => durable.load(domain),
      save: async (record) => {
        if (record.inflightEnd && rejectRetryTransition) {
          rejectRetryTransition = false
          throw new Error('retry transition rejected')
        }
        await durable.save(record)
      }
    }
    const observer = await createStack(network, 'retry-transition-observer', {
      id: 'retry-transition-observer-user',
      name: 'Observer',
      avatar: ''
    })
    const releasing = await createStack(
      network,
      'retry-transition-releasing',
      { id: 'retry-transition-user', name: 'Retry Transition', avatar: '' },
      { presenceStore: retryRejectingStore }
    )
    await observer.join()
    await releasing.join()
    network.rejectNextSessionEnd('retry-transition-releasing')

    await releasing.server.leaveChatRoom({ domain: DOMAIN })
    await vi.waitFor(() => expect(releasing.errors).toContain('session end send rejected'))
    const pending = await durable.load(DOMAIN)
    expect(pending?.pendingEnd).toMatchObject({ userId: 'retry-transition-user' })
    rejectRetryTransition = true

    await releasing.server.leaveChatRoom({ domain: DOMAIN })
    await vi.waitFor(() => expect(releasing.errors).toContain('retry transition rejected'))
    expect(await durable.load(DOMAIN)).toEqual(pending)
    expect(network.isJoined('retry-transition-releasing', getChatRoomId(DOMAIN))).toBe(true)
    expect(network.isJoined('retry-transition-releasing', getWorldRoomId())).toBe(true)
    expect(await noticeUsers(observer, NOTICE_TYPE.LEAVE)).toEqual([])
    expect(network.lifecycle().filter((event) => event.includes('retry-transition-releasing'))).toEqual([
      `session-end-rejected:retry-transition-releasing:${getChatRoomId(DOMAIN)}`
    ])

    await releasing.server.leaveChatRoom({ domain: DOMAIN })
    await vi.waitFor(async () =>
      expect(
        (await noticeUsers(observer, NOTICE_TYPE.LEAVE)).filter((id) => id === 'retry-transition-user')
      ).toHaveLength(1)
    )
    const settled = await durable.load(DOMAIN)
    expect(settled?.local).toBeUndefined()
    expect(settled?.inflightEnd).toBeUndefined()
    expect(settled?.pendingEnd).toBeUndefined()
    expect(settled?.settledEnd).toBeUndefined()
  })

  it('retries durable cleanup before physically departing after the final end settles', async () => {
    const network = new DeterministicNetwork()
    const durable = createMemoryPresenceStore()
    let rejectCleanup = true
    const cleanupRejectingStore: PresenceStore = {
      load: (domain) => durable.load(domain),
      save: async (record) => {
        if (!record.local && !record.inflightEnd && !record.pendingEnd && !record.settledEnd && rejectCleanup) {
          rejectCleanup = false
          throw new Error('final end cleanup rejected')
        }
        await durable.save(record)
      }
    }
    const observer = await createStack(network, 'cleanup-observer', {
      id: 'cleanup-observer-user',
      name: 'Observer',
      avatar: ''
    })
    const releasing = await createStack(
      network,
      'cleanup-releasing',
      { id: 'cleanup-user', name: 'Cleanup', avatar: '' },
      { presenceStore: cleanupRejectingStore }
    )
    await observer.join()
    await releasing.join()
    await vi.waitFor(async () =>
      expect((await noticeUsers(observer)).filter((id) => id === 'cleanup-user')).toHaveLength(1)
    )
    const retainedMessage = await releasing.server.allocateTextMessage({
      domain: DOMAIN,
      body: 'held across cleanup failure',
      mentions: []
    })

    await releasing.server.leaveChatRoom({ domain: DOMAIN })
    await vi.waitFor(() => expect(releasing.errors).toContain('final end cleanup rejected'))
    await vi.waitFor(async () =>
      expect((await noticeUsers(observer, NOTICE_TYPE.LEAVE)).filter((id) => id === 'cleanup-user')).toHaveLength(1)
    )
    const retained = await durable.load(DOMAIN)
    expect(retained?.local).toBeUndefined()
    expect(retained?.inflightEnd).toBeUndefined()
    expect(retained?.pendingEnd).toBeUndefined()
    expect(retained?.settledEnd).toMatchObject({ userId: 'cleanup-user' })
    expect(network.isJoined('cleanup-releasing', getChatRoomId(DOMAIN))).toBe(true)
    expect(network.isJoined('cleanup-releasing', getWorldRoomId())).toBe(true)
    expect(
      network.lifecycle().filter((event) => event.startsWith('session-end-settled:cleanup-releasing'))
    ).toHaveLength(1)
    await expectFinalReleaseFence(releasing, network, 'cleanup-releasing', retainedMessage.message)

    await releasing.server.leaveChatRoom({ domain: DOMAIN })
    await vi.waitFor(() => expect(network.isJoined('cleanup-releasing', getChatRoomId(DOMAIN))).toBe(false))
    expect((await noticeUsers(observer, NOTICE_TYPE.LEAVE)).filter((id) => id === 'cleanup-user')).toHaveLength(1)
    expect(
      network.lifecycle().filter((event) => event.startsWith('session-end-settled:cleanup-releasing'))
    ).toHaveLength(1)
    const settled = await durable.load(DOMAIN)
    expect(settled?.local).toBeUndefined()
    expect(settled?.inflightEnd).toBeUndefined()
    expect(settled?.pendingEnd).toBeUndefined()
    expect(settled?.settledEnd).toBeUndefined()
  })

  it('safely retries an already-accepted end when the settled marker write rejects', async () => {
    const network = new DeterministicNetwork()
    const durable = createMemoryPresenceStore()
    let rejectSettledMarker = true
    const settlementRejectingStore: PresenceStore = {
      load: (domain) => durable.load(domain),
      save: async (record) => {
        if (record.settledEnd && rejectSettledMarker) {
          rejectSettledMarker = false
          throw new Error('settled marker rejected')
        }
        await durable.save(record)
      }
    }
    const observer = await createStack(network, 'settlement-crash-observer', {
      id: 'settlement-crash-observer-user',
      name: 'Observer',
      avatar: ''
    })
    const original = await createStack(
      network,
      'settlement-crash-original',
      { id: 'settlement-crash-user', name: 'Settlement Crash', avatar: '' },
      { presenceStore: settlementRejectingStore }
    )
    await observer.join()
    await original.join()
    const originalSession = network.lastSession('settlement-crash-original') as { presenceId: string }

    await original.server.leaveChatRoom({ domain: DOMAIN })
    await vi.waitFor(() => expect(original.errors).toContain('settled marker rejected'))
    await vi.waitFor(async () =>
      expect(
        (await noticeUsers(observer, NOTICE_TYPE.LEAVE)).filter((id) => id === 'settlement-crash-user')
      ).toHaveLength(1)
    )
    expect((await durable.load(DOMAIN))?.inflightEnd?.presenceId).toBe(originalSession.presenceId)
    expect(network.isJoined('settlement-crash-original', getChatRoomId(DOMAIN))).toBe(true)

    network.disconnectPeer('settlement-crash-original')
    original.crash()
    const replacement = await createStack(
      network,
      'settlement-crash-replacement',
      { id: 'settlement-crash-user', name: 'Settlement Crash', avatar: '' },
      { presenceStore: durable }
    )
    await completeInterruptedRelease(replacement, {
      id: 'settlement-crash-user',
      name: 'Settlement Crash',
      avatar: ''
    })
    expect(network.messageCount('settlement-crash-replacement', MESSAGE_TYPE.SESSION)).toBeGreaterThan(0)
    expect(network.messageCount('settlement-crash-replacement', MESSAGE_TYPE.SESSION_END)).toBe(1)
    expect(
      (await noticeUsers(observer, NOTICE_TYPE.LEAVE)).filter((id) => id === 'settlement-crash-user')
    ).toHaveLength(1)
    const cleaned = await durable.load(DOMAIN)
    expect(cleaned?.local?.presenceId).not.toBe(originalSession.presenceId)
    expect(cleaned?.inflightEnd).toBeUndefined()
    expect(cleaned?.pendingEnd).toBeUndefined()
    expect(cleaned?.settledEnd).toBeUndefined()
    expect(await noticeUsers(replacement)).toEqual([])

    await replacement.join()
    const returnedSession = network.lastSession('settlement-crash-replacement') as { presenceId: string }
    expect(returnedSession.presenceId).not.toBe(originalSession.presenceId)
    await vi.waitFor(async () =>
      expect((await noticeUsers(observer)).filter((id) => id === 'settlement-crash-user')).toHaveLength(2)
    )
    expect(await noticeUsers(replacement)).toEqual(['settlement-crash-user'])
  })

  it('recovers settled cleanup ownership without resurrecting the ended generation', async () => {
    const network = new DeterministicNetwork()
    const durable = createMemoryPresenceStore()
    let rejectCleanup = true
    const cleanupRejectingStore: PresenceStore = {
      load: (domain) => durable.load(domain),
      save: async (record) => {
        if (!record.local && !record.inflightEnd && !record.pendingEnd && !record.settledEnd && rejectCleanup) {
          rejectCleanup = false
          throw new Error('final end cleanup rejected')
        }
        await durable.save(record)
      }
    }
    const observer = await createStack(network, 'cleanup-crash-observer', {
      id: 'cleanup-crash-observer-user',
      name: 'Observer',
      avatar: ''
    })
    const original = await createStack(
      network,
      'cleanup-crash-original',
      { id: 'cleanup-crash-user', name: 'Cleanup Crash', avatar: '' },
      { presenceStore: cleanupRejectingStore }
    )
    await observer.join()
    await original.join()
    await vi.waitFor(async () =>
      expect((await noticeUsers(observer)).filter((id) => id === 'cleanup-crash-user')).toHaveLength(1)
    )
    const originalSession = network.lastSession('cleanup-crash-original') as { presenceId: string }

    await original.server.leaveChatRoom({ domain: DOMAIN })
    await vi.waitFor(() => expect(original.errors).toContain('final end cleanup rejected'))
    await vi.waitFor(async () =>
      expect((await noticeUsers(observer, NOTICE_TYPE.LEAVE)).filter((id) => id === 'cleanup-crash-user')).toHaveLength(
        1
      )
    )
    expect((await durable.load(DOMAIN))?.settledEnd?.presenceId).toBe(originalSession.presenceId)

    network.disconnectPeer('cleanup-crash-original')
    original.crash()
    const otherUser = await createStack(
      network,
      'cleanup-crash-other-user',
      { id: 'cleanup-other-user', name: 'Other', avatar: '' },
      { presenceStore: durable }
    )
    await expect(
      otherUser.server.joinChatRoom({
        domain: DOMAIN,
        user: { id: 'cleanup-other-user', name: 'Other', avatar: '' },
        site: SITE
      })
    ).rejects.toThrow('Runtime pending presence belongs to another user')
    expect((await durable.load(DOMAIN))?.settledEnd?.presenceId).toBe(originalSession.presenceId)

    const replacement = await createStack(
      network,
      'cleanup-crash-replacement',
      { id: 'cleanup-crash-user', name: 'Cleanup Crash', avatar: '' },
      { presenceStore: durable }
    )
    await completeInterruptedRelease(replacement, {
      id: 'cleanup-crash-user',
      name: 'Cleanup Crash',
      avatar: ''
    })
    expect(network.messageCount('cleanup-crash-replacement', MESSAGE_TYPE.SESSION)).toBeGreaterThan(0)
    expect(network.messageCount('cleanup-crash-replacement', MESSAGE_TYPE.SESSION_END)).toBe(0)
    expect(network.isJoined('cleanup-crash-replacement', getChatRoomId(DOMAIN))).toBe(true)
    expect(network.isJoined('cleanup-crash-replacement', getWorldRoomId())).toBe(true)
    const observerDomain = (await observer.server.getSnapshot()).domains.find((item) => item.domain === DOMAIN)
    expect(observerDomain?.sessions.some((session) => session.user.id === 'cleanup-crash-user')).toBe(true)
    expect((await noticeUsers(observer, NOTICE_TYPE.LEAVE)).filter((id) => id === 'cleanup-crash-user')).toHaveLength(1)
    const cleaned = await durable.load(DOMAIN)
    expect(cleaned?.local?.presenceId).not.toBe(originalSession.presenceId)
    expect(cleaned?.inflightEnd).toBeUndefined()
    expect(cleaned?.pendingEnd).toBeUndefined()
    expect(cleaned?.settledEnd).toBeUndefined()
    expect(await noticeUsers(replacement)).toEqual([])

    await replacement.join()
    const returnedSession = network.lastSession('cleanup-crash-replacement') as { presenceId: string }
    expect(returnedSession.presenceId).not.toBe(originalSession.presenceId)
    await vi.waitFor(async () =>
      expect((await noticeUsers(observer)).filter((id) => id === 'cleanup-crash-user')).toHaveLength(2)
    )
    expect((await noticeUsers(observer, NOTICE_TYPE.LEAVE)).filter((id) => id === 'cleanup-crash-user')).toHaveLength(1)
    expect(await noticeUsers(replacement)).toEqual(['cleanup-crash-user'])
  })
})
