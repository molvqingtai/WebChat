import { describe, expect, it, vi } from 'vitest'
import { Remesh } from 'remesh'
import ChatRoomDomain from '@/domain/ChatRoom'
import MessageInputDomain from '@/domain/MessageInput'
import MessageListDomain from '@/domain/MessageList'
import UserInfoDomain, { type UserInfo } from '@/domain/UserInfo'
import { ChatRoomExtern, type ChatRoom } from '@/domain/externs/ChatRoom'
import { ReadinessExtern } from '@/domain/externs/Readiness'
import { createMemoryMessageDatabase } from '@/domain/impls/database/Memory'
import { ChatRoom as RuntimeChatRoom } from '@/domain/impls/runtime/ChatRoom'
import { MessageDatabaseExtern, createMessageStore } from '@/domain/MessageStore'
import {
  MESSAGE_RECORD_TYPE,
  NOTICE_TYPE,
  type MessageRecord,
  type SystemNoticeRecord,
  type TextMessageRecord
} from '@/domain/Message'
import { BrowserSyncStorageExtern, type Storage, type StorageValue } from '@/domain/externs/Storage'
import { WorldRoomExtern } from '@/domain/externs/WorldRoom'
import { MESSAGE_TYPE, type ChatMessage, type ChatSession } from '@/protocol'
import type { RuntimeServer, RuntimeSessionEvent, RuntimeSnapshot } from '@/runtime/Contract'
import { stringToHex } from '@/utils'

const SELF: UserInfo = {
  id: 'local-user',
  name: 'Local',
  avatar: '',
  createTime: 1,
  themeMode: 'system',
  danmakuEnabled: true,
  notificationEnabled: true,
  notificationType: 'at'
}
const REMOTE = { id: 'remote-user', name: 'Remote', avatar: '' }
const SELF_SESSION = { sessionId: 'local-session', user: SELF }
const REMOTE_SESSION = { sessionId: 'remote-session', user: REMOTE }
let databaseId = 0

const deferred = () => {
  let resolve!: () => void
  const promise = new Promise<void>((next) => {
    resolve = next
  })
  return { promise, resolve }
}

const createFixture = (options: { delayRecordWatch?: boolean } = {}) => {
  vi.stubGlobal('document', {
    location: { origin: 'https://example.test' },
    title: '',
    querySelector: () => null
  })
  const database = createMemoryMessageDatabase(`chat-domain-${databaseId++}`)
  const recordWatchNotifications = new Set<() => void>()
  if (options.delayRecordWatch) {
    const watch = database.watch.bind(database)
    database.watch = ((stores, listener) =>
      watch(stores, () => recordWatchNotifications.add(listener))) as typeof database.watch
  }
  const messageStore = createMessageStore(database)
  const storage: Storage = {
    get: async <T extends StorageValue>() => SELF as T,
    set: async () => {},
    watch: async () => async () => {}
  }
  const readinessListeners = new Set<(state: 'connecting' | 'ready' | 'unavailable') => void>()
  const listeners = {
    message: new Set<(message: ChatMessage) => void>(),
    join: new Set<(session: ChatSession) => void>(),
    leave: new Set<(session: ChatSession) => void>(),
    sessions: new Set<(sessions: readonly ChatSession[]) => void>(),
    error: new Set<(error: Error) => void>()
  }
  const subscribe = <T>(listeners: Set<(value: T) => void>, listener: (value: T) => void) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }
  const chat: ChatRoom = {
    joinRoom: vi.fn(async () => {}),
    leaveRoom: vi.fn(async () => {}),
    sendMessage: vi.fn(async (command) => {
      if (command.type === 'reaction') {
        const message = {
          type: MESSAGE_TYPE.REACTION,
          id: 'local-reaction',
          hlc: { timestamp: 4, counter: 0 },
          targetId: command.targetId,
          userId: SELF.id,
          reaction: command.reaction,
          active: command.active
        } as const
        await messageStore.insert({
          type: MESSAGE_RECORD_TYPE.CHAT_MESSAGE,
          id: message.id,
          message,
          user: { id: SELF.id, name: SELF.name, avatar: SELF.avatar },
          receivedAt: 4
        })
        return message
      }
      const message = {
        type: MESSAGE_TYPE.TEXT,
        id: 'local-message',
        hlc: { timestamp: 4, counter: 0 },
        userId: SELF.id,
        body: command.body,
        mentions: command.mentions
      } as const
      await messageStore.insert({
        type: MESSAGE_RECORD_TYPE.CHAT_MESSAGE,
        id: message.id,
        message,
        user: { id: SELF.id, name: SELF.name, avatar: SELF.avatar },
        receivedAt: 4
      })
      return message
    }),
    onMessage: (listener) => subscribe(listeners.message, listener),
    onJoinRoom: (listener) => subscribe(listeners.join, listener),
    onLeaveRoom: (listener) => subscribe(listeners.leave, listener),
    onSessions: (listener) => subscribe(listeners.sessions, listener),
    onError: (listener) => subscribe(listeners.error, listener)
  }

  const store = Remesh.store({
    externs: [
      ChatRoomExtern.impl(chat),
      ReadinessExtern.impl({
        onState: (listener) => {
          readinessListeners.add(listener)
          return () => readinessListeners.delete(listener)
        }
      }),
      MessageDatabaseExtern.impl(database),
      BrowserSyncStorageExtern.impl(storage),
      WorldRoomExtern.impl({
        getState: async () => [],
        onState: () => () => {},
        onError: () => () => {}
      })
    ]
  })
  const chatAction = ChatRoomDomain()
  const inputAction = MessageInputDomain()
  const listAction = MessageListDomain()
  const userAction = UserInfoDomain()
  const room = store.getDomain(chatAction)
  const input = store.getDomain(inputAction)
  const list = store.getDomain(listAction)
  const user = store.getDomain(userAction)
  store.igniteDomain(chatAction)
  store.send(user.command.UpdateUserInfoCommand(SELF))

  return {
    store,
    room,
    input,
    list,
    user,
    chat,
    records: () => messageStore.query(),
    persistRecord: (record: MessageRecord) => messageStore.insert(record),
    emitMessage: (message: ChatMessage) => listeners.message.forEach((listener) => listener(message)),
    emitJoin: (session: ChatSession) => listeners.join.forEach((listener) => listener(session)),
    emitLeave: (session: ChatSession) => listeners.leave.forEach((listener) => listener(session)),
    emitSessions: (sessions: readonly ChatSession[]) => listeners.sessions.forEach((listener) => listener(sessions)),
    emitError: (error: Error) => listeners.error.forEach((listener) => listener(error)),
    emitReadiness: (state: 'connecting' | 'ready' | 'unavailable') =>
      readinessListeners.forEach((listener) => listener(state))
  }
}

const join = async (fixture: ReturnType<typeof createFixture>) => {
  fixture.store.send(fixture.room.command.JoinRoomCommand())
  await vi.waitFor(() => expect(fixture.store.query(fixture.room.query.JoinIsFinishedQuery())).toBe(true))
  fixture.emitSessions([SELF_SESSION])
}

describe('ChatRoomDomain exact application port', () => {
  it('joins with the current protocol user/site and derives users from sessions', async () => {
    const fixture = createFixture()
    await join(fixture)

    expect(fixture.chat.joinRoom).toHaveBeenCalledWith({
      user: SELF,
      site: expect.objectContaining({ origin: 'https://example.test' })
    })
    expect(fixture.store.query(fixture.room.query.UserListQuery())).toEqual([SELF])
    await expect(fixture.records()).resolves.toEqual([])
    fixture.store.discard()
  })

  it('reissues the retained join from the page domain after host readiness returns', async () => {
    const fixture = createFixture()
    await join(fixture)
    expect(fixture.chat.joinRoom).toHaveBeenCalledOnce()

    fixture.emitReadiness('connecting')
    fixture.emitReadiness('ready')

    await vi.waitFor(() => expect(fixture.chat.joinRoom).toHaveBeenCalledTimes(2))
    expect(fixture.chat.joinRoom).toHaveBeenLastCalledWith({
      user: SELF,
      site: expect.objectContaining({ origin: 'https://example.test' })
    })
    fixture.store.discard()
  })

  it('uses the snapshot as truth before persisting one live join or leave notice', async () => {
    const fixture = createFixture()
    await join(fixture)

    fixture.emitSessions([SELF_SESSION, REMOTE_SESSION])
    fixture.emitJoin(REMOTE_SESSION)
    await vi.waitFor(async () => expect(await fixture.records()).toHaveLength(1))
    expect(fixture.store.query(fixture.room.query.UserListQuery())).toEqual([SELF, REMOTE])

    fixture.emitSessions([SELF_SESSION])
    fixture.emitLeave(REMOTE_SESSION)
    await vi.waitFor(async () => expect(await fixture.records()).toHaveLength(2))
    const records = await fixture.records()
    expect(records.map((record) => record.id)).toEqual([
      expect.stringMatching(/^notice:/),
      expect.stringMatching(/^notice:/)
    ])
    expect(
      records.every((record) => record.type === MESSAGE_RECORD_TYPE.SYSTEM_NOTICE && record.id === record.notice.id)
    ).toBe(true)
    expect(fixture.store.query(fixture.room.query.UserListQuery())).toEqual([SELF])
    fixture.store.discard()
  })

  it('preserves Chat winners while remote lifecycle notices converge to deterministic fallback slots', async () => {
    const fixture = createFixture()
    await join(fixture)
    const joinId = `notice:${stringToHex(`join:${REMOTE_SESSION.sessionId}`)}`
    const leaveId = `notice:${stringToHex(`leave:${REMOTE_SESSION.sessionId}`)}`
    const collision = (id: string): TextMessageRecord => ({
      type: MESSAGE_RECORD_TYPE.CHAT_MESSAGE,
      id,
      message: {
        type: MESSAGE_TYPE.TEXT,
        id,
        hlc: { timestamp: 2, counter: 0 },
        userId: REMOTE.id,
        body: `occupy ${id}`,
        mentions: []
      },
      user: REMOTE,
      receivedAt: 2
    })
    const joinWinner = collision(joinId)
    const leaveWinner = collision(leaveId)
    await fixture.persistRecord(joinWinner)
    await fixture.persistRecord(leaveWinner)

    fixture.emitSessions([SELF_SESSION, REMOTE_SESSION])
    fixture.emitJoin(REMOTE_SESSION)
    fixture.emitSessions([SELF_SESSION])
    fixture.emitLeave(REMOTE_SESSION)

    await vi.waitFor(async () =>
      expect(
        (await fixture.records()).filter((record) => record.type === MESSAGE_RECORD_TYPE.SYSTEM_NOTICE)
      ).toHaveLength(2)
    )
    const records = await fixture.records()
    expect(records.find((record) => record.id === joinId)).toEqual(joinWinner)
    expect(records.find((record) => record.id === leaveId)).toEqual(leaveWinner)
    const notices = records.filter(
      (record): record is SystemNoticeRecord =>
        record.type === MESSAGE_RECORD_TYPE.SYSTEM_NOTICE && record.user.id === REMOTE.id
    )
    expect(notices.map((record) => record.notice.type)).toEqual([NOTICE_TYPE.JOIN, NOTICE_TYPE.LEAVE])
    expect(notices.every((record) => record.id !== joinId && record.id !== leaveId)).toBe(true)
    fixture.store.discard()
  })

  it('projects same-user Runtime sessions as one integrated membership lifecycle', async () => {
    const domain = 'https://same-user.example'
    const user = { id: SELF.id, name: SELF.name, avatar: SELF.avatar }
    const local = { sessionId: 'local-session', user, joinedAt: 100 }
    const remote = { sourcePeerId: 'remote-peer', sessionId: 'remote-session-1', user, joinedAt: 200 }
    const replacement = { ...remote, sessionId: 'remote-session-2', joinedAt: 300 }
    const runtimeSnapshot: RuntimeSnapshot = {
      hostId: 'same-user-host',
      hostPhase: 'ready',
      peerId: 'local-peer',
      domains: [
        {
          domain,
          phase: 'active',
          pageIds: ['page-1'],
          chatRoomJoined: true,
          localSession: local,
          sessions: []
        }
      ],
      world: { joined: false, peerId: 'local-peer', presences: [] }
    }
    let sessionListener: ((event: RuntimeSessionEvent) => void | Promise<void>) | undefined
    const server = {
      attachPage: async () => runtimeSnapshot,
      detachPage: async () => {},
      getSnapshot: async () => runtimeSnapshot,
      joinChatRoom: async () => {
        await sessionListener?.({
          type: 'snapshot',
          domain,
          snapshot: { localSession: local, sessions: [] },
          provenance: 'join'
        })
        return runtimeSnapshot
      },
      leaveChatRoom: async () => {},
      allocateTextMessage: async () => {
        throw new Error('not used')
      },
      allocateReactionMessage: async () => {
        throw new Error('not used')
      },
      sendChatMessage: async () => {},
      ackInbound: async () => {},
      replayInbound: async () => [],
      reconnectDomain: async () => {},
      onInbound: async () => {},
      onSessionEvent: async (_payload, listener) => {
        sessionListener = listener
      },
      onWorldPresence: async () => {},
      onError: async () => {},
      provideHistory: async () => {},
      resolveHistorySupply: async () => {},
      rejectHistorySupply: async () => {}
    } as RuntimeServer
    const database = createMemoryMessageDatabase(`same-user-domain-${databaseId++}`)
    const messageStore = createMessageStore(database)
    const adapter = new RuntimeChatRoom({
      server,
      messageStore,
      pageDomain: domain,
      pageId: 'page-1',
      getSnapshot: () => runtimeSnapshot,
      whenReady: (listener) => {
        listener()
        return () => {}
      }
    })
    const storage: Storage = {
      get: async <T extends StorageValue>() => SELF as T,
      set: async () => {},
      watch: async () => async () => {}
    }
    vi.stubGlobal('document', { location: { origin: domain }, title: '', querySelector: () => null })
    const store = Remesh.store({
      externs: [
        ChatRoomExtern.impl(adapter),
        ReadinessExtern.impl({ onState: () => () => {} }),
        MessageDatabaseExtern.impl(database),
        BrowserSyncStorageExtern.impl(storage)
      ]
    })
    const chatAction = ChatRoomDomain()
    const userAction = UserInfoDomain()
    const room = store.getDomain(chatAction)
    const userInfo = store.getDomain(userAction)
    store.igniteDomain(chatAction)
    store.send(userInfo.command.UpdateUserInfoCommand(SELF))
    store.send(room.command.JoinRoomCommand())
    await vi.waitFor(() => expect(store.query(room.query.JoinIsFinishedQuery())).toBe(true))
    await vi.waitFor(async () => expect(await messageStore.query()).toHaveLength(1))

    await sessionListener?.({
      type: 'join',
      domain,
      snapshot: { localSession: local, sessions: [remote] },
      session: remote,
      provenance: 'live'
    })
    await sessionListener?.({
      type: 'replace',
      domain,
      snapshot: { localSession: local, sessions: [replacement] },
      previous: remote,
      session: replacement,
      occurredAt: 300,
      provenance: 'live'
    })
    await sessionListener?.({
      type: 'leave',
      domain,
      snapshot: { localSession: local, sessions: [] },
      session: replacement,
      occurredAt: 400,
      provenance: 'live'
    })
    await new Promise((resolve) => globalThis.setTimeout(resolve, 0))

    const notices = (await messageStore.query()).filter(
      (record): record is SystemNoticeRecord =>
        record.type === MESSAGE_RECORD_TYPE.SYSTEM_NOTICE && record.user.id === SELF.id
    )
    expect(notices.map((record) => record.notice.type)).toEqual([NOTICE_TYPE.JOIN])
    expect(store.query(room.query.UserListQuery())).toEqual([user])
    store.discard()
    adapter.dispose()
  })

  it('projects only the natural remote text callback into the live-message event', async () => {
    const fixture = createFixture()
    await join(fixture)
    fixture.emitSessions([SELF_SESSION, REMOTE_SESSION])
    const messages: string[] = []
    fixture.store.subscribeEvent(fixture.room.event.OnTextMessageEvent, (message) => messages.push(message.id))

    fixture.emitMessage({
      type: MESSAGE_TYPE.TEXT,
      id: 'remote-text',
      hlc: { timestamp: 2, counter: 0 },
      userId: REMOTE.id,
      body: 'hello',
      mentions: []
    })
    fixture.emitMessage({
      type: MESSAGE_TYPE.REACTION,
      id: 'remote-reaction',
      hlc: { timestamp: 3, counter: 0 },
      targetId: 'remote-text',
      userId: REMOTE.id,
      reaction: 'like',
      active: true
    })

    expect(messages).toEqual(['remote-text'])
    fixture.store.discard()
  })

  it('refreshes the canonical list when a persisted live message arrives before its store watch', async () => {
    const fixture = createFixture({ delayRecordWatch: true })
    await join(fixture)
    await vi.waitFor(() => expect(fixture.store.query(fixture.list.query.LoadIsFinishedQuery())).toBe(true))
    fixture.emitSessions([SELF_SESSION, REMOTE_SESSION])
    const record: TextMessageRecord = {
      type: MESSAGE_RECORD_TYPE.CHAT_MESSAGE,
      id: 'remote-persisted',
      message: {
        type: MESSAGE_TYPE.TEXT,
        id: 'remote-persisted',
        hlc: { timestamp: 2, counter: 0 },
        userId: REMOTE.id,
        body: 'persisted before callback',
        mentions: []
      },
      user: REMOTE,
      receivedAt: 2
    }
    await fixture.persistRecord(record)
    expect(fixture.store.query(fixture.list.query.RecordListQuery())).toEqual([])
    const live: string[] = []
    fixture.store.subscribeEvent(fixture.room.event.OnTextMessageEvent, (message) => live.push(message.id))

    fixture.emitMessage(record.message)

    await vi.waitFor(() => expect(live).toEqual([record.id]))
    await vi.waitFor(() =>
      expect(fixture.store.query(fixture.list.query.RecordListQuery()).map(({ id }) => id)).toEqual([record.id])
    )
    fixture.store.discard()
  })

  it('projects the returned local identity once, clears the draft, and composes reconnect immediately', async () => {
    const fixture = createFixture()
    await join(fixture)
    const projected: string[] = []
    fixture.store.subscribeEvent(fixture.room.event.SendTextMessageEvent, (message) => projected.push(message.id))
    fixture.store.send(fixture.input.command.InputCommand('hello'))

    fixture.store.send(fixture.room.command.SendTextMessageCommand('hello'))
    await vi.waitFor(() =>
      expect(fixture.chat.sendMessage).toHaveBeenCalledWith({ type: 'text', body: 'hello', mentions: [] })
    )
    await vi.waitFor(() => expect(projected).toEqual(['local-message']))
    expect(fixture.store.query(fixture.input.query.MessageQuery())).toBe('')

    fixture.store.send(fixture.room.command.ReconnectCommand())
    const request = fixture.store.query(fixture.room.query.ReconnectRequestQuery())!
    expect(request).toEqual({
      id: 1,
      toast: { attempted: false, settled: false },
      outcome: null
    })
    await vi.waitFor(() => expect(fixture.chat.leaveRoom).toHaveBeenCalledTimes(1))
    await vi.waitFor(() => expect(fixture.chat.joinRoom).toHaveBeenCalledTimes(2))
    await vi.waitFor(() =>
      expect(fixture.store.query(fixture.room.query.ReconnectRequestQuery())).toEqual({
        ...request,
        outcome: {}
      })
    )

    fixture.store.send(fixture.room.command.OmitToastCommand(request.id))
    await vi.waitFor(() => expect(fixture.store.query(fixture.room.query.ReconnectRequestQuery())).toBeNull())
    fixture.store.discard()
  })

  it('joins immediate operation and Toast settlement while fencing duplicate and stale signals', async () => {
    const reconnect = deferred()
    const fixture = createFixture()
    await join(fixture)
    vi.mocked(fixture.chat.leaveRoom).mockReturnValueOnce(reconnect.promise)
    const started: number[] = []
    const finished: { id: number; error?: Error }[] = []
    fixture.store.subscribeEvent(fixture.room.event.ReconnectStartedEvent, (id) => started.push(id))
    fixture.store.subscribeEvent(fixture.room.event.ReconnectFinishedEvent, (result) => finished.push(result))

    fixture.store.send(fixture.room.command.ReconnectCommand())
    fixture.store.send(fixture.room.command.ReconnectCommand())

    const request = fixture.store.query(fixture.room.query.ReconnectRequestQuery())!
    expect(request).toEqual({
      id: 1,
      toast: { attempted: false, settled: false },
      outcome: null
    })
    expect(fixture.store.query(fixture.room.query.ReconnectIsLoadingQuery())).toBe(true)
    expect(started).toEqual([request.id])
    await vi.waitFor(() => expect(fixture.chat.leaveRoom).toHaveBeenCalledOnce())

    fixture.store.send(fixture.room.command.BeginToastCommand(request.id + 1))
    expect(fixture.store.query(fixture.room.query.ReconnectRequestQuery())).toEqual(request)
    fixture.store.send(fixture.room.command.BeginToastCommand(request.id))
    fixture.store.send(fixture.room.command.BeginToastCommand(request.id))

    expect(fixture.store.query(fixture.room.query.ReconnectRequestQuery())).toEqual({
      id: request.id,
      toast: { attempted: true, settled: false },
      outcome: null
    })

    fixture.store.send(fixture.room.command.SettleToastCommand(request.id + 1))
    fixture.store.send(fixture.room.command.SettleToastCommand(request.id))
    fixture.store.send(fixture.room.command.SettleToastCommand(request.id))
    expect(finished).toEqual([])
    expect(fixture.store.query(fixture.room.query.ReconnectRequestQuery())).toEqual({
      id: request.id,
      toast: { attempted: true, settled: true },
      outcome: null
    })

    reconnect.resolve()
    await vi.waitFor(() => expect(finished).toEqual([{ id: request.id }]))
    expect(fixture.store.query(fixture.room.query.ReconnectRequestQuery())).toBeNull()
    expect(fixture.store.query(fixture.room.query.ReconnectIsLoadingQuery())).toBe(false)
    expect(fixture.chat.joinRoom).toHaveBeenCalledTimes(2)
    fixture.store.discard()
  })

  it('retries an omitted active Toast while fencing settled and stale callbacks', async () => {
    const firstReconnect = deferred()
    const secondReconnect = deferred()
    const fixture = createFixture()
    await join(fixture)
    vi.mocked(fixture.chat.leaveRoom)
      .mockReturnValueOnce(firstReconnect.promise)
      .mockReturnValueOnce(secondReconnect.promise)

    fixture.store.send(fixture.room.command.ReconnectCommand())
    const first = fixture.store.query(fixture.room.query.ReconnectRequestQuery())!
    await vi.waitFor(() => expect(fixture.chat.leaveRoom).toHaveBeenCalledOnce())
    fixture.store.send(fixture.room.command.OmitToastCommand(first.id))
    expect(fixture.store.query(fixture.room.query.ReconnectRequestQuery())).toEqual({
      ...first,
      toast: { attempted: false, settled: true }
    })

    fixture.store.send(fixture.room.command.BeginToastCommand(first.id))
    expect(fixture.store.query(fixture.room.query.ReconnectRequestQuery())).toEqual({
      ...first,
      toast: { attempted: true, settled: false }
    })
    fixture.store.send(fixture.room.command.OmitToastCommand(first.id))
    expect(fixture.store.query(fixture.room.query.ReconnectRequestQuery())).toEqual({
      ...first,
      toast: { attempted: false, settled: true }
    })
    fixture.store.send(fixture.room.command.BeginToastCommand(first.id))
    expect(fixture.store.query(fixture.room.query.ReconnectRequestQuery())).toEqual({
      ...first,
      toast: { attempted: true, settled: false }
    })
    fixture.store.send(fixture.room.command.SettleToastCommand(first.id))
    const settled = fixture.store.query(fixture.room.query.ReconnectRequestQuery())
    expect(settled).toEqual({
      ...first,
      toast: { attempted: true, settled: true }
    })
    fixture.store.send(fixture.room.command.BeginToastCommand(first.id))
    expect(fixture.store.query(fixture.room.query.ReconnectRequestQuery())).toEqual(settled)

    firstReconnect.resolve()
    await vi.waitFor(() => expect(fixture.store.query(fixture.room.query.ReconnectRequestQuery())).toBeNull())

    fixture.store.send(fixture.room.command.ReconnectCommand())
    const second = fixture.store.query(fixture.room.query.ReconnectRequestQuery())!
    await vi.waitFor(() => expect(fixture.chat.leaveRoom).toHaveBeenCalledTimes(2))
    fixture.store.send(fixture.room.command.BeginToastCommand(first.id))
    fixture.store.send(fixture.room.command.SettleToastCommand(first.id))
    fixture.store.send(fixture.room.command.OmitToastCommand(first.id))
    expect(fixture.store.query(fixture.room.query.ReconnectRequestQuery())).toEqual(second)

    fixture.store.send(fixture.room.command.OmitToastCommand(second.id))
    secondReconnect.resolve()
    await vi.waitFor(() => expect(fixture.store.query(fixture.room.query.ReconnectRequestQuery())).toBeNull())
    fixture.store.discard()
  })

  it.each([
    { rejection: new Error('reconnect failed'), message: 'reconnect failed' },
    { rejection: 'transport reset', message: 'transport reset' }
  ])('normalizes $message and settles it through an omitted Toast', async ({ rejection, message }) => {
    const fixture = createFixture()
    await join(fixture)
    vi.mocked(fixture.chat.leaveRoom).mockRejectedValueOnce(rejection)
    const finished: { id: number; error?: Error }[] = []
    const roomErrors: Error[] = []
    fixture.store.subscribeEvent(fixture.room.event.ReconnectFinishedEvent, (result) => finished.push(result))
    fixture.store.subscribeEvent(fixture.room.event.OnErrorEvent, (error) => roomErrors.push(error))

    fixture.store.send(fixture.room.command.ReconnectCommand())
    const request = fixture.store.query(fixture.room.query.ReconnectRequestQuery())!
    await vi.waitFor(() =>
      expect(fixture.store.query(fixture.room.query.ReconnectRequestQuery())?.outcome).toEqual({
        error: new Error(message)
      })
    )
    fixture.store.send(fixture.room.command.OmitToastCommand(request.id))

    await vi.waitFor(() => expect(finished).toHaveLength(1))
    expect(finished[0]).toEqual({ id: request.id, error: new Error(message) })
    expect(fixture.store.query(fixture.room.query.ReconnectIsLoadingQuery())).toBe(false)
    expect(roomErrors).toEqual([])
    fixture.store.discard()
  })

  it('does not fabricate a local projection when the send-first port rejects', async () => {
    const fixture = createFixture()
    const projected: string[] = []
    const errors: Error[] = []
    fixture.store.subscribeEvent(fixture.room.event.SendTextMessageEvent, (message) => projected.push(message.id))
    fixture.store.subscribeEvent(fixture.room.event.OnErrorEvent, (error) => errors.push(error))
    vi.mocked(fixture.chat.sendMessage).mockRejectedValueOnce(new Error('local persistence failed'))
    fixture.store.send(fixture.input.command.InputCommand('hello'))

    fixture.store.send(fixture.room.command.SendTextMessageCommand('hello'))

    await vi.waitFor(() => expect(errors).toEqual([new Error('local persistence failed')]))
    expect(projected).toEqual([])
    expect(fixture.store.query(fixture.input.query.MessageQuery())).toBe('hello')
    await expect(fixture.records()).resolves.toEqual([])
    fixture.store.discard()
  })

  it('routes port errors without exposing Runtime details', async () => {
    const fixture = createFixture()
    const errors: Error[] = []
    fixture.store.subscribeEvent(fixture.room.event.OnErrorEvent, (error) => errors.push(error))
    const error = new Error('Runtime unavailable')

    fixture.emitError(error)

    expect(errors).toEqual([error])
    fixture.store.discard()
  })
})
