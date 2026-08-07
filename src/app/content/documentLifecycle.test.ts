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
  const sendLifecycle = createSendLifecycle()
  const store = Remesh.store({
    externs: [
      ChatRoomExtern.impl(chat),
      SendLifecycleExtern.impl(sendLifecycle),
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
  return { store, appStatus, room, toast, sendLifecycle }
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

  it('proves exact-once release/cancel/subscription and final cleanup through the real owner', async () => {
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
    const registerPage = vi.fn<RuntimeCoordinator['registerPage']>().mockResolvedValue({
      phase: 'ready',
      generation: 1,
      snapshot: readySnapshot
    })
    const lease = new ClientLease({
      coordinator: { ensureHost: vi.fn(), registerPage },
      pageId,
      domain,
      logError: vi.fn()
    })
    await lease.init()
    const detachSpy = vi.spyOn(lease, 'detach')
    // Install readiness instrumentation BEFORE the composed store ignites the AppFeedback/Readiness
    // effect, so every real subscription/unsubscription is counted from the start.
    let readinessSubscriptions = 0
    let readinessUnsubscriptions = 0
    const originalReadiness = lease.whenHostPhase.bind(lease)
    vi.spyOn(lease, 'whenHostPhase').mockImplementation((callback) => {
      readinessSubscriptions += 1
      const unsubscribe = originalReadiness(callback)
      return () => {
        readinessUnsubscriptions += 1
        return unsubscribe()
      }
    })
    const fixture = createComposedFixture(lease)
    // Spy the SAME SendLifecycle installed in the composed store so cancellation exact-once is observable.
    const cancelSpy = vi.spyOn(fixture.sendLifecycle, 'cancelActiveSends')
    const owner = createDocumentLifecycleOwner()
    owner.bind({
      store: fixture.store,
      sendLifecycle: fixture.sendLifecycle,
      initLease: () => lease.init(),
      detachLease: () => lease.detach()
    })
    fixture.store.send(fixture.appStatus.command.MarkReadyCommand())
    await flushMicrotasks()
    const attachCount = () => registerPage.mock.calls.length
    const initialAttaches = attachCount()
    const initialCancels = cancelSpy.mock.calls.length

    // An active page-owned send token exists before the first departure.
    const sendToken = fixture.sendLifecycle.beginSend()
    expect(fixture.sendLifecycle.getSendResult(sendToken)).toBe('active')

    // Cycle 1 persisted hide: feedback silenced, page sends cancelled exactly once, lease detached once.
    window.dispatchEvent(persistedEvent('pagehide'))
    await flushMicrotasks()
    expect(fixture.toast.loading).not.toHaveBeenCalled()
    expect(detachSpy).toHaveBeenCalledTimes(1)
    expect(cancelSpy.mock.calls.length).toBe(initialCancels + 1)
    expect(fixture.sendLifecycle.getSendResult(sendToken)).toBe('cancelled')

    // Duplicate persisted hide while suspended: no second detach or cancel (exact-once per cycle).
    window.dispatchEvent(persistedEvent('pagehide'))
    await flushMicrotasks()
    expect(detachSpy).toHaveBeenCalledTimes(1)
    expect(cancelSpy.mock.calls.length).toBe(initialCancels + 1)

    // Cycle 1 restore: exactly one attach; a second restore signal while already active is a no-op.
    window.dispatchEvent(persistedEvent('pageshow'))
    await flushMicrotasks()
    await flushMicrotasks()
    expect(attachCount()).toBe(initialAttaches + 1)
    expect(fixture.toast.loading).not.toHaveBeenCalled()
    expect(fixture.toast.success).not.toHaveBeenCalled()
    window.dispatchEvent(persistedEvent('pageshow'))
    await flushMicrotasks()
    expect(attachCount()).toBe(initialAttaches + 1)

    // Cycle 2: exactly one more detach/cancel and one more attach.
    const sendToken2 = fixture.sendLifecycle.beginSend()
    window.dispatchEvent(persistedEvent('pagehide'))
    await flushMicrotasks()
    expect(detachSpy).toHaveBeenCalledTimes(2)
    expect(cancelSpy.mock.calls.length).toBe(initialCancels + 2)
    expect(fixture.sendLifecycle.getSendResult(sendToken2)).toBe('cancelled')
    window.dispatchEvent(persistedEvent('pageshow'))
    await flushMicrotasks()
    await flushMicrotasks()
    expect(attachCount()).toBe(initialAttaches + 2)
    expect(fixture.toast.loading).not.toHaveBeenCalled()
    expect(fixture.toast.success).not.toHaveBeenCalled()

    // Final production teardown (faithful to index.tsx onRemove): a terminal exit silences feedback and
    // detaches the lease exactly once through the owner, then dispose removes listeners and discard
    // releases the store. Advance the watchdog boundary after teardown: no late register, no cleanup
    // loading/success Toast, and readiness subscriptions balance exactly.
    vi.useFakeTimers()
    const terminal = new window.Event('pagehide')
    Object.defineProperty(terminal, 'persisted', { value: false })
    window.dispatchEvent(terminal)
    await flushMicrotasks()
    expect(detachSpy).toHaveBeenCalledTimes(3)
    expect(fixture.toast.loading).not.toHaveBeenCalled()
    owner.dispose()
    fixture.store.discard()
    await vi.advanceTimersByTimeAsync(6000)
    await flushMicrotasks()
    expect(readinessUnsubscriptions).toBe(readinessSubscriptions)
    expect(attachCount()).toBe(initialAttaches + 2)
    expect(fixture.toast.loading).not.toHaveBeenCalled()
    expect(fixture.toast.success).not.toHaveBeenCalled()
    vi.useRealTimers()
  })
})
