import { afterEach, describe, expect, it, vi } from 'vitest'
import { Remesh, type RemeshStore } from 'remesh'
import InitializationDomain from '@/app/content/Initialization'
import AppFeedbackDomain from '@/domain/AppFeedback'
import ChatRoomDomain from '@/domain/ChatRoom'
import UserInfoDomain, { type UserInfo } from '@/domain/UserInfo'
import { ChatRoomExtern, type ChatRoom } from '@/domain/externs/ChatRoom'
import { ReadinessExtern, type ReadinessState } from '@/domain/externs/Readiness'
import { BrowserSyncStorageExtern, type Storage, type StorageValue } from '@/domain/externs/Storage'
import { ToastExtern, type Toast } from '@/domain/externs/Toast'
import { WorldRoomExtern } from '@/domain/externs/WorldRoom'
import { createMemoryMessageDatabase } from '@/domain/impls/database/Memory'
import { MessageDatabaseExtern } from '@/domain/MessageStore'

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

const createFixture = () => {
  const toast = {
    success: vi.fn(() => 'success'),
    error: vi.fn(() => RUNTIME_TOAST_ID),
    info: vi.fn(() => 'info'),
    warning: vi.fn(() => 'warning'),
    loading: vi.fn(() => RUNTIME_TOAST_ID),
    cancel: vi.fn((id) => id)
  } satisfies Toast
  const readinessListeners = new Set<(state: ReadinessState) => void>()
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
      ReadinessExtern.impl({
        onState: (listener) => {
          readinessListeners.add(listener)
          listener('ready')
          return () => readinessListeners.delete(listener)
        }
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
  const initializationAction = InitializationDomain()
  const feedbackAction = AppFeedbackDomain()
  const roomAction = ChatRoomDomain()
  const userAction = UserInfoDomain()
  const initialization = store.getDomain(initializationAction)
  const room = store.getDomain(roomAction)
  const user = store.getDomain(userAction)
  store.igniteDomain(roomAction)
  store.igniteDomain(feedbackAction)
  store.send(user.command.UpdateUserInfoCommand(SELF))
  activeStores.add(store)

  return {
    store,
    initialization,
    room,
    chat,
    toast,
    emitReadiness: (state: ReadinessState) => readinessListeners.forEach((listener) => listener(state))
  }
}

const markReady = (fixture: ReturnType<typeof createFixture>) => {
  fixture.store.send(fixture.initialization.command.MarkReadyCommand())
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

  it('replaces connection loading with the fixed terminal error and does not later dismiss it', async () => {
    const fixture = createFixture()
    markReady(fixture)
    vi.mocked(fixture.chat.joinRoom).mockRejectedValueOnce(new Error('provider detail'))

    fixture.store.send(fixture.room.command.JoinRoomCommand())
    await vi.waitFor(() =>
      expect(fixture.toast.error).toHaveBeenCalledWith('Connection failed', { id: RUNTIME_TOAST_ID })
    )

    expect(fixture.toast.loading).toHaveBeenCalledWith('Connected to the chat.', {
      id: RUNTIME_TOAST_ID,
      dismissible: false
    })
    expect(fixture.toast.cancel).not.toHaveBeenCalled()
    expect(fixture.toast.success).not.toHaveBeenCalled()

    const errorCount = fixture.toast.error.mock.calls.length
    fixture.emitReadiness('unavailable')
    await vi.waitFor(() => expect(fixture.toast.error).toHaveBeenCalledTimes(errorCount + 1))
    expect(fixture.toast.cancel).not.toHaveBeenCalled()

    fixture.emitReadiness('ready')
    await flushMicrotasks()
    expect(fixture.toast.cancel).not.toHaveBeenCalled()
  })
})
