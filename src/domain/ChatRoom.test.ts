import { describe, expect, it, vi } from 'vitest'
import { Remesh } from 'remesh'
import ChatRoomDomain from '@/domain/ChatRoom'
import MessageInputDomain from '@/domain/MessageInput'
import MessageListDomain from '@/domain/MessageList'
import UserInfoDomain, { type UserInfo } from '@/domain/UserInfo'
import { ChatRoomExtern, type ChatRoom, type SendMessageCommand } from '@/domain/externs/ChatRoom'
import { ReadinessExtern } from '@/domain/externs/Readiness'
import { ConnectionLifecycleExtern, type ConnectionLifecycleResult } from '@/domain/externs/ConnectionLifecycle'
import { SendLifecycleExtern } from '@/domain/externs/SendLifecycle'
import { createConnectionLifecycle } from '@/domain/impls/ConnectionLifecycle'
import { createSendLifecycle } from '@/domain/impls/SendLifecycle'
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

const WIRE_SELF = { id: 'local-user', name: 'Local', avatar: '' }
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
  let reject!: (reason?: unknown) => void
  const promise = new Promise<void>((next, fail) => {
    resolve = next
    reject = fail
  })
  return { promise, resolve, reject }
}

const createFixture = (options: { delayRecordWatch?: boolean; user?: UserInfo | null } = {}) => {
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
  const configuredUser = options.user === undefined ? SELF : options.user
  const storage: Storage = {
    get: async <T extends StorageValue>() => configuredUser as T,
    set: async () => {},
    watch: async () => async () => {}
  }
  const readinessListeners = new Set<(state: 'connecting' | 'ready' | 'unavailable') => void>()
  let lifecycleResult: ConnectionLifecycleResult = 'active'
  let lifecycleSeq = 0
  const lifecycleByTask = new WeakMap<Promise<void>, number>()
  const lifecycleResults = new Map<number, ConnectionLifecycleResult>()
  const consumedLifecycleTasks: unknown[] = []
  const lifecycle = {
    mint: () => {
      const token = ++lifecycleSeq
      lifecycleResults.set(token, 'active')
      return token
    },
    bindTask: (task: Promise<void>, token: number) => {
      lifecycleByTask.set(task, token)
    },
    getTaskResult: (task: Promise<void>) => {
      const token = lifecycleByTask.get(task)
      consumedLifecycleTasks.push(task)
      if (token === undefined) return lifecycleResult
      const result = lifecycleResults.get(token) ?? lifecycleResult
      if (result !== 'active') lifecycleResults.delete(token)
      return result
    }
  }
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
    sendMessage: vi.fn(async (command: SendMessageCommand) => {
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
    }) as unknown as ChatRoom['sendMessage'],
    onMessage: (listener) => subscribe(listeners.message, listener),
    onJoinRoom: (listener) => subscribe(listeners.join, listener),
    onLeaveRoom: (listener) => subscribe(listeners.leave, listener),
    onSessions: (listener) => subscribe(listeners.sessions, listener),
    onError: (listener) => subscribe(listeners.error, listener)
  }

  const sendLifecycleLocal = createSendLifecycle()
  const store = Remesh.store({
    externs: [
      ChatRoomExtern.impl(chat),
      ConnectionLifecycleExtern.impl({
        mint: lifecycle.mint,
        bindTask: lifecycle.bindTask,
        getTaskResult: lifecycle.getTaskResult
      }),
      SendLifecycleExtern.impl(sendLifecycleLocal),
      ReadinessExtern.impl({
        onState: (listener) => {
          readinessListeners.add(listener)
          listener('ready')
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
  store.send(user.command.UpdateUserInfoCommand(configuredUser))

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
      readinessListeners.forEach((listener) => listener(state)),
    setLifecycleResult: (result: ConnectionLifecycleResult) => {
      lifecycleResult = result
    },
    setTaskResult: (task: Promise<void>, result: ConnectionLifecycleResult) => {
      const token = lifecycleByTask.get(task)
      if (token !== undefined) lifecycleResults.set(token, result)
    },
    bindLifecycleTask: (task: Promise<void>, result: ConnectionLifecycleResult) => {
      const token = ++lifecycleSeq
      lifecycleResults.set(token, result)
      lifecycleByTask.set(task, token)
      return token
    },
    consumedLifecycleTasks,
    cancelActiveSends: () => sendLifecycleLocal.cancelActiveSends()
  }
}

const join = async (fixture: ReturnType<typeof createFixture>) => {
  fixture.store.send(fixture.room.command.JoinRoomCommand())
  await vi.waitFor(() => expect(fixture.store.query(fixture.room.query.JoinIsFinishedQuery())).toBe(true))
  fixture.emitSessions([SELF_SESSION])
}

type PendingConnectionStage = 'callback-registration' | 'replay' | 'replay-write'

const createPendingConnectionFixture = (stage: PendingConnectionStage) => {
  vi.stubGlobal('document', {
    location: { origin: 'https://pending-connection.example' },
    title: '',
    querySelector: () => null
  })
  const domain = 'https://pending-connection.example'
  const localUser = { id: SELF.id, name: SELF.name, avatar: SELF.avatar }
  const local = { sessionId: 'local-session', user: localUser, joinedAt: 1 }
  const remote = { sourcePeerId: 'remote-peer', sessionId: 'remote-session', user: REMOTE, joinedAt: 2 }
  let hostId = 'host-1'
  let joinCalls = 0
  let sessionRegistrationCalls = 0
  let replayCalls = 0
  let readyListener: (() => void) | null = null
  let sessionListener: ((event: RuntimeSessionEvent) => void | Promise<void>) | undefined
  const entered = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  const errors: Error[] = []
  const connectedSnapshot = (): RuntimeSnapshot => ({
    hostId,
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
    world: { joined: true, peerId: 'local-peer', presences: [] }
  })
  const replayRecord: TextMessageRecord = {
    type: MESSAGE_RECORD_TYPE.CHAT_MESSAGE,
    id: 'replayed-message',
    message: {
      type: MESSAGE_TYPE.TEXT,
      id: 'replayed-message',
      hlc: { timestamp: 1, counter: 0 },
      userId: REMOTE.id,
      body: 'replayed',
      mentions: []
    },
    user: REMOTE,
    receivedAt: 1
  }
  const server: RuntimeServer = {
    attachPage: async () => connectedSnapshot(),
    detachPage: async () => {},
    getSnapshot: async () => connectedSnapshot(),
    joinChatRoom: async () => {
      joinCalls += 1
      await sessionListener?.({
        type: 'snapshot',
        domain,
        snapshot: { localSession: local, sessions: [] },
        provenance: 'join'
      })
      return connectedSnapshot()
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
    replayInbound: async () => {
      replayCalls += 1
      if (stage === 'replay' && replayCalls === 1) {
        entered.resolve()
        await release.promise
      }
      return stage === 'replay-write' ? [{ sequence: 1, domain, record: replayRecord, source: 'history' as const }] : []
    },
    reconnectDomain: async () => {},
    onInbound: async () => {},
    onSessionEvent: async (_payload, listener) => {
      sessionRegistrationCalls += 1
      if (stage === 'callback-registration' && sessionRegistrationCalls === 1) {
        entered.resolve()
        await release.promise
      }
      sessionListener = listener
    },
    onWorldPresence: async () => {},
    onError: async () => {},
    provideHistory: async () => {},
    resolveHistorySupply: async () => {},
    rejectHistorySupply: async () => {},
    onHistoryFeedback: async () => {}
  }
  const database = createMemoryMessageDatabase(`pending-connection-${stage}-${databaseId++}`)
  const messageStore = createMessageStore(database)
  let replayWriteCalls = 0
  let replayWriteAborted = false
  if (stage === 'replay-write') {
    const insert = messageStore.insert.bind(messageStore)
    const controlled = messageStore as typeof messageStore & {
      insert: (record: MessageRecord, options?: { signal?: AbortSignal }) => ReturnType<typeof messageStore.insert>
    }
    controlled.insert = async (record, options: { signal?: AbortSignal } = {}) => {
      if (record.id === replayRecord.id && replayWriteCalls === 0) {
        replayWriteCalls += 1
        entered.resolve()
        await new Promise<void>((resolve, reject) => {
          const onAbort = () => {
            replayWriteAborted = true
            options?.signal?.removeEventListener('abort', onAbort)
            reject(options?.signal?.reason ?? new DOMException('Replay write aborted', 'AbortError'))
          }
          options?.signal?.addEventListener('abort', onAbort, { once: true })
          release.promise.then(() => {
            options?.signal?.removeEventListener('abort', onAbort)
            resolve()
          }, reject)
          if (options?.signal?.aborted) onAbort()
        })
      }
      return insert(record)
    }
  }
  const adapter = new RuntimeChatRoom({
    server,
    messageStore,
    pageDomain: domain,
    pageId: 'page-1',
    getSnapshot: connectedSnapshot,
    whenReady: (listener) => {
      readyListener = listener
      listener()
      return () => {
        if (readyListener === listener) readyListener = null
      }
    }
  })
  const lifecycleBundle = createConnectionLifecycle()
  adapter.bindConnectionResultReporter(lifecycleBundle.report)
  adapter.bindStandaloneInvocation(lifecycleBundle.value.mint, lifecycleBundle.value.bindTask)
  const storage: Storage = {
    get: async <T extends StorageValue>() => SELF as T,
    set: async () => {},
    watch: async () => async () => {}
  }
  const store = Remesh.store({
    externs: [
      ChatRoomExtern.impl(adapter),
      ConnectionLifecycleExtern.impl(lifecycleBundle.value),
      SendLifecycleExtern.impl(createSendLifecycle()),
      ReadinessExtern.impl({
        onState: (listener) => {
          listener('ready')
          return () => {}
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
  const userAction = UserInfoDomain()
  const room = store.getDomain(chatAction)
  const user = store.getDomain(userAction)
  store.igniteDomain(chatAction)
  store.subscribeEvent(room.event.ReconnectFinishedEvent, ({ error }) => {
    if (error) errors.push(error)
  })
  store.send(user.command.UpdateUserInfoCommand(SELF))

  return {
    adapter,
    entered: entered.promise,
    release: () => release.resolve(),
    startJoin: () => store.send(room.command.JoinRoomCommand()),
    loading: () => store.query(room.query.ConnectionIsLoadingQuery()),
    finished: () => store.query(room.query.JoinIsFinishedQuery()),
    users: () => store.query(room.query.UserListQuery()),
    errors,
    joinCalls: () => joinCalls,
    sessionRegistrationCalls: () => sessionRegistrationCalls,
    replayWriteAborted: () => replayWriteAborted,
    localUser,
    replaceHost: () => {
      hostId = 'host-2'
      readyListener?.()
    },
    emitRemote: async () => {
      await sessionListener?.({
        type: 'join',
        domain,
        snapshot: { localSession: local, sessions: [remote] },
        session: remote,
        provenance: 'live'
      })
    },
    records: () => messageStore.query(),
    dispose: async () => {
      release.resolve()
      store.discard()
      adapter.dispose()
      await database.close()
    }
  }
}

describe('ChatRoomDomain exact application port', () => {
  it('joins with the current protocol user/site and derives users from sessions', async () => {
    const fixture = createFixture()
    await join(fixture)

    expect(fixture.chat.joinRoom).toHaveBeenCalledWith({
      user: WIRE_SELF,
      site: expect.objectContaining({ origin: 'https://example.test' })
    })
    expect(fixture.store.query(fixture.room.query.UserListQuery())).toEqual([SELF])
    await expect(fixture.records()).resolves.toEqual([])
    fixture.store.discard()
  })

  it('derives recovery eligibility from configured identity and the initial join single-flight', async () => {
    const missingIdentity = createFixture({ user: null })

    expect(missingIdentity.store.query(missingIdentity.room.query.ReconnectAvailableQuery())).toBe(false)
    missingIdentity.store.send(missingIdentity.room.command.ReconnectCommand())
    expect(missingIdentity.store.query(missingIdentity.room.query.ReconnectRequestQuery())).toBeNull()
    expect(missingIdentity.chat.joinRoom).not.toHaveBeenCalled()
    expect(missingIdentity.chat.leaveRoom).not.toHaveBeenCalled()
    missingIdentity.store.discard()

    const initialJoin = deferred()
    const fixture = createFixture()
    vi.mocked(fixture.chat.joinRoom).mockReturnValueOnce(initialJoin.promise)

    fixture.store.send(fixture.room.command.JoinRoomCommand())
    await vi.waitFor(() => expect(fixture.chat.joinRoom).toHaveBeenCalledOnce())
    expect(fixture.store.query(fixture.room.query.ReconnectAvailableQuery())).toBe(false)

    fixture.store.send(fixture.room.command.ReconnectCommand())
    expect(fixture.store.query(fixture.room.query.ReconnectRequestQuery())).toBeNull()
    expect(fixture.chat.joinRoom).toHaveBeenCalledOnce()
    expect(fixture.chat.leaveRoom).not.toHaveBeenCalled()

    initialJoin.resolve()
    await vi.waitFor(() => expect(fixture.store.query(fixture.room.query.JoinIsFinishedQuery())).toBe(true))
    expect(fixture.store.query(fixture.room.query.ReconnectAvailableQuery())).toBe(true)
    fixture.store.discard()
  })

  it('projects a pending direct join through the unified connection loading query', async () => {
    const fixture = createFixture()
    const pending = deferred()
    vi.mocked(fixture.chat.joinRoom).mockReturnValueOnce(pending.promise)

    fixture.store.send(fixture.room.command.JoinRoomCommand())
    await vi.waitFor(() => expect(fixture.chat.joinRoom).toHaveBeenCalledOnce())

    expect(fixture.store.query(fixture.room.query.ConnectionOperationIsLoadingQuery())).toBe(true)
    expect(fixture.store.query(fixture.room.query.ConnectionIsLoadingQuery())).toBe(true)
    expect(fixture.store.query(fixture.room.query.ReconnectAvailableQuery())).toBe(false)

    pending.resolve()
    await vi.waitFor(() => expect(fixture.store.query(fixture.room.query.JoinIsFinishedQuery())).toBe(true))
    expect(fixture.store.query(fixture.room.query.ConnectionOperationIsLoadingQuery())).toBe(false)
    expect(fixture.store.query(fixture.room.query.ConnectionIsLoadingQuery())).toBe(false)
    expect(fixture.store.query(fixture.room.query.ReconnectAvailableQuery())).toBe(true)
    fixture.store.discard()
  })

  it('completes the page join when a committed local session projects after the public attempt failed', async () => {
    const fixture = createFixture()
    const failure = new Error('first join failed')
    vi.mocked(fixture.chat.joinRoom).mockRejectedValueOnce(failure)
    fixture.store.send(fixture.room.command.JoinRoomCommand())
    await vi.waitFor(() => expect(fixture.chat.joinRoom).toHaveBeenCalledOnce())
    await vi.waitFor(() => expect(fixture.store.query(fixture.room.query.ConnectionIsLoadingQuery())).toBe(false))
    expect(fixture.store.query(fixture.room.query.JoinIsFinishedQuery())).toBe(false)

    // The exact failure was already delivered; the join input stays retained for the projection.
    fixture.emitSessions([SELF_SESSION])
    await vi.waitFor(() => expect(fixture.store.query(fixture.room.query.JoinIsFinishedQuery())).toBe(true))
    fixture.store.discard()
  })

  it.each(['callback-registration', 'replay', 'replay-write'] as const)(
    'settles a timed-out %s attempt and admits a fresh page attempt',
    async (stage) => {
      vi.useFakeTimers()
      const fixture = createPendingConnectionFixture(stage)
      fixture.startJoin()
      await fixture.entered
      expect(fixture.users()).toEqual([])
      expect(fixture.loading()).toBe(true)

      try {
        await vi.advanceTimersByTimeAsync(10001)
        await vi.advanceTimersByTimeAsync(0)

        expect(fixture.finished()).toBe(false)
        expect(fixture.loading()).toBe(false)
        expect(fixture.users()).toEqual([])
        expect(fixture.joinCalls()).toBe(0)
        expect(fixture.errors).toEqual([new Error('Connection timed out')])

        fixture.startJoin()
        await vi.waitFor(() => expect(fixture.finished()).toBe(true))
        expect(fixture.loading()).toBe(false)
        expect(fixture.users()).toEqual([fixture.localUser])
        expect(fixture.joinCalls()).toBe(1)
        if (stage === 'replay-write') {
          expect(fixture.replayWriteAborted()).toBe(true)
          await expect(fixture.records()).resolves.toEqual(
            expect.arrayContaining([expect.objectContaining({ id: 'replayed-message' })])
          )
        }

        fixture.release()
        await vi.advanceTimersByTimeAsync(0)
        if (stage === 'callback-registration') {
          await vi.waitFor(() => expect(fixture.sessionRegistrationCalls()).toBeGreaterThanOrEqual(3))
          await fixture.emitRemote()
          expect(fixture.users()).toEqual([fixture.localUser, REMOTE])
        }
        expect(fixture.joinCalls()).toBe(1)
      } finally {
        fixture.release()
        await vi.advanceTimersByTimeAsync(0)
        await fixture.dispose()
        vi.useRealTimers()
      }
    }
  )

  it('cancels the old page attempt on host replacement and settles only the fresh generation', async () => {
    vi.useFakeTimers()
    const fixture = createPendingConnectionFixture('callback-registration')
    fixture.startJoin()
    await fixture.entered

    try {
      fixture.replaceHost()
      await vi.advanceTimersByTimeAsync(0)
      expect(fixture.loading()).toBe(false)
      expect(fixture.finished()).toBe(false)
      expect(fixture.users()).toEqual([])
      expect(fixture.joinCalls()).toBe(0)
      expect(fixture.errors).toEqual([])

      fixture.startJoin()
      await vi.waitFor(() => expect(fixture.finished()).toBe(true))
      expect(fixture.loading()).toBe(false)
      expect(fixture.users()).toEqual([fixture.localUser])
      expect(fixture.joinCalls()).toBe(1)

      fixture.release()
      await vi.advanceTimersByTimeAsync(0)
      await vi.waitFor(() => expect(fixture.sessionRegistrationCalls()).toBeGreaterThanOrEqual(3))
      await fixture.emitRemote()
      expect(fixture.users()).toEqual([fixture.localUser, REMOTE])
      expect(fixture.joinCalls()).toBe(1)
    } finally {
      fixture.release()
      await vi.advanceTimersByTimeAsync(0)
      await fixture.dispose()
      vi.useRealTimers()
    }
  })

  it('keeps the newest automatic operation as loading owner and settles cancellation without an error', async () => {
    const fixture = createFixture()
    await join(fixture)
    const identityRefresh = deferred()
    const hostRecovery = deferred()
    const connectionErrors: Error[] = []
    const roomErrors: Error[] = []
    fixture.store.subscribeEvent(fixture.room.event.ReconnectFinishedEvent, ({ error }) => {
      if (error) connectionErrors.push(error)
    })
    fixture.store.subscribeEvent(fixture.room.event.OnErrorEvent, (error) => roomErrors.push(error))
    vi.mocked(fixture.chat.joinRoom)
      .mockReturnValueOnce(identityRefresh.promise)
      .mockReturnValueOnce(hostRecovery.promise)

    fixture.store.send(fixture.user.command.UpdateUserInfoCommand({ ...SELF, name: 'Updated' }))
    await vi.waitFor(() => expect(fixture.chat.joinRoom).toHaveBeenCalledTimes(2))
    expect(fixture.store.query(fixture.room.query.ConnectionOperationIsLoadingQuery())).toBe(true)
    expect(fixture.store.query(fixture.room.query.ConnectionIsLoadingQuery())).toBe(true)

    fixture.emitReadiness('connecting')
    fixture.emitReadiness('ready')
    await vi.waitFor(() => expect(fixture.chat.joinRoom).toHaveBeenCalledTimes(3))
    expect(fixture.store.query(fixture.room.query.ConnectionOperationIsLoadingQuery())).toBe(true)
    expect(fixture.store.query(fixture.room.query.ConnectionIsLoadingQuery())).toBe(true)

    identityRefresh.resolve()
    await new Promise((resolve) => globalThis.setTimeout(resolve, 0))
    expect(fixture.store.query(fixture.room.query.ConnectionOperationIsLoadingQuery())).toBe(true)

    // The automatic host-recovery attempt is superseded: the Runtime records that exact attempt as a
    // structural cancellation, so its completion is silent (never classified from any caught error).
    fixture.setLifecycleResult('cancelled')
    hostRecovery.reject(new DOMException('Runtime operation superseded', 'AbortError'))
    await vi.waitFor(() => expect(fixture.store.query(fixture.room.query.ConnectionIsLoadingQuery())).toBe(false))
    expect(connectionErrors).toEqual([])
    expect(roomErrors).toEqual([])

    const refreshError = new Error('Identity refresh failed')
    vi.mocked(fixture.chat.joinRoom).mockRejectedValueOnce(refreshError)
    // A new attempt begins as `active` (the adapter's beginConnectionAttempt) and then genuinely fails:
    // its completion must surface the real error, not inherit a prior attempt's cancelled result.
    fixture.setLifecycleResult('active')
    fixture.store.send(fixture.user.command.UpdateUserInfoCommand({ ...SELF, name: 'Latest' }))
    await vi.waitFor(() => expect(connectionErrors).toEqual([refreshError]))
    expect(roomErrors).toEqual([refreshError])
    expect(fixture.store.query(fixture.room.query.ConnectionIsLoadingQuery())).toBe(false)
    fixture.store.discard()
  })

  it('consumes the exact result of a genuinely stale rejected connection task exactly once before staleness branching', async () => {
    const fixture = createFixture()
    await join(fixture) // joinRoom call 1 (baseline)
    const staleOp = deferred()
    const newerOp = deferred()
    const staleTask = staleOp.promise as unknown as Promise<void>
    const newerTask = newerOp.promise as unknown as Promise<void>
    fixture.bindLifecycleTask(staleTask, 'cancelled')
    fixture.bindLifecycleTask(newerTask, 'cancelled')
    vi.mocked(fixture.chat.joinRoom)
      .mockReturnValueOnce(staleTask as never) // call 2 (older op)
      .mockReturnValueOnce(newerTask as never) // call 3 (newer op, supersedes)

    // First held connection (call 2).
    fixture.store.send(fixture.user.command.UpdateUserInfoCommand({ ...SELF, name: 'One' }))
    await vi.waitFor(() => expect(fixture.chat.joinRoom).toHaveBeenCalledTimes(2))
    // A genuinely newer connection (call 3) supersedes it, making the first stale by request id.
    fixture.store.send(fixture.user.command.UpdateUserInfoCommand({ ...SELF, name: 'Two' }))
    await vi.waitFor(() => expect(fixture.chat.joinRoom).toHaveBeenCalledTimes(3))

    // The stale op rejects; its exact result must still be consumed exactly once before the request
    // staleness branch (a stale-first short circuit would skip getTaskResult and leak terminal state).
    staleOp.reject(new DOMException('Runtime operation superseded', 'AbortError'))
    await Promise.resolve()

    expect(fixture.consumedLifecycleTasks.filter((task) => task === staleTask)).toHaveLength(1)
    fixture.store.discard()
  })

  it('consumes the exact leave and join task results of a failing reconnect before branching', async () => {
    const fixture = createFixture()
    await join(fixture) // joinRoom call 1 (baseline)
    const leaveDeferred = deferred()
    const joinDeferred = deferred()
    const leaveTask = leaveDeferred.promise as unknown as Promise<void>
    const joinTask = joinDeferred.promise as unknown as Promise<void>
    fixture.bindLifecycleTask(leaveTask, 'failed')
    fixture.bindLifecycleTask(joinTask, 'failed')
    vi.mocked(fixture.chat.leaveRoom).mockReturnValueOnce(leaveTask as never)
    vi.mocked(fixture.chat.joinRoom).mockReturnValueOnce(joinTask as never)

    fixture.store.send(fixture.room.command.ReconnectCommand())
    await vi.waitFor(() => expect(fixture.chat.leaveRoom).toHaveBeenCalledTimes(1))
    // Let the leave settle so the reconnect proceeds to its joinRoom invocation.
    leaveDeferred.resolve()
    await vi.waitFor(() => expect(fixture.chat.joinRoom).toHaveBeenCalledTimes(2))

    // Reject the reconnect join; the ReconnectEffect consumes each started leave/join task in its catch
    // (leave settles successfully, join rejects) so neither terminal result leaks.
    joinDeferred.reject(new Error('reconnect join failed'))
    await Promise.resolve()

    // Both started reconnect tasks are consumed exactly once (leave in the catch after the join rejection).
    expect(fixture.consumedLifecycleTasks.filter((task) => task === leaveTask)).toHaveLength(1)
    expect(fixture.consumedLifecycleTasks.filter((task) => task === joinTask)).toHaveLength(1)
    fixture.store.discard()
  })

  it('retries a terminal failed join directly and completes the normal joined state once', async () => {
    const fixture = createFixture()
    const initialError = new Error('initial join failed')
    vi.mocked(fixture.chat.joinRoom).mockRejectedValueOnce(initialError)
    const selfJoins: number[] = []
    fixture.store.subscribeEvent(fixture.room.event.SelfJoinRoomEvent, () => selfJoins.push(1))

    fixture.store.send(fixture.room.command.JoinRoomCommand())
    await vi.waitFor(() => expect(fixture.store.query(fixture.room.query.ReconnectAvailableQuery())).toBe(true))
    fixture.emitReadiness('unavailable')
    expect(fixture.store.query(fixture.room.query.ReconnectAvailableQuery())).toBe(true)

    fixture.store.send(fixture.room.command.ReconnectCommand())
    const request = fixture.store.query(fixture.room.query.ReconnectRequestQuery())!
    fixture.store.send(fixture.room.command.ReconnectCommand())
    expect(fixture.store.query(fixture.room.query.ReconnectRequestQuery())?.id).toBe(request.id)
    expect(fixture.store.query(fixture.room.query.ConnectionIsLoadingQuery())).toBe(true)
    expect(fixture.store.query(fixture.room.query.ReconnectAvailableQuery())).toBe(false)
    expect(fixture.chat.leaveRoom).not.toHaveBeenCalled()

    await vi.waitFor(() => expect(fixture.store.query(fixture.room.query.JoinIsFinishedQuery())).toBe(true))
    await vi.waitFor(() => expect(fixture.store.query(fixture.room.query.ReconnectRequestQuery())?.outcome).toEqual({}))
    expect(fixture.chat.joinRoom).toHaveBeenCalledTimes(2)
    expect(fixture.chat.joinRoom).toHaveBeenLastCalledWith({
      user: WIRE_SELF,
      site: expect.objectContaining({ origin: 'https://example.test' })
    })
    expect(fixture.store.query(fixture.list.query.LoadIsFinishedQuery())).toBe(true)
    expect(selfJoins).toEqual([1])

    fixture.emitReadiness('ready')
    await vi.waitFor(() => expect(fixture.chat.joinRoom).toHaveBeenCalledTimes(3))
    expect(fixture.chat.joinRoom).toHaveBeenLastCalledWith({
      user: WIRE_SELF,
      site: expect.objectContaining({ origin: 'https://example.test' })
    })

    fixture.store.send(fixture.room.command.SettleReconnectIntervalCommand(request.id))
    await vi.waitFor(() => expect(fixture.store.query(fixture.room.query.ReconnectRequestQuery())).toBeNull())
    expect(fixture.store.query(fixture.room.query.ConnectionIsLoadingQuery())).toBe(false)
    expect(fixture.store.query(fixture.room.query.ReconnectAvailableQuery())).toBe(true)
    fixture.store.discard()
  })

  it('returns a failed direct retry to the same request error and retryable join state', async () => {
    const fixture = createFixture()
    vi.mocked(fixture.chat.joinRoom)
      .mockRejectedValueOnce(new Error('initial join failed'))
      .mockRejectedValueOnce('retry transport reset')
    const connectionErrors: Error[] = []
    const roomErrors: Error[] = []
    fixture.store.subscribeEvent(fixture.room.event.ReconnectFinishedEvent, ({ error }) => {
      if (error) connectionErrors.push(error)
    })
    fixture.store.subscribeEvent(fixture.room.event.OnErrorEvent, (error) => roomErrors.push(error))

    fixture.store.send(fixture.room.command.JoinRoomCommand())
    await vi.waitFor(() => expect(fixture.store.query(fixture.room.query.ReconnectAvailableQuery())).toBe(true))
    fixture.store.send(fixture.room.command.ReconnectCommand())
    const request = fixture.store.query(fixture.room.query.ReconnectRequestQuery())!

    await vi.waitFor(() =>
      expect(fixture.store.query(fixture.room.query.ReconnectRequestQuery())?.outcome).toEqual({
        error: new Error('retry transport reset')
      })
    )
    expect(fixture.store.query(fixture.room.query.JoinIsFinishedQuery())).toBe(false)
    expect(fixture.store.query(fixture.room.query.ReconnectAvailableQuery())).toBe(false)
    expect(fixture.chat.joinRoom).toHaveBeenCalledTimes(2)
    expect(fixture.chat.leaveRoom).not.toHaveBeenCalled()
    expect(connectionErrors).toEqual([new Error('initial join failed')])
    expect(roomErrors).toEqual([new Error('initial join failed'), new Error('retry transport reset')])

    fixture.store.send(fixture.room.command.SettleReconnectIntervalCommand(request.id))
    await vi.waitFor(() => expect(fixture.store.query(fixture.room.query.ReconnectRequestQuery())).toBeNull())
    expect(connectionErrors).toEqual([new Error('initial join failed'), new Error('retry transport reset')])
    expect(fixture.store.query(fixture.room.query.ReconnectAvailableQuery())).toBe(true)
    await new Promise((resolve) => globalThis.setTimeout(resolve, 0))
    expect(fixture.chat.joinRoom).toHaveBeenCalledTimes(2)
    fixture.store.discard()
  })

  it('reissues the retained join once for each actual host readiness transition', async () => {
    const fixture = createFixture()
    await join(fixture)
    expect(fixture.chat.joinRoom).toHaveBeenCalledOnce()

    fixture.emitReadiness('connecting')
    fixture.emitReadiness('ready')

    await vi.waitFor(() => expect(fixture.chat.joinRoom).toHaveBeenCalledTimes(2))
    expect(fixture.chat.joinRoom).toHaveBeenLastCalledWith({
      user: WIRE_SELF,
      site: expect.objectContaining({ origin: 'https://example.test' })
    })

    fixture.emitReadiness('ready')
    expect(fixture.chat.joinRoom).toHaveBeenCalledTimes(2)

    fixture.emitReadiness('connecting')
    fixture.emitReadiness('ready')
    await vi.waitFor(() => expect(fixture.chat.joinRoom).toHaveBeenCalledTimes(3))

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
      rejectHistorySupply: async () => {},
      onHistoryFeedback: async () => {}
    } satisfies RuntimeServer
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
    const lifecycleBundle = createConnectionLifecycle()
    adapter.bindConnectionResultReporter(lifecycleBundle.report)
    adapter.bindStandaloneInvocation(lifecycleBundle.value.mint, lifecycleBundle.value.bindTask)
    const store = Remesh.store({
      externs: [
        ChatRoomExtern.impl(adapter),
        ConnectionLifecycleExtern.impl(lifecycleBundle.value),
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
      intervalSettled: false,
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

    fixture.store.send(fixture.room.command.SettleReconnectIntervalCommand(request.id))
    await vi.waitFor(() => expect(fixture.store.query(fixture.room.query.ReconnectRequestQuery())).toBeNull())
    fixture.store.discard()
  })

  it('holds text and reaction operations until Runtime readiness returns without publishing an error', async () => {
    const fixture = createFixture()
    await join(fixture)
    const errors: Error[] = []
    fixture.store.subscribeEvent(fixture.room.event.OnErrorEvent, (error) => errors.push(error))

    fixture.emitReadiness('connecting')
    fixture.store.send(fixture.room.command.SendTextMessageCommand('held text'))
    await Promise.resolve()
    expect(fixture.chat.sendMessage).not.toHaveBeenCalled()

    fixture.emitReadiness('unavailable')
    await Promise.resolve()
    expect(fixture.chat.sendMessage).not.toHaveBeenCalled()

    fixture.emitReadiness('ready')
    await vi.waitFor(() =>
      expect(fixture.chat.sendMessage).toHaveBeenCalledWith({ type: 'text', body: 'held text', mentions: [] })
    )
    await vi.waitFor(() => expect(fixture.store.query(fixture.list.query.ItemQuery('local-message'))).not.toBeNull())
    vi.mocked(fixture.chat.sendMessage).mockClear()

    fixture.emitReadiness('connecting')
    fixture.store.send(fixture.room.command.SendReactionCommand({ messageId: 'local-message', reaction: 'like' }))
    await Promise.resolve()
    expect(fixture.chat.sendMessage).not.toHaveBeenCalled()

    fixture.emitReadiness('ready')
    await vi.waitFor(() =>
      expect(fixture.chat.sendMessage).toHaveBeenCalledWith({
        type: 'reaction',
        targetId: 'local-message',
        reaction: 'like',
        active: true
      })
    )
    expect(errors).toEqual([])
    fixture.store.discard()
  })

  it('holds a send behind an in-progress page connection and completes it after the join', async () => {
    const fixture = createFixture()
    const joining = deferred()
    vi.mocked(fixture.chat.joinRoom).mockReturnValueOnce(joining.promise)
    fixture.store.send(fixture.room.command.JoinRoomCommand())

    fixture.store.send(fixture.room.command.SendTextMessageCommand('during page recovery'))
    await Promise.resolve()
    expect(fixture.chat.sendMessage).not.toHaveBeenCalled()

    joining.resolve()
    await vi.waitFor(() =>
      expect(fixture.chat.sendMessage).toHaveBeenCalledWith({
        type: 'text',
        body: 'during page recovery',
        mentions: []
      })
    )
    fixture.store.discard()
  })

  it('starts the operation immediately and settles only its matching request interval', async () => {
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
      intervalSettled: false,
      outcome: null
    })
    expect(fixture.store.query(fixture.room.query.ReconnectIsLoadingQuery())).toBe(true)
    expect(started).toEqual([request.id])
    await vi.waitFor(() => expect(fixture.chat.leaveRoom).toHaveBeenCalledOnce())

    fixture.store.send(fixture.room.command.SettleReconnectIntervalCommand(request.id + 1))
    expect(fixture.store.query(fixture.room.query.ReconnectRequestQuery())).toEqual(request)
    fixture.store.send(fixture.room.command.SettleReconnectIntervalCommand(request.id))
    fixture.store.send(fixture.room.command.SettleReconnectIntervalCommand(request.id))

    expect(fixture.store.query(fixture.room.query.ReconnectRequestQuery())).toEqual({
      id: request.id,
      intervalSettled: true,
      outcome: null
    })
    expect(finished).toEqual([])

    reconnect.resolve()
    await vi.waitFor(() => expect(finished).toEqual([{ id: request.id }]))
    expect(fixture.store.query(fixture.room.query.ReconnectRequestQuery())).toBeNull()
    expect(fixture.store.query(fixture.room.query.ReconnectIsLoadingQuery())).toBe(false)
    expect(fixture.chat.joinRoom).toHaveBeenCalledTimes(2)
    fixture.store.discard()
  })

  it('owns the 300ms minimum interval independently and fences stale settlement', async () => {
    vi.useFakeTimers()
    const firstReconnect = deferred()
    const secondReconnect = deferred()
    const fixture = createFixture()
    await join(fixture)
    vi.mocked(fixture.chat.leaveRoom)
      .mockReturnValueOnce(firstReconnect.promise)
      .mockReturnValueOnce(secondReconnect.promise)

    fixture.store.send(fixture.room.command.ReconnectCommand())
    const first = fixture.store.query(fixture.room.query.ReconnectRequestQuery())!
    expect(fixture.chat.leaveRoom).toHaveBeenCalledOnce()

    await vi.advanceTimersByTimeAsync(299)
    expect(fixture.store.query(fixture.room.query.ReconnectRequestQuery())).toEqual(first)
    await vi.advanceTimersByTimeAsync(1)
    expect(fixture.store.query(fixture.room.query.ReconnectRequestQuery())).toEqual({
      ...first,
      intervalSettled: true
    })

    firstReconnect.resolve()
    await vi.waitFor(() => expect(fixture.store.query(fixture.room.query.ReconnectRequestQuery())).toBeNull())

    fixture.store.send(fixture.room.command.ReconnectCommand())
    const second = fixture.store.query(fixture.room.query.ReconnectRequestQuery())!
    expect(fixture.chat.leaveRoom).toHaveBeenCalledTimes(2)
    fixture.store.send(fixture.room.command.SettleReconnectIntervalCommand(first.id))
    expect(fixture.store.query(fixture.room.query.ReconnectRequestQuery())).toEqual(second)

    secondReconnect.resolve()
    await vi.advanceTimersByTimeAsync(300)
    await vi.waitFor(() => expect(fixture.store.query(fixture.room.query.ReconnectRequestQuery())).toBeNull())
    fixture.store.discard()
    vi.useRealTimers()
  })

  it.each([
    { rejection: new Error('reconnect failed'), message: 'reconnect failed' },
    { rejection: 'transport reset', message: 'transport reset' }
  ])('normalizes $message and settles it through the request-owned interval', async ({ rejection, message }) => {
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
    fixture.store.send(fixture.room.command.SettleReconnectIntervalCommand(request.id))

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

  it('completes a send cancelled by final release without publishing a room error', async () => {
    const fixture = createFixture()
    const errors: Error[] = []
    fixture.store.subscribeEvent(fixture.room.event.OnErrorEvent, (error) => errors.push(error))
    let rejectSend!: (reason?: unknown) => void
    const rejectedSend = new Promise<never>((_, reject) => {
      rejectSend = reject
    })
    vi.mocked(fixture.chat.sendMessage).mockReturnValueOnce(
      rejectedSend as never as ReturnType<typeof fixture.chat.sendMessage>
    )
    fixture.store.send(fixture.input.command.InputCommand('held by teardown'))

    fixture.store.send(fixture.room.command.SendTextMessageCommand('held by teardown'))
    await vi.waitFor(() => expect(fixture.chat.sendMessage).toHaveBeenCalledOnce())

    // Final release in progress: the Content/lease teardown owner cancels the still-active send token.
    // The in-flight send then rejects but its own token is already cancelled, so it is silent — never
    // derived from the caught error's content or a remote-leave/session event.
    fixture.cancelActiveSends()
    rejectSend(new DOMException('Runtime presence is completing its final release', 'AbortError'))
    await Promise.resolve()

    expect(errors).toEqual([])
    expect(fixture.store.query(fixture.input.query.MessageQuery())).toBe('held by teardown')
    fixture.store.discard()
  })

  it('surfaces a real provider send failure even while connection loading is present', async () => {
    const fixture = createFixture()
    const errors: Error[] = []
    fixture.store.subscribeEvent(fixture.room.event.OnErrorEvent, (error) => errors.push(error))
    let rejectSend!: (reason?: unknown) => void
    const providerError = new Error('provider transport failed')
    const rejectedSend = new Promise<never>((_, reject) => {
      rejectSend = reject
    })
    vi.mocked(fixture.chat.sendMessage).mockReturnValueOnce(
      rejectedSend as never as ReturnType<typeof fixture.chat.sendMessage>
    )
    fixture.store.send(fixture.input.command.InputCommand('provider fails'))

    fixture.store.send(fixture.room.command.SendTextMessageCommand('provider fails'))
    await vi.waitFor(() => expect(fixture.chat.sendMessage).toHaveBeenCalledOnce())

    // Unrelated connection/reconnect loading must not hide a real provider failure: each send owns an
    // exact token, so only a cancelled token is silent; this genuine error settles its token `failed`.
    fixture.emitReadiness('connecting')
    rejectSend(providerError)

    await vi.waitFor(() => expect(errors).toEqual([providerError]))
    fixture.store.discard()
  })

  it('does not let a remote peer leave cancel a pending local send that then really fails', async () => {
    const fixture = createFixture()
    const errors: Error[] = []
    fixture.store.subscribeEvent(fixture.room.event.OnErrorEvent, (error) => errors.push(error))
    let rejectSend!: (reason?: unknown) => void
    const providerError = new Error('provider transport failed')
    const rejectedSend = new Promise<never>((_, reject) => {
      rejectSend = reject
    })
    vi.mocked(fixture.chat.sendMessage).mockReturnValueOnce(
      rejectedSend as never as ReturnType<typeof fixture.chat.sendMessage>
    )
    fixture.store.send(fixture.input.command.InputCommand('remote leaves'))

    fixture.store.send(fixture.room.command.SendTextMessageCommand('remote leaves'))
    await vi.waitFor(() => expect(fixture.chat.sendMessage).toHaveBeenCalledOnce())

    // A remote user's departure keeps the local session present and must NOT cancel this local send;
    // its token cannot settle `cancelled`, so the genuine provider failure must surface.
    fixture.emitSessions([SELF_SESSION])
    rejectSend(providerError)

    await vi.waitFor(() => expect(errors).toEqual([providerError]))
    fixture.store.discard()
  })

  it('does not cancel a pending real send on manual reconnect, so its later failure still Toasts', async () => {
    const fixture = createFixture()
    await join(fixture)
    const errors: Error[] = []
    fixture.store.subscribeEvent(fixture.room.event.OnErrorEvent, (error) => errors.push(error))
    const providerError = new Error('provider transport failed')
    let rejectSend!: (reason?: unknown) => void
    const rejectedSend = new Promise<never>((_, reject) => {
      rejectSend = reject
    })
    vi.mocked(fixture.chat.sendMessage).mockReturnValueOnce(
      rejectedSend as never as ReturnType<typeof fixture.chat.sendMessage>
    )
    fixture.store.send(fixture.input.command.InputCommand('reconnect held'))

    fixture.store.send(fixture.room.command.SendTextMessageCommand('reconnect held'))
    await vi.waitFor(() => expect(fixture.chat.sendMessage).toHaveBeenCalledOnce())

    // Manual reconnect leaves and rejoins; it must NOT bulk-cancel the pending send (which would
    // suppress a genuine failure). The send token stays active, so its real failure surfaces.
    fixture.store.send(fixture.room.command.ReconnectCommand())
    rejectSend(providerError)

    await vi.waitFor(() => expect(errors).toEqual([providerError]))
    fixture.store.discard()
  })

  it('still projects a pending local send that succeeds during manual reconnect', async () => {
    const fixture = createFixture()
    await join(fixture)
    const projected: string[] = []
    fixture.store.subscribeEvent(fixture.room.event.SendTextMessageEvent, (message) => projected.push(message.id))
    let resolveSend!: (message: ChatMessage) => void
    const heldSend = new Promise<ChatMessage>((resolve) => {
      resolveSend = resolve
    })
    vi.mocked(fixture.chat.sendMessage).mockReturnValueOnce(
      heldSend as never as ReturnType<typeof fixture.chat.sendMessage>
    )
    fixture.store.send(fixture.input.command.InputCommand('reconnect success'))
    fixture.store.send(fixture.room.command.SendTextMessageCommand('reconnect success'))
    await vi.waitFor(() => expect(fixture.chat.sendMessage).toHaveBeenCalledOnce())

    // Manual reconnect must not silently drop a successful local result: the late success still projects.
    fixture.store.send(fixture.room.command.ReconnectCommand())
    resolveSend({
      type: MESSAGE_TYPE.TEXT,
      id: 'local-success-message',
      hlc: { timestamp: 5, counter: 0 },
      userId: SELF.id,
      body: 'reconnect success',
      mentions: []
    })

    await vi.waitFor(() => expect(projected).toEqual(['local-success-message']))
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
