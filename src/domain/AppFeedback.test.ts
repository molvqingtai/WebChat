import { afterEach, describe, expect, it, vi } from 'vitest'
import { Remesh, type RemeshStore } from 'remesh'
import AppStatusDomain from '@/domain/AppStatus'
import AppFeedbackDomain from '@/domain/AppFeedback'
import ChatRoomDomain from '@/domain/ChatRoom'
import UserInfoDomain, { type UserInfo } from '@/domain/UserInfo'
import { ChatRoomExtern, type ChatRoom } from '@/domain/externs/ChatRoom'
import { ReadinessExtern, type Readiness, type ReadinessState } from '@/domain/externs/Readiness'
import { BrowserSyncStorageExtern, LocalStorageExtern, type Storage, type StorageValue } from '@/domain/externs/Storage'
import { ToastExtern, type Toast } from '@/domain/externs/Toast'
import { WorldRoomExtern } from '@/domain/externs/WorldRoom'
import { createMemoryMessageDatabase } from '@/domain/impls/database/Memory'
import { MessageDatabaseExtern } from '@/domain/MessageStore'
import { ClientLease } from '@/runtime/ClientLease'
import type { RuntimeCoordinator, RuntimeSnapshot } from '@/runtime/Contract'

const RUNTIME_TOAST_ID = 'webchat-runtime-readiness'

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

const deferred = () => {
  let resolve!: () => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<void>((onResolve, onReject) => {
    resolve = onResolve
    reject = onReject
  })
  return { promise, resolve, reject }
}

const flushMicrotasks = async () => {
  for (let index = 0; index < 20; index += 1) await Promise.resolve()
}

let databaseId = 0
const activeStores = new Set<RemeshStore>()

const createFixture = (readiness?: Readiness) => {
  const toast = {
    success: vi.fn(() => 'success'),
    error: vi.fn(() => RUNTIME_TOAST_ID),
    info: vi.fn(() => 'info'),
    warning: vi.fn(() => 'warning'),
    loading: vi.fn(() => RUNTIME_TOAST_ID),
    cancel: vi.fn((id) => id)
  } satisfies Toast
  const readinessListeners = new Set<(state: ReadinessState, terminalError?: string) => void>()
  const chat: ChatRoom = {
    joinRoom: vi.fn(async () => {}),
    leaveRoom: vi.fn(async () => {}),
    sendMessage: vi.fn(async () => {
      throw new Error('not used')
    }),
    onMessage: () => () => {},
    onJoinRoom: () => () => {},
    onLeaveRoom: () => () => {},
    onSessions: () => () => {},
    onError: () => () => {}
  }
  const storage: Storage = {
    get: async <Value extends StorageValue>() => SELF as Value,
    set: async () => {},
    watch: async () => async () => {}
  }
  const store = Remesh.store({
    externs: [
      ChatRoomExtern.impl(chat),
      ReadinessExtern.impl(
        readiness ?? {
          onState: (listener) => {
            readinessListeners.add(listener)
            listener('ready')
            return () => readinessListeners.delete(listener)
          }
        }
      ),
      LocalStorageExtern.impl({
        get: async () => null,
        set: async () => {},
        watch: async () => async () => {}
      }),
      BrowserSyncStorageExtern.impl(storage),
      MessageDatabaseExtern.impl(createMemoryMessageDatabase(`app-feedback-${databaseId++}`)),
      ToastExtern.impl(toast),
      WorldRoomExtern.impl({
        getState: async () => [],
        onState: () => () => {},
        onError: () => () => {}
      })
    ]
  })
  const appStatusAction = AppStatusDomain()
  const feedbackAction = AppFeedbackDomain()
  const roomAction = ChatRoomDomain()
  const userAction = UserInfoDomain()
  const appStatus = store.getDomain(appStatusAction)
  const room = store.getDomain(roomAction)
  const user = store.getDomain(userAction)
  store.igniteDomain(roomAction)
  store.igniteDomain(feedbackAction)
  store.send(user.command.UpdateUserInfoCommand(SELF))
  activeStores.add(store)

  return {
    store,
    appStatus,
    room,
    chat,
    toast,
    emitReadiness: (state: ReadinessState, terminalError?: string) =>
      readinessListeners.forEach((listener) => listener(state, terminalError))
  }
}

const markReady = (fixture: ReturnType<typeof createFixture>) => {
  fixture.store.send(fixture.appStatus.command.MarkReadyCommand())
}

const join = async (fixture: ReturnType<typeof createFixture>) => {
  fixture.store.send(fixture.room.command.JoinRoomCommand())
  await flushMicrotasks()
  expect(fixture.store.query(fixture.room.query.JoinIsFinishedQuery())).toBe(true)
}

const clearToastCalls = (toast: Toast) => {
  Object.values(toast).forEach((method) => vi.mocked(method).mockClear())
}

afterEach(() => {
  activeStores.forEach((store) => store.discard())
  activeStores.clear()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('application feedback ownership', () => {
  it('publishes no Runtime Toast before initialization is ready and never dismisses a later error on ready', async () => {
    const fixture = createFixture()

    fixture.emitReadiness('unavailable')
    await flushMicrotasks()
    expect(fixture.toast.loading).not.toHaveBeenCalled()
    expect(fixture.toast.error).not.toHaveBeenCalled()
    expect(fixture.toast.cancel).not.toHaveBeenCalled()

    markReady(fixture)
    await vi.waitFor(() =>
      expect(fixture.toast.error).toHaveBeenCalledWith('Connection failed', { id: RUNTIME_TOAST_ID })
    )
    expect(fixture.toast.loading).not.toHaveBeenCalled()

    fixture.emitReadiness('ready')
    await flushMicrotasks()
    expect(fixture.toast.cancel).not.toHaveBeenCalled()
    expect(fixture.toast.success).not.toHaveBeenCalled()
  })

  it('uses the stable loading owner and success cancels only that loading without a success Toast', async () => {
    const fixture = createFixture()
    const joining = deferred()
    vi.mocked(fixture.chat.joinRoom).mockReturnValueOnce(joining.promise)
    markReady(fixture)

    fixture.store.send(fixture.room.command.JoinRoomCommand())
    await vi.waitFor(() =>
      expect(fixture.toast.loading).toHaveBeenCalledWith('Connected to the chat.', {
        id: RUNTIME_TOAST_ID,
        dismissible: false
      })
    )

    joining.resolve()
    await vi.waitFor(() => expect(fixture.toast.cancel).toHaveBeenCalledWith(RUNTIME_TOAST_ID))
    expect(fixture.toast.cancel).toHaveBeenCalledTimes(1)
    expect(fixture.toast.success).not.toHaveBeenCalled()
    expect(fixture.toast.error).not.toHaveBeenCalled()
  })

  it('keeps a fast reconnect pending for its request-owned 300ms interval without a Toaster', async () => {
    vi.useFakeTimers()
    const fixture = createFixture()
    markReady(fixture)
    await join(fixture)
    clearToastCalls(fixture.toast)

    fixture.store.send(fixture.room.command.ReconnectCommand())
    await flushMicrotasks()

    expect(fixture.toast.loading).toHaveBeenCalledWith('Connected to the chat.', {
      id: RUNTIME_TOAST_ID,
      dismissible: false
    })
    expect(fixture.store.query(fixture.room.query.ReconnectRequestQuery())).toMatchObject({
      intervalSettled: false,
      outcome: {}
    })

    await vi.advanceTimersByTimeAsync(299)
    expect(fixture.store.query(fixture.room.query.ReconnectRequestQuery())).not.toBeNull()
    expect(fixture.toast.cancel).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    await flushMicrotasks()
    expect(fixture.store.query(fixture.room.query.ReconnectRequestQuery())).toBeNull()
    expect(fixture.toast.cancel).toHaveBeenCalledOnce()
    expect(fixture.toast.cancel).toHaveBeenCalledWith(RUNTIME_TOAST_ID)
    expect(fixture.toast.success).not.toHaveBeenCalled()
  })

  it('replaces connection loading with the original terminal error and does not later dismiss it', async () => {
    const fixture = createFixture()
    markReady(fixture)
    vi.mocked(fixture.chat.joinRoom).mockRejectedValueOnce(new Error('provider detail'))

    fixture.store.send(fixture.room.command.JoinRoomCommand())
    await vi.waitFor(() =>
      expect(fixture.toast.error).toHaveBeenCalledWith('provider detail', { id: RUNTIME_TOAST_ID })
    )

    expect(fixture.toast.loading).toHaveBeenCalledWith('Connected to the chat.', {
      id: RUNTIME_TOAST_ID,
      dismissible: false
    })
    expect(fixture.toast.cancel).not.toHaveBeenCalled()
    expect(fixture.toast.success).not.toHaveBeenCalled()

    const errorCount = fixture.toast.error.mock.calls.length
    fixture.emitReadiness('unavailable')
    await flushMicrotasks()
    expect(fixture.toast.error).toHaveBeenCalledTimes(errorCount)
    expect(fixture.toast.cancel).not.toHaveBeenCalled()

    fixture.emitReadiness('ready')
    await flushMicrotasks()
    expect(fixture.toast.cancel).not.toHaveBeenCalled()

    fixture.emitReadiness('connecting')
    await flushMicrotasks()
    expect(fixture.toast.loading).toHaveBeenCalledTimes(1)
    expect(fixture.toast.error).toHaveBeenCalledTimes(errorCount)
  })

  it('shows one native terminal Runtime error and does not replace it with later loading', async () => {
    const fixture = createFixture()
    const joining = deferred()
    vi.mocked(fixture.chat.joinRoom).mockReturnValueOnce(joining.promise)
    markReady(fixture)
    fixture.store.send(fixture.room.command.JoinRoomCommand())
    await vi.waitFor(() =>
      expect(fixture.toast.loading).toHaveBeenCalledWith('Connected to the chat.', {
        id: RUNTIME_TOAST_ID,
        dismissible: false
      })
    )

    fixture.emitReadiness('unavailable', 'Extension context invalidated.')
    await vi.waitFor(() =>
      expect(fixture.toast.error).toHaveBeenCalledWith('Extension context invalidated.', {
        id: RUNTIME_TOAST_ID
      })
    )

    fixture.emitReadiness('unavailable', 'Extension context invalidated.')
    fixture.emitReadiness('connecting')
    await flushMicrotasks()

    expect(fixture.toast.error).toHaveBeenCalledOnce()
    expect(fixture.toast.loading).toHaveBeenCalledOnce()
    expect(fixture.toast.cancel).not.toHaveBeenCalled()
  })

  it('lets the lease watchdog own the only visible native error while an in-flight send rejects', async () => {
    vi.useFakeTimers()
    const domain = 'https://example.test'
    const pageId = 'page-a'
    const nativeError = new Error('Extension context invalidated.')
    const snapshot: RuntimeSnapshot = {
      hostId: 'host-a',
      hostPhase: 'ready',
      peerId: 'peer-a',
      domains: [
        {
          domain,
          phase: 'active',
          pageIds: [pageId],
          chatRoomJoined: true,
          sessions: []
        }
      ],
      world: { joined: true, peerId: 'peer-a', presences: [] }
    }
    const registerPage = vi
      .fn<RuntimeCoordinator['registerPage']>()
      .mockResolvedValueOnce({ phase: 'ready', generation: 1, snapshot })
      .mockRejectedValue(nativeError)
    const lease = new ClientLease({
      coordinator: { ensureHost: vi.fn(), registerPage },
      pageId,
      domain,
      watchdogIntervalMs: 1000,
      logError: vi.fn()
    })
    await lease.init()
    const fixture = createFixture({
      onState: (callback) =>
        lease.whenHostPhase((phase, terminalError) =>
          callback(phase === 'ready' || phase === 'unavailable' ? phase : 'connecting', terminalError)
        )
    })
    const sending = deferred()
    vi.mocked(fixture.chat.sendMessage).mockReturnValueOnce(sending.promise as never)
    markReady(fixture)
    await join(fixture)
    clearToastCalls(fixture.toast)

    fixture.store.send(fixture.room.command.SendTextMessageCommand('held text'))
    await flushMicrotasks()
    expect(fixture.chat.sendMessage).toHaveBeenCalledOnce()

    vi.advanceTimersByTime(1000)
    sending.reject(nativeError)
    await flushMicrotasks()

    expect(registerPage).toHaveBeenCalledTimes(2)
    expect(fixture.toast.error).toHaveBeenCalledOnce()
    expect(fixture.toast.error).toHaveBeenCalledWith('Extension context invalidated.', {
      id: RUNTIME_TOAST_ID
    })
    lease.detach()
  })
})
