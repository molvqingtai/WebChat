import { describe, expect, it, vi } from 'vitest'
import { Remesh } from 'remesh'
import HistoryDomain from './History'
import SessionDomain from './Session'
import WireDomain from './Wire'
import DeliveryDomain from './Delivery'
import LifecycleDomain from './Lifecycle'
import { PagePort } from '@/runtime/PagePort'
import { ClockExtern } from '@/domain/runtime/externs/Clock'
import { IdentityExtern } from '@/domain/runtime/externs/Identity'
import { PresenceStoreExtern } from '@/domain/runtime/externs/PresenceStore'
import { RoomTransportExtern, WireCodecExtern } from '@/domain/runtime/externs/RoomTransport'
import { PagePortExtern } from '@/domain/runtime/externs/PagePort'
import { MESSAGE_TYPE } from '@/protocol'
import type { RoomTransport } from '@/runtime/RoomTransport'
import type { HistoryMessagesPull, HistoryMessagesPush, WireCodec, ChatRoomMessage } from '@/protocol'
import { MESSAGE_RECORD_TYPE, type ChatMessageRecord } from '@/domain/Message'
import { getChatRoomId } from '@/runtime/Server'

const DOMAIN = 'https://example.com'
const ROOM_ID = getChatRoomId(DOMAIN)
const USER = { id: 'user-1', name: 'User', avatar: '' }

const jsonCodec: WireCodec = {
  encode: async (value) => JSON.stringify(value),
  decode: async (payload) => JSON.parse(payload)
}

type SentMessage = {
  roomId: string
  targetPeerIds?: string | string[]
  message: ChatRoomMessage
  fromPeerId?: string
}

type TransportFixture = {
  transport: RoomTransport
  sent: SentMessage[]
  receive: (roomId: string, sourcePeerId: string, message: unknown) => void
}

const fakeTransport = (localPeerId = 'local-peer'): TransportFixture => {
  const sent: SentMessage[] = []
  let messageListener: ((roomId: string, sourcePeerId: string, rawPayload: string) => void) | null = null
  const transport: RoomTransport = {
    peerIdOf: () => localPeerId,
    join: async () => {},
    leave: () => {},
    retireRoomsForPreparation: async () => {},
    send: async (roomId, payload, targetPeerIds) => {
      sent.push({ roomId, targetPeerIds, message: JSON.parse(payload) as ChatRoomMessage })
    },
    onMessage: (callback) => {
      messageListener = callback
      return () => {
        messageListener = null
      }
    },
    onPeerJoin: () => () => {},
    onPeerLeave: () => () => {},
    onRoomClose: () => () => {},
    onError: () => () => {},
    dispose: () => {}
  }
  return {
    transport,
    sent,
    receive: (roomId: string, sourcePeerId: string, message: unknown) => {
      messageListener?.(roomId, sourcePeerId, JSON.stringify(message))
    }
  }
}

const setupRuntime = async (
  sourcePeerId: string,
  codec: WireCodec,
  fixture: TransportFixture,
  pagePort = new PagePort(),
  remoteUser: typeof USER = USER,
  admitRemote = true
) => {
  const { transport, receive, sent } = fixture
  const store = Remesh.store({
    externs: [
      ClockExtern.impl({ now: () => 1_000_000 }),
      IdentityExtern.impl({ nextId: () => `id-${Math.random().toString(36).slice(2)}` }),
      PresenceStoreExtern.impl({
        load: async () => null,
        save: async () => {}
      }),
      RoomTransportExtern.impl(transport),
      WireCodecExtern.impl(codec),
      PagePortExtern.impl(pagePort)
    ]
  })
  const wireAction = WireDomain()
  const deliveryAction = DeliveryDomain()
  const sessionAction = SessionDomain()
  const historyAction = HistoryDomain()
  const wire = store.getDomain(wireAction)
  const delivery = store.getDomain(deliveryAction)
  const session = store.getDomain(sessionAction)
  const history = store.getDomain(historyAction)
  store.subscribeDomain(wireAction)
  store.subscribeDomain(deliveryAction)
  store.subscribeDomain(sessionAction)
  store.subscribeDomain(historyAction)
  store.igniteDomain(wireAction)
  store.igniteDomain(deliveryAction)
  store.igniteDomain(sessionAction)
  store.igniteDomain(historyAction)
  // Logical presence + committed runtime + a session binding driven through the real wire path.
  store.send(
    session.command.HydratePresenceCommand({
      domain: DOMAIN,
      lastJoinedAt: 1,
      local: { presenceId: 'presence-1', userId: USER.id, joinedAt: 1, status: 'active' },
      observers: []
    })
  )
  store.send(
    session.command.PrepareDomainCommand({
      attemptId: 'attempt-1',
      mode: 'join',
      domain: DOMAIN,
      user: USER,
      site: { origin: DOMAIN }
    })
  )
  store.send(session.command.CommitPreparedCommand('attempt-1'))
  store.send(wire.command.JoinRoomsCommand({ requestId: 'join-1', roomIds: [ROOM_ID] }))
  const sessionMessage: ChatRoomMessage = {
    type: MESSAGE_TYPE.SESSION,
    sessionId: `session-${sourcePeerId}`,
    presenceId: `presence-${sourcePeerId}`,
    joinedAt: 2,
    user: remoteUser
  }
  await new Promise((resolve) => setTimeout(resolve, 0))
  if (admitRemote) {
    receive(ROOM_ID, sourcePeerId, sessionMessage)
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  return { store, session, history, wire, delivery, pagePort, receive, sent }
}

const setup = async (sourcePeerId = 'peer-a', codec: WireCodec = jsonCodec) =>
  setupRuntime(sourcePeerId, codec, fakeTransport())

const connectedNetwork = () => {
  type Peer = {
    peerId: string
    joinedRooms: Set<string>
    messageListener: ((roomId: string, sourcePeerId: string, rawPayload: string) => void) | null
    peerJoinListeners: Set<(roomId: string, peerId: string) => void>
    peerLeaveListeners: Set<(roomId: string, peerId: string) => void>
  }
  const peers = new Map<string, Peer>()

  const create = (peerId: string): TransportFixture => {
    const sent: SentMessage[] = []
    const peer: Peer = {
      peerId,
      joinedRooms: new Set(),
      messageListener: null,
      peerJoinListeners: new Set(),
      peerLeaveListeners: new Set()
    }
    peers.set(peerId, peer)
    const transport: RoomTransport = {
      peerIdOf: () => peerId,
      join: async (roomId) => {
        if (peer.joinedRooms.has(roomId)) return
        peer.joinedRooms.add(roomId)
        peers.forEach((other) => {
          if (other.peerId === peerId || !other.joinedRooms.has(roomId)) return
          other.peerJoinListeners.forEach((listener) => listener(roomId, peerId))
          peer.peerJoinListeners.forEach((listener) => listener(roomId, other.peerId))
        })
      },
      leave: (roomId) => {
        if (!peer.joinedRooms.delete(roomId)) return
        peers.forEach((other) => {
          if (other.peerId === peerId || !other.joinedRooms.has(roomId)) return
          other.peerLeaveListeners.forEach((listener) => listener(roomId, peerId))
        })
      },
      retireRoomsForPreparation: async (roomIds) => {
        roomIds.forEach((roomId) => transport.leave(roomId))
      },
      send: async (roomId, payload, targetPeerIds) => {
        const requested =
          targetPeerIds === undefined
            ? [...peers.keys()]
            : typeof targetPeerIds === 'string'
              ? [targetPeerIds]
              : targetPeerIds
        const targets = [...new Set(requested)].filter((target) => target !== peerId)
        sent.push({
          roomId,
          targetPeerIds,
          message: JSON.parse(payload) as ChatRoomMessage,
          fromPeerId: peerId
        })
        targets.forEach((target) => {
          const recipient = peers.get(target)
          if (recipient?.joinedRooms.has(roomId)) recipient.messageListener?.(roomId, peerId, payload)
        })
      },
      onMessage: (callback) => {
        peer.messageListener = callback
        return () => {
          if (peer.messageListener === callback) peer.messageListener = null
        }
      },
      onPeerJoin: (callback) => {
        peer.peerJoinListeners.add(callback)
        return () => peer.peerJoinListeners.delete(callback)
      },
      onPeerLeave: (callback) => {
        peer.peerLeaveListeners.add(callback)
        return () => peer.peerLeaveListeners.delete(callback)
      },
      onRoomClose: () => () => {},
      onError: () => () => {},
      dispose: () => {
        peer.joinedRooms.forEach((roomId) => transport.leave(roomId))
        peers.delete(peerId)
      }
    }
    return {
      transport,
      sent,
      receive: (roomId: string, sourcePeerId: string, message: unknown) => {
        peer.messageListener?.(roomId, sourcePeerId, JSON.stringify(message))
      }
    }
  }

  return { create }
}

const networkUser = (peerId: string) => ({ id: `user-${peerId}`, name: peerId, avatar: '' })
const networkSession = (peerId: string): ChatRoomMessage => ({
  type: MESSAGE_TYPE.SESSION,
  sessionId: `session-${peerId}`,
  presenceId: `presence-${peerId}`,
  joinedAt: 2,
  user: networkUser(peerId)
})

const providerRequest = (syncId: string, page: number, done: boolean): HistoryMessagesPull => ({
  type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
  syncId,
  page,
  messageIds: [],
  done
})

type Fixture = Awaited<ReturnType<typeof setup>>
const sendProviderRequest = (
  store: Fixture['store'],
  history: Fixture['history'],
  syncId: string,
  page: number,
  done: boolean
) => {
  store.send(
    history.command.HandleHistoryMessagesPullCommand({
      roomId: ROOM_ID,
      sourcePeerId: 'peer-a',
      message: providerRequest(syncId, page, done)
    })
  )
}

describe('HistoryDomain connection-binding lifecycle', () => {
  it('domain release clears both directional bindings (mutation-sensitive)', async () => {
    const { store, history, pagePort, receive } = await setup()
    pagePort.provideHistory(1, DOMAIN, (event) => {
      if (event.type === 'request') throw new Error('page-a broken')
    })
    // Provider direction: a synchronization binds, terminates, and its replay is inert.
    sendProviderRequest(store, history, 'rel-a', 0, true)
    await vi.waitFor(() => expect(store.query(history.query.ProviderAttemptsQuery())).toHaveLength(0))
    sendProviderRequest(store, history, 'rel-a', 0, true)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(store.query(history.query.ProviderAttemptsQuery())).toHaveLength(0)
    // Requester direction: start, complete through the real response input path, and verify the
    // loading-close settlement retains the completed collection while a fresh request starts freely.
    store.send(history.command.HistoryMessagesPullCommand({ domain: DOMAIN, sourcePeerId: 'peer-a' }))
    const requester = store.query(history.query.RequesterAttemptsQuery()).find((item) => item.sourcePeerId === 'peer-a')
    expect(requester).toBeDefined()
    receive(ROOM_ID, 'peer-a', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PUSH,
      syncId: requester!.syncId,
      page: 0,
      users: [],
      messages: [],
      done: true
    })
    await vi.waitFor(() =>
      expect(store.query(history.query.RequesterAttemptsQuery()).every((item) => item.loadingSettled)).toBe(true)
    )
    // A repeated start on the same incarnation is inert (its requester binding persists); only
    // the real replacement lifecycle retires the old owner into a retained collection and admits
    // a fresh request identity while the old one still accepts late pages.
    store.send(history.command.HistoryMessagesPullCommand({ domain: DOMAIN, sourcePeerId: 'peer-a' }))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(store.query(history.query.RequesterAttemptsQuery())).toHaveLength(1)
    store.send(history.command.ResetPeerHistorySyncCommand({ domain: DOMAIN, sourcePeerId: 'peer-a' }))
    store.send(history.command.HistoryMessagesPullCommand({ domain: DOMAIN, sourcePeerId: 'peer-a' }))
    await vi.waitFor(() => expect(store.query(history.query.RequesterAttemptsQuery())).toHaveLength(2))
    // Domain release must clear BOTH directional bindings itself: only then can the same ids
    // bind again and start fresh synchronization work (a stale terminal binding would block both).
    store.send(history.command.ReleaseDomainCommand(DOMAIN))
    sendProviderRequest(store, history, 'rel-a', 0, true)
    await vi.waitFor(() => expect(store.query(history.query.ProviderAttemptsQuery())).toHaveLength(1))
    store.send(history.command.HistoryMessagesPullCommand({ domain: DOMAIN, sourcePeerId: 'peer-a' }))
    await vi.waitFor(() => expect(store.query(history.query.RequesterAttemptsQuery())).toHaveLength(1))
  })
})

describe('HistoryDomain inventory targets', () => {
  it('sends every inventory page once to the triggering source provider', async () => {
    const { store, history, pagePort, receive, sent } = await setup()
    pagePort.provideHistory(1, DOMAIN, (event) => {
      if (event.type === 'request') {
        void pagePort.resolveHistorySupply(1, event.request.supplyId, { records: [], done: true })
      }
    })

    receive(ROOM_ID, 'local-peer', {
      type: MESSAGE_TYPE.SESSION,
      sessionId: 'self-session',
      presenceId: 'self-presence',
      joinedAt: 3,
      user: { id: 'self-user', name: 'Self', avatar: '' }
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    store.send(history.command.HistoryMessagesPullCommand({ domain: DOMAIN, sourcePeerId: 'peer-a' }))

    await vi.waitFor(() =>
      expect(sent.some((item) => item.message.type === MESSAGE_TYPE.HISTORY_MESSAGES_PULL)).toBe(true)
    )
    expect(sent.find((item) => item.message.type === MESSAGE_TYPE.HISTORY_MESSAGES_PULL)?.targetPeerIds).toEqual([
      'peer-a'
    ])
  })

  it('settles a self-only inventory attempt without a provider send', async () => {
    const { store, history, pagePort, sent } = await setup('local-peer')
    pagePort.provideHistory(1, DOMAIN, (event) => {
      if (event.type === 'request') {
        void pagePort.resolveHistorySupply(1, event.request.supplyId, { records: [], done: true })
      }
    })

    store.send(history.command.HistoryMessagesPullCommand({ domain: DOMAIN, sourcePeerId: 'local-peer' }))
    await vi.waitFor(() =>
      expect(store.query(history.query.RequesterAttemptsQuery())).toEqual([
        expect.objectContaining({ sourcePeerId: 'local-peer', loadingSettled: true })
      ])
    )

    expect(sent.filter((item) => item.message.type === MESSAGE_TYPE.HISTORY_MESSAGES_PULL)).toEqual([])
  })
})

describe('HistoryDomain peer-scoped requester targets', () => {
  const admitPeer = async (receive: Fixture['receive'], peerId: string, sessionId: string) => {
    receive(ROOM_ID, peerId, {
      type: MESSAGE_TYPE.SESSION,
      sessionId,
      presenceId: `presence-${peerId}`,
      joinedAt: 3,
      user: USER
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
  }

  const supplyEmpty = (pagePort: Fixture['pagePort']) =>
    pagePort.provideHistory(1, DOMAIN, (event) => {
      if (event.type === 'request') {
        void pagePort.resolveHistorySupply(1, event.request.supplyId, { records: [], done: true })
      }
    })

  const pulls = (sent: Fixture['sent']) =>
    sent.filter((item) => item.message.type === MESSAGE_TYPE.HISTORY_MESSAGES_PULL)
  const pushes = (sent: Fixture['sent']) =>
    sent.filter((item) => item.message.type === MESSAGE_TYPE.HISTORY_MESSAGES_PUSH)
  const pullMessage = (item: Fixture['sent'][number]) => item.message as HistoryMessagesPull
  const pushMessage = (item: Fixture['sent'][number]) => item.message as HistoryMessagesPush
  const targetsOf = (item: Fixture['sent'][number]) => JSON.stringify(item.targetPeerIds)

  it('rejects a non-owner push before any lane, delivery, or feedback mutation', async () => {
    const { store, history, pagePort, receive, delivery } = await setup()
    const lifecycleAction = LifecycleDomain()
    const lifecycle = store.getDomain(lifecycleAction)
    store.subscribeDomain(lifecycleAction)
    store.igniteDomain(lifecycleAction)
    store.send(lifecycle.command.AttachPageCommand({ domain: DOMAIN, tabId: 1 }))
    const inbound: ChatMessageRecord[] = []
    const feedback: unknown[] = []
    store.subscribeEvent(delivery.event.InboundAcceptedEvent, (event) => {
      inbound.push(event.record)
      store.send(delivery.command.AckInboundCommand({ domain: DOMAIN, sequence: event.sequence, inserted: true }))
    })
    store.subscribeEvent(history.event.FeedbackChangedEvent, (event) => {
      feedback.push(event)
    })
    supplyEmpty(pagePort)

    store.send(history.command.HistoryMessagesPullCommand({ domain: DOMAIN, sourcePeerId: 'peer-a' }))
    await vi.waitFor(() => expect(store.query(history.query.RequesterAttemptsQuery())).toHaveLength(1))
    const requester = store.query(history.query.RequesterAttemptsQuery())[0]!
    const record: ChatMessageRecord = {
      type: MESSAGE_RECORD_TYPE.CHAT_MESSAGE,
      id: 'owned-record',
      message: {
        type: MESSAGE_TYPE.TEXT,
        id: 'owned-record',
        hlc: { timestamp: 1_000_001, counter: 0 },
        userId: USER.id,
        body: 'owned',
        mentions: []
      },
      user: USER,
      receivedAt: 1_000_001
    }
    const push = () =>
      ({
        type: MESSAGE_TYPE.HISTORY_MESSAGES_PUSH,
        syncId: requester.syncId,
        page: 0,
        users: [USER],
        messages: [record.message],
        done: true
      }) satisfies HistoryMessagesPush

    // The exact sync id is known, but it belongs to peer-a. A peer-b frame must be fully inert.
    receive(ROOM_ID, 'peer-b', push())
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(store.query(history.query.RequesterAttemptsQuery())).toEqual([
      expect.objectContaining({ sourcePeerId: 'peer-a', providers: {}, loadingSettled: false })
    ])
    expect(store.query(delivery.query.BufferedEventsQuery({ domain: DOMAIN, after: 0 }))).toEqual([])
    expect(inbound).toEqual([])
    expect(feedback).toEqual([])

    // The owner frame with the same page still applies and completes the response lane normally.
    receive(ROOM_ID, 'peer-a', push())
    await vi.waitFor(() => expect(inbound).toHaveLength(1))
    await vi.waitFor(() =>
      expect(store.query(history.query.RequesterAttemptsQuery()).every((item) => item.loadingSettled)).toBe(true)
    )
    expect(inbound).toEqual([expect.objectContaining({ id: record.id, message: record.message, user: record.user })])
    expect(feedback).toEqual([
      { domain: DOMAIN, ownerId: expect.stringContaining('peer-a'), type: 'loading' },
      { domain: DOMAIN, ownerId: expect.stringContaining('peer-a'), type: 'dismiss' }
    ])
  })

  it('targets only the triggering source peer for each direction', async () => {
    const { store, history, pagePort, receive, sent } = await setup()
    supplyEmpty(pagePort)
    await admitPeer(receive, 'peer-b', 'session-b')

    store.send(history.command.HistoryMessagesPullCommand({ domain: DOMAIN, sourcePeerId: 'peer-a' }))
    await vi.waitFor(() => expect(pulls(sent)).toHaveLength(1))
    store.send(history.command.HistoryMessagesPullCommand({ domain: DOMAIN, sourcePeerId: 'peer-b' }))
    await vi.waitFor(() => expect(pulls(sent)).toHaveLength(2))

    const [first, second] = pulls(sent)
    expect(first.targetPeerIds).toEqual(['peer-a'])
    expect(second.targetPeerIds).toEqual(['peer-b'])
    const syncIds = pulls(sent).map((item) => pullMessage(item).syncId)
    expect(new Set(syncIds).size).toBe(2)
    expect(
      store
        .query(history.query.RequesterAttemptsQuery())
        .map((item) => item.sourcePeerId)
        .sort()
    ).toEqual(['peer-a', 'peer-b'])
  })

  it('admitting a new peer never restarts or appends to an established exchange', async () => {
    const { store, history, pagePort, receive, sent } = await setup()
    supplyEmpty(pagePort)

    store.send(history.command.HistoryMessagesPullCommand({ domain: DOMAIN, sourcePeerId: 'peer-a' }))
    await vi.waitFor(() => expect(pulls(sent)).toHaveLength(1))
    const establishedSyncId = pullMessage(pulls(sent)[0]!).syncId
    receive(ROOM_ID, 'peer-a', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PUSH,
      syncId: establishedSyncId,
      page: 0,
      users: [],
      messages: [],
      done: true
    })
    await vi.waitFor(() =>
      expect(store.query(history.query.RequesterAttemptsQuery()).every((item) => item.loadingSettled)).toBe(true)
    )

    // C joins: only the C-scoped exchange starts; the established A exchange sends nothing more.
    await admitPeer(receive, 'peer-c', 'session-c')
    store.send(history.command.HistoryMessagesPullCommand({ domain: DOMAIN, sourcePeerId: 'peer-c' }))
    await vi.waitFor(() => expect(pulls(sent)).toHaveLength(2))

    const establishedPulls = pulls(sent).filter((item) => targetsOf(item) === JSON.stringify(['peer-a']))
    expect(establishedPulls).toHaveLength(1)
    const newPeerPulls = pulls(sent).filter((item) => targetsOf(item) === JSON.stringify(['peer-c']))
    expect(newPeerPulls).toHaveLength(1)
    const established = store
      .query(history.query.RequesterAttemptsQuery())
      .find((item) => item.sourcePeerId === 'peer-a')
    expect(established?.syncId).toBe(establishedSyncId)
  })

  it('batched admissions create distinct owners with exact singleton targets', async () => {
    const { store, history, pagePort, receive, sent } = await setup()
    supplyEmpty(pagePort)
    await admitPeer(receive, 'peer-b', 'session-b')
    await admitPeer(receive, 'peer-c', 'session-c')

    store.send(history.command.HistoryMessagesPullCommand({ domain: DOMAIN, sourcePeerId: 'peer-b' }))
    store.send(history.command.HistoryMessagesPullCommand({ domain: DOMAIN, sourcePeerId: 'peer-c' }))
    await vi.waitFor(() => expect(pulls(sent)).toHaveLength(2))

    // Mutation-sensitive: restoring an all-current-Session allocation would target
    // ['peer-b','peer-c'] (or include 'peer-a') and fail these singleton assertions.
    const targets = pulls(sent).map(targetsOf).sort()
    expect(targets).toEqual([JSON.stringify(['peer-b']), JSON.stringify(['peer-c'])])
    const syncIds = pulls(sent).map((item) => pullMessage(item).syncId)
    expect(new Set(syncIds).size).toBe(2)
  })

  it('settles the loading once its own source completes, without waiting on any other peer', async () => {
    const { store, history, pagePort, receive, sent } = await setup()
    supplyEmpty(pagePort)
    await admitPeer(receive, 'peer-b', 'session-b')

    store.send(history.command.HistoryMessagesPullCommand({ domain: DOMAIN, sourcePeerId: 'peer-a' }))
    await vi.waitFor(() => expect(pulls(sent)).toHaveLength(1))
    const syncId = pullMessage(pulls(sent)[0]!).syncId

    // The sole provider completes; the loading closes even though peer-b never responded to
    // anything. An all-provider snapshot would keep the loading open on the unsettled peer-b seat.
    receive(ROOM_ID, 'peer-a', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PUSH,
      syncId,
      page: 0,
      users: [],
      messages: [],
      done: true
    })
    await vi.waitFor(() =>
      expect(store.query(history.query.RequesterAttemptsQuery()).every((item) => item.loadingSettled)).toBe(true)
    )
  })

  it('an unrelated departure never settles the loading; the source departure does', async () => {
    const { store, history, pagePort, receive, sent } = await setup()
    supplyEmpty(pagePort)
    await admitPeer(receive, 'peer-b', 'session-b')

    store.send(history.command.HistoryMessagesPullCommand({ domain: DOMAIN, sourcePeerId: 'peer-a' }))
    await vi.waitFor(() => expect(pulls(sent)).toHaveLength(1))

    store.send(history.command.RemovePeerCommand({ domain: DOMAIN, sourcePeerId: 'peer-b' }))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(store.query(history.query.RequesterAttemptsQuery()).every((item) => !item.loadingSettled)).toBe(true)

    store.send(history.command.RemovePeerCommand({ domain: DOMAIN, sourcePeerId: 'peer-a' }))
    await vi.waitFor(() =>
      expect(store.query(history.query.RequesterAttemptsQuery()).every((item) => item.loadingSettled)).toBe(true)
    )
  })

  it('multi-page inventory stays one logical pull under one syncId with in-order progression', async () => {
    // A tiny encoded-frame bound forces the real chunking to split the inventory into pages.
    const limitedCodec: WireCodec = {
      encode: async (value) => {
        const frame = JSON.stringify(value)
        if (frame.length > 200) throw new Error('frame too large')
        return frame
      },
      decode: async (payload) => JSON.parse(payload)
    }
    const { store, history, pagePort, sent } = await setup('peer-a', limitedCodec)
    const record = (id: string): ChatMessageRecord => ({
      type: MESSAGE_RECORD_TYPE.CHAT_MESSAGE,
      id,
      message: {
        type: MESSAGE_TYPE.TEXT,
        id,
        hlc: { timestamp: 1_000_000, counter: 0 },
        userId: USER.id,
        body: 'x',
        mentions: []
      },
      user: USER,
      receivedAt: 1_000_000
    })
    // 40-char ids make exactly two fit each 200-byte frame, so four ids chunk into two pages.
    const ids = [1, 2, 3, 4].map((n) => `m-${String(n).padStart(38, '0')}`)
    pagePort.provideHistory(1, DOMAIN, (event) => {
      if (event.type === 'request') {
        void pagePort.resolveHistorySupply(1, event.request.supplyId, {
          records: ids.map(record),
          done: true
        })
      }
    })

    store.send(history.command.HistoryMessagesPullCommand({ domain: DOMAIN, sourcePeerId: 'peer-a' }))
    await vi.waitFor(() => expect(pulls(sent).length).toBeGreaterThan(1))

    const pages = pulls(sent).map(pullMessage)
    // One logical pull: every chunk shares the single attempt syncId and the singleton target,
    // pages progress in order, and only the final page is done. No response chunk from the peer
    // was ever received, proving progression is local send settlement, not a peer round trip.
    expect(new Set(pages.map((page) => page.syncId)).size).toBe(1)
    expect(pulls(sent).every((item) => targetsOf(item) === JSON.stringify(['peer-a']))).toBe(true)
    expect(pages.map((page) => page.page)).toEqual(pages.map((_, index) => index))
    expect(pages.slice(0, -1).every((page) => !page.done)).toBe(true)
    expect(pages.at(-1)?.done).toBe(true)
  })

  it('multi-page response stays one logical push under the request syncId', async () => {
    const { store, history, pagePort, sent } = await setup()
    const record = (id: string): ChatMessageRecord => ({
      type: MESSAGE_RECORD_TYPE.CHAT_MESSAGE,
      id,
      message: {
        type: MESSAGE_TYPE.TEXT,
        id,
        hlc: { timestamp: 1_000_000, counter: 0 },
        userId: USER.id,
        body: 'x',
        mentions: []
      },
      user: USER,
      receivedAt: 1_000_000
    })
    // All records share one HLC, so the canonical ID tie-breaker determines the full snapshot
    // order. Reversing the supplied snapshot proves sorting occurs before (rather than per) page
    // slicing: page zero must still start with the globally oldest record.
    const ids = Array.from({ length: 101 }, (_, index) => `m-${String(index).padStart(3, '0')}`)
    const shuffledIds = [...ids].reverse()
    pagePort.provideHistory(1, DOMAIN, (event) => {
      if (event.type === 'request') {
        void pagePort.resolveHistorySupply(1, event.request.supplyId, {
          records: shuffledIds.map(record),
          done: true
        })
      }
    })

    // The remote peer pulls from us; our provider response is one logical push chunked into pages.
    sendProviderRequest(store, history, 'remote-sync-1', 0, true)
    await vi.waitFor(() => expect(pushes(sent).length).toBeGreaterThan(1))

    const pages = pushes(sent).map(pushMessage)
    expect(pages.every((page) => page.syncId === 'remote-sync-1')).toBe(true)
    expect(pushes(sent).every((item) => targetsOf(item) === JSON.stringify(['peer-a']))).toBe(true)
    expect(pages.map((page) => page.page)).toEqual(pages.map((_, index) => index))
    expect(pages.slice(0, -1).every((page) => !page.done)).toBe(true)
    expect(pages.at(-1)?.done).toBe(true)
    expect(pages.flatMap((page) => page.messages.map((message) => message.id))).toEqual(ids)
  })
})

describe('HistoryDomain current-function peer topology', () => {
  type RuntimeFixture = Awaited<ReturnType<typeof setupRuntime>>

  const historyMessages = (fixtures: RuntimeFixture[]) =>
    fixtures
      .flatMap((fixture) => fixture.sent)
      .filter((item) => {
        return (
          item.message.type === MESSAGE_TYPE.HISTORY_MESSAGES_PULL ||
          item.message.type === MESSAGE_TYPE.HISTORY_MESSAGES_PUSH
        )
      })
  const pulls = (messages: SentMessage[]) =>
    messages.filter((item) => item.message.type === MESSAGE_TYPE.HISTORY_MESSAGES_PULL)
  const pushes = (messages: SentMessage[]) =>
    messages.filter((item) => item.message.type === MESSAGE_TYPE.HISTORY_MESSAGES_PUSH)
  const targeted = (item: SentMessage, peerId: string) =>
    JSON.stringify(item.targetPeerIds) === JSON.stringify([peerId])

  const assertExchange = (messages: SentMessage[], requesterPeerId: string, providerPeerId: string) => {
    const pull = pulls(messages).filter((item) => item.fromPeerId === requesterPeerId && targeted(item, providerPeerId))
    const push = pushes(messages).filter(
      (item) => item.fromPeerId === providerPeerId && targeted(item, requesterPeerId)
    )
    expect(pull).toHaveLength(1)
    expect(push).toHaveLength(1)
    const pullPage = pull[0]!.message as HistoryMessagesPull
    const pushPage = push[0]!.message as HistoryMessagesPush
    expect(pushPage.syncId).toBe(pullPage.syncId)
    expect(pullPage.page).toBe(0)
    expect(pushPage.page).toBe(0)
    expect(pullPage.done).toBe(true)
    expect(pushPage.done).toBe(true)
    return pullPage.syncId
  }

  const provideEmptyHistory = (fixture: RuntimeFixture) => {
    fixture.pagePort.provideHistory(1, DOMAIN, (event) => {
      if (event.type === 'request') {
        void fixture.pagePort.resolveHistorySupply(1, event.request.supplyId, { records: [], done: true })
      }
    })
  }

  it('admits an eligible Pull before any Session binding exists', async () => {
    const fixture = await setupRuntime('peer-a', jsonCodec, fakeTransport(), new PagePort(), USER, false)
    provideEmptyHistory(fixture)

    fixture.receive(ROOM_ID, 'peer-a', providerRequest('pull-before-session', 0, true))

    await vi.waitFor(() =>
      expect(fixture.sent.filter((item) => item.message.type === MESSAGE_TYPE.HISTORY_MESSAGES_PUSH)).toHaveLength(1)
    )
    expect(fixture.store.query(fixture.session.query.DomainQuery(DOMAIN))?.sessions).toEqual([])
    expect(
      fixture.sent.find((item) => item.message.type === MESSAGE_TYPE.HISTORY_MESSAGES_PUSH)?.targetPeerIds
    ).toEqual(['peer-a'])
  })

  const resetHistoryFor = (fixture: RuntimeFixture, sourcePeerId: string) => {
    fixture.store.send(fixture.history.command.ResetPeerHistorySyncCommand({ domain: DOMAIN, sourcePeerId }))
    fixture.store.send(fixture.history.command.HistoryMessagesPullCommand({ domain: DOMAIN, sourcePeerId }))
  }

  const waitForPeer = async (fixture: RuntimeFixture, sourcePeerId: string) => {
    await vi.waitFor(() =>
      expect(
        fixture.store
          .query(fixture.session.query.DomainQuery(DOMAIN))
          ?.sessions.some((item) => item.sourcePeerId === sourcePeerId)
      ).toBe(true)
    )
  }

  it('runs both directions once and adds only four directions when C joins', async () => {
    const network = connectedNetwork()
    const a = await setupRuntime('peer-b', jsonCodec, network.create('peer-a'), new PagePort(), networkUser('peer-b'))
    const b = await setupRuntime('peer-a', jsonCodec, network.create('peer-b'), new PagePort(), networkUser('peer-a'))
    const initial = [a, b]
    initial.forEach(provideEmptyHistory)
    await Promise.all([waitForPeer(a, 'peer-b'), waitForPeer(b, 'peer-a')])

    // These are the same reset commands Connection uses after a committed source binding; the
    // request and response then cross the connected production Wire/Session/History lifecycles.
    resetHistoryFor(a, 'peer-b')
    resetHistoryFor(b, 'peer-a')
    await vi.waitFor(() => expect(pulls(historyMessages(initial))).toHaveLength(2))
    await vi.waitFor(() => expect(pushes(historyMessages(initial))).toHaveLength(2))

    const initialMessages = historyMessages(initial)
    const initialAB = assertExchange(initialMessages, 'peer-a', 'peer-b')
    const initialBA = assertExchange(initialMessages, 'peer-b', 'peer-a')

    const c = await setupRuntime('peer-a', jsonCodec, network.create('peer-c'), new PagePort(), networkUser('peer-a'))
    a.receive(ROOM_ID, 'peer-c', networkSession('peer-c'))
    b.receive(ROOM_ID, 'peer-c', networkSession('peer-c'))
    c.receive(ROOM_ID, 'peer-b', networkSession('peer-b'))
    const all = [a, b, c]
    all.forEach(provideEmptyHistory)
    await Promise.all([
      waitForPeer(a, 'peer-c'),
      waitForPeer(b, 'peer-c'),
      waitForPeer(c, 'peer-a'),
      waitForPeer(c, 'peer-b')
    ])

    resetHistoryFor(a, 'peer-c')
    resetHistoryFor(b, 'peer-c')
    resetHistoryFor(c, 'peer-a')
    resetHistoryFor(c, 'peer-b')
    await vi.waitFor(() => expect(pulls(historyMessages(all))).toHaveLength(6))
    await vi.waitFor(() => expect(pushes(historyMessages(all))).toHaveLength(6))

    const messages = historyMessages(all)
    // The original A<->B exchange has no second logical owner after C joins.
    expect(assertExchange(messages, 'peer-a', 'peer-b')).toBe(initialAB)
    expect(assertExchange(messages, 'peer-b', 'peer-a')).toBe(initialBA)
    // C contributes exactly the four new directed requester/provider exchanges.
    assertExchange(messages, 'peer-a', 'peer-c')
    assertExchange(messages, 'peer-c', 'peer-a')
    assertExchange(messages, 'peer-b', 'peer-c')
    assertExchange(messages, 'peer-c', 'peer-b')
  })
})

describe('HistoryDomain dead-page projection', () => {
  it('publishes DeadPagesEvent exactly once for an all-genuine-failure selection', async () => {
    const { store, history, pagePort } = await setup()
    const deadPages = vi.fn()
    store.subscribeEvent(history.event.DeadPagesEvent, deadPages)
    // The page's provider throws synchronously when a snapshot supply is requested: the real
    // PagePort lifecycle removes the page and rejects the supply, and the domain publishes the
    // dead page exactly once.
    pagePort.provideHistory(1, DOMAIN, (event) => {
      if (event.type === 'request') throw new Error('page-a broken')
    })
    sendProviderRequest(store, history, 'dead-a', 0, true)
    await vi.waitFor(() => expect(deadPages).toHaveBeenCalledWith(['tab:1']))
    expect(deadPages).toHaveBeenCalledOnce()
  })

  it('never reports healthy detached (null) candidates as dead pages', async () => {
    const { store, history, pagePort } = await setup()
    const deadPages = vi.fn()
    store.subscribeEvent(history.event.DeadPagesEvent, deadPages)
    // A real detached result: the page's provider is replaced while its snapshot supply is
    // pending, so the PagePort settles the old supply with null through the replacement
    // lifecycle. The selection exhausts without any dead-page report (the page stays healthy).
    const pendingSupplyIds: string[] = []
    pagePort.provideHistory(1, DOMAIN, (event) => {
      if (event.type === 'request') pendingSupplyIds.push(event.request.supplyId)
      if (event.type === 'cancel') {
        void pagePort.resolveHistorySupply(1, event.supplyId, { records: [], done: true })
      }
    })
    sendProviderRequest(store, history, 'null-sync', 0, true)
    // The synchronization is admitted (the snapshot supply starts and the direction binds).
    await vi.waitFor(() => expect(pendingSupplyIds.length).toBe(1))
    await vi.waitFor(() => expect(store.query(history.query.ProviderAttemptsQuery())).toHaveLength(1))
    // Replacing the page provider settles the pending snapshot with null (replacement mode).
    pagePort.provideHistory(1, DOMAIN, (event) => {
      if (event.type === 'request') pendingSupplyIds.push(event.request.supplyId)
    })
    // The selection exhausts to its real terminal state: the attempt is discarded and the page
    // stays healthy. Only after that terminal boundary may we assert no dead-page report.
    await vi.waitFor(() => expect(store.query(history.query.ProviderAttemptsQuery())).toHaveLength(0))
    expect(deadPages).not.toHaveBeenCalled()
    expect(pagePort.historyPageIds(DOMAIN)).toEqual(['tab:1'])
  })
})
