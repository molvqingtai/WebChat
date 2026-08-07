import { afterEach, describe, expect, it, vi } from 'vitest'
import { Remesh, type RemeshStore } from 'remesh'
import AppStatusDomain from '@/domain/AppStatus'
import AppFeedbackDomain from '@/domain/AppFeedback'
import ChatRoomDomain from '@/domain/ChatRoom'
import UserInfoDomain, { type UserInfo } from '@/domain/UserInfo'
import { ChatRoomExtern, type ChatRoom } from '@/domain/externs/ChatRoom'
import { ReadinessExtern, type Readiness } from '@/domain/externs/Readiness'
import { ToastExtern, type Toast } from '@/domain/externs/Toast'
import { BrowserSyncStorageExtern, LocalStorageExtern, type Storage, type StorageValue } from '@/domain/externs/Storage'
import { WorldRoomExtern } from '@/domain/externs/WorldRoom'
import { createMemoryMessageDatabase } from '@/domain/impls/database/Memory'
import { SendLifecycleExtern } from '@/domain/externs/SendLifecycle'
import { createSendLifecycle } from '@/domain/impls/SendLifecycle'
import { MessageDatabaseExtern } from '@/domain/MessageStore'
import { ClientLease } from '@/runtime/ClientLease'
import type { RuntimeCoordinator, RuntimeSnapshot } from '@/runtime/Contract'
import { createDocumentLifecycleOwner } from './documentLifecycle'

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

const flushMicrotasks = async () => {
  for (let index = 0; index < 20; index += 1) await Promise.resolve()
}

let databaseId = 0
const activeStores = new Set<RemeshStore>()

const createComposedFixture = (lease: ClientLease) => {
  const toast = {
    success: vi.fn(() => 'success'),
    error: vi.fn(() => RUNTIME_TOAST_ID),
    info: vi.fn(() => 'info'),
    warning: vi.fn(() => 'warning'),
    loading: vi.fn(() => RUNTIME_TOAST_ID),
    cancel: vi.fn((id) => id)
  } satisfies Toast
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
  const readiness: Readiness = {
    onState: (callback) =>
      lease.whenHostPhase((phase) => callback(phase === 'ready' || phase === 'unavailable' ? phase : 'connecting'))
  }
  const store = Remesh.store({
    externs: [
      ChatRoomExtern.impl(chat),
      SendLifecycleExtern.impl(createSendLifecycle()),
      ReadinessExtern.impl(readiness),
      LocalStorageExtern.impl(storage),
      BrowserSyncStorageExtern.impl(storage),
      MessageDatabaseExtern.impl(createMemoryMessageDatabase(`composed-${databaseId++}`)),
      WorldRoomExtern.impl({ getState: async () => [], onState: () => () => {}, onError: () => () => {} }),
      ToastExtern.impl(toast)
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
  return { store, appStatus, room, toast }
}

const persistedEvent = (type: 'pagehide' | 'pageshow') => {
  const event = new window.Event(type)
  Object.defineProperty(event, 'persisted', { value: true })
  return event
}

describe('Content document-lifecycle owner composed parent control', () => {
  afterEach(() => {
    activeStores.forEach((store) => store.discard())
    activeStores.clear()
  })

  it('produces no loading on departure and reconciles ready on restore through the real owner', async () => {
    const domain = 'https://example.test'
    const pageId = 'page-a'
    const readySnapshot: RuntimeSnapshot = {
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
      .mockResolvedValueOnce({ phase: 'ready', generation: 1, snapshot: readySnapshot })
      .mockResolvedValueOnce({ phase: 'ready', generation: 2, snapshot: readySnapshot })
    const lease = new ClientLease({
      coordinator: { ensureHost: vi.fn(), registerPage },
      pageId,
      domain,
      logError: vi.fn()
    })
    await lease.init()
    const fixture = createComposedFixture(lease)
    const owner = createDocumentLifecycleOwner()
    owner.bind({
      store: fixture.store,
      sendLifecycle: createSendLifecycle(),
      initLease: () => lease.init(),
      detachLease: () => lease.detach()
    })
    fixture.store.send(fixture.appStatus.command.MarkReadyCommand())
    await flushMicrotasks()

    // Real departure: the owner receives the persisted hide, silences feedback, then the real lease
    // detach changes readiness to connecting. No loading entry may be created by cleanup.
    window.dispatchEvent(persistedEvent('pagehide'))
    await flushMicrotasks()
    expect(fixture.toast.loading).not.toHaveBeenCalled()
    expect(registerPage).toHaveBeenCalledTimes(1)

    // Real restore: the owner re-inits the real lease (one current attach) and resumes feedback; the
    // visible page reconciles to ready without a success Toast.
    window.dispatchEvent(persistedEvent('pageshow'))
    await flushMicrotasks()
    await flushMicrotasks()
    expect(registerPage).toHaveBeenCalledTimes(2)
    expect(fixture.toast.loading).not.toHaveBeenCalled()
    expect(fixture.toast.success).not.toHaveBeenCalled()

    owner.dispose()
    lease.detach()
  })
})
