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
import { MESSAGE_TYPE, type ChatUser, type WireCodec } from '@/protocol'
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

class DeterministicNetwork {
  private readonly endpoints = new Map<string, Endpoint>()
  private readonly heldDiscoveries = new Set<string>()
  private readonly heldRoutes = new Set<string>()
  private readonly heldFrames: HeldFrame[] = []
  private readonly deliveredFrames: HeldFrame[] = []
  private readonly lifecycleEvents: string[] = []
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
      peers: (roomId) => {
        const members: string[] = []
        this.endpoints.forEach((other, otherPeerId) => {
          if (otherPeerId !== peerId && other.rooms.has(roomId)) members.push(otherPeerId)
        })
        return members
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

    // T4: D retires the generation. The release sends no Chat end value: the observer keeps B
    // online during the five-second leave grace and persists one leave only on expiry.
    vi.useFakeTimers()
    try {
      await d.server.leaveChatRoom({ domain: DOMAIN })
      await vi.advanceTimersByTimeAsync(0)
      // The generation is still displayed throughout the grace (the replacement observer
      // persisted no join notice: its ledger restored B as already active).
      expect(
        observerReplacement.sessionEvents.some((event) =>
          event.snapshot.sessions.some((session) => session.user.id === 'user-b')
        )
      ).toBe(true)
      expect(await noticeUsers(observerReplacement, NOTICE_TYPE.LEAVE)).toEqual([])
      // No Chat lifecycle frame was ever produced by the release.
      expect(network.messageCount('peer-d', 'session-end')).toBe(0)
      await vi.advanceTimersByTimeAsync(5000)
      await vi.advanceTimersByTimeAsync(0)
      await vi.waitFor(async () =>
        expect(await noticeUsers(observerReplacement, NOTICE_TYPE.LEAVE)).toEqual(['user-b'])
      )
      // An expired generation SHALL NOT resurrect: a later duplicate SESSION is dropped.
      network.redeliverLastSession('peer-d', 'peer-a-replacement')
      await vi.advanceTimersByTimeAsync(0)
      expect((await noticeUsers(observerReplacement, NOTICE_TYPE.LEAVE)).filter((id) => id === 'user-b')).toHaveLength(
        1
      )

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
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('single live release owner', () => {
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

  it('releases through one live owner without a Chat end value; the observer leave lands on grace expiry', async () => {
    const network = new DeterministicNetwork()
    const durable = createMemoryPresenceStore()
    const a = await createStack(network, 'live-release-peer-a', { id: 'release-user-a', name: 'A', avatar: '' })
    const b = await createStack(
      network,
      'live-release-peer-b',
      { id: 'release-user-b', name: 'B', avatar: '' },
      { presenceStore: durable }
    )
    await a.join()
    await b.join()
    await vi.waitFor(async () => expect((await noticeUsers(a)).filter((id) => id === 'release-user-b')).toHaveLength(1))

    const chatRoomId = getChatRoomId(DOMAIN)
    // Fake timers before the release so the observer's pending-leave deadline is fake-owned.
    vi.useFakeTimers()
    try {
      await b.server.leaveChatRoom({ domain: DOMAIN })
      await vi.advanceTimersByTimeAsync(0)
      // The release produces no Chat lifecycle frame and no durable end journal.
      // No Chat lifecycle frame was ever produced by the release.
      expect(network.messageCount('live-release-peer-b', 'session-end')).toBe(0)
      await vi.waitFor(async () => expect((await durable.load(DOMAIN))?.local).toBeUndefined())
      await vi.waitFor(() => expect(network.isJoined('live-release-peer-b', chatRoomId)).toBe(false))
      await vi.waitFor(() => expect(network.isJoined('live-release-peer-b', getWorldRoomId())).toBe(false))
      expect(network.lifecycle().filter((event) => event.includes('live-release-peer-b'))).toContain(
        `physical-leave:live-release-peer-b:${chatRoomId}`
      )
      // The observer keeps B online during the leave grace and persists one leave on expiry.
      expect((await noticeUsers(a)).filter((id) => id === 'release-user-b')).toHaveLength(1)
      expect(await noticeUsers(a, NOTICE_TYPE.LEAVE)).toEqual([])
      await vi.advanceTimersByTimeAsync(5000)
      await vi.advanceTimersByTimeAsync(0)
      await vi.waitFor(async () =>
        expect((await noticeUsers(a, NOTICE_TYPE.LEAVE)).filter((id) => id === 'release-user-b')).toHaveLength(1)
      )
    } finally {
      vi.useRealTimers()
    }
  })

  it('rejoins with a fresh generation after the release grace settles', async () => {
    const network = new DeterministicNetwork()
    const a = await createStack(network, 'fence-peer-a', { id: 'fence-user-a', name: 'A', avatar: '' })
    const b = await createStack(network, 'fence-peer-b', { id: 'fence-user-b', name: 'B', avatar: '' })
    await a.join()
    await b.join()

    vi.useFakeTimers()
    try {
      await b.server.leaveChatRoom({ domain: DOMAIN })
      await vi.advanceTimersByTimeAsync(0)
      // The observer grace expires before the rejoin: one leave lands.
      await vi.advanceTimersByTimeAsync(5000)
      await vi.advanceTimersByTimeAsync(0)
      await vi.waitFor(async () =>
        expect((await noticeUsers(a, NOTICE_TYPE.LEAVE)).filter((id) => id === 'fence-user-b')).toHaveLength(1)
      )
      // A rejoin after release creates a fresh presence generation in the current live model.
      await b.server.joinChatRoom({
        domain: DOMAIN,
        user: { id: 'fence-user-b', name: 'B', avatar: '' },
        site: SITE
      })
      await vi.waitFor(async () =>
        expect((await noticeUsers(a)).filter((id) => id === 'fence-user-b').length).toBeGreaterThanOrEqual(2)
      )
      expect(network.isJoined('fence-peer-b', getChatRoomId(DOMAIN))).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('suppresses the final leave while the user keeps another active or grace-preserved presence', async () => {
    vi.useFakeTimers()
    try {
      const network = new DeterministicNetwork()
      const a = await createStack(network, 'multi-peer-a', { id: 'multi-user-a', name: 'A', avatar: '' })
      const b1 = await createStack(network, 'multi-peer-b1', { id: 'multi-user-b', name: 'B', avatar: '' })
      const b2 = await createStack(network, 'multi-peer-b2', { id: 'multi-user-b', name: 'B', avatar: '' })
      await a.join()
      await b1.join()
      await b2.join()
      await vi.waitFor(async () => expect((await noticeUsers(a)).filter((id) => id === 'multi-user-b')).toHaveLength(1))

      // B1's physical source departs: the user still has B2's active generation, so the expiry
      // removes only B1's generation and persists NO leave notice.
      network.disconnectPeer('multi-peer-b1')
      b1.crash()
      await vi.advanceTimersByTimeAsync(0)
      expect(await noticeUsers(a, NOTICE_TYPE.LEAVE)).toEqual([])
      await vi.advanceTimersByTimeAsync(5000)
      await vi.advanceTimersByTimeAsync(0)
      expect(await noticeUsers(a, NOTICE_TYPE.LEAVE)).toEqual([])
      // The user remains displayed through B2.
      expect(
        a.sessionEvents.some((event) => event.snapshot.sessions.some((session) => session.user.id === 'multi-user-b'))
      ).toBe(true)

      // B2's physical source also departs: its expiry removes the last generation and lands one leave.
      network.disconnectPeer('multi-peer-b2')
      b2.crash()
      await vi.advanceTimersByTimeAsync(0)
      await vi.advanceTimersByTimeAsync(5000)
      await vi.advanceTimersByTimeAsync(0)
      await vi.waitFor(async () =>
        expect((await noticeUsers(a, NOTICE_TYPE.LEAVE)).filter((id) => id === 'multi-user-b')).toHaveLength(1)
      )
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps the remote user online during the leave grace and emits exactly one leave on expiry', async () => {
    vi.useFakeTimers()
    try {
      const network = new DeterministicNetwork()
      const a = await createStack(network, 'grace-peer-a', { id: 'grace-user-a', name: 'A', avatar: '' })
      const b = await createStack(network, 'grace-peer-b', { id: 'grace-user-b', name: 'B', avatar: '' })
      await a.join()
      await b.join()
      await vi.waitFor(async () => expect((await noticeUsers(a)).filter((id) => id === 'grace-user-b')).toHaveLength(1))

      // B's physical host disappears without any Chat lifecycle frame.
      network.disconnectPeer('grace-peer-b')
      b.crash()
      await vi.advanceTimersByTimeAsync(0)
      // The generation is retained in the online snapshot throughout the five-second deadline.
      expect((await noticeUsers(a)).filter((id) => id === 'grace-user-b')).toHaveLength(1)
      expect(await noticeUsers(a, NOTICE_TYPE.LEAVE)).toEqual([])
      const onlineDuringGrace = a.sessionEvents.some((event) =>
        event.snapshot.sessions.some((session) => session.user.id === 'grace-user-b')
      )
      expect(onlineDuringGrace).toBe(true)

      // Expiry removes only that generation and persists exactly one observer-local leave.
      await vi.advanceTimersByTimeAsync(5000)
      await vi.advanceTimersByTimeAsync(0)
      await vi.waitFor(async () =>
        expect((await noticeUsers(a, NOTICE_TYPE.LEAVE)).filter((id) => id === 'grace-user-b')).toHaveLength(1)
      )
      expect((await noticeUsers(a)).filter((id) => id === 'grace-user-b')).toHaveLength(1)
    } finally {
      vi.useRealTimers()
    }
  })
})
