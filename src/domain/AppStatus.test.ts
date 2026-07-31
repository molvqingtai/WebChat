import { afterEach, describe, expect, it, vi } from 'vitest'
import { Remesh, type RemeshStore } from 'remesh'
import AppStatusDomain, { type AppStatus } from '@/domain/AppStatus'
import { APP_STATUS_STORAGE_KEY } from '@/constants/storage'
import { BrowserSyncStorageExtern, LocalStorageExtern, type Storage } from '@/domain/externs/Storage'
import { ChatRoomExtern, type ChatRoom } from '@/domain/externs/ChatRoom'
import { ReadinessExtern } from '@/domain/externs/Readiness'
import { MessageDatabaseExtern } from '@/domain/MessageStore'
import { createMemoryMessageDatabase } from '@/domain/impls/database/Memory'
import { MESSAGE_TYPE, type ChatMessage } from '@/protocol/ChatRoom'
import type { ChatSession } from '@/protocol/Session'
import type { UserInfo } from '@/domain/UserInfo'

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

const OTHER = { id: 'remote-user', name: 'Remote', avatar: '' }

const deferred = <Value>() => {
  let resolve!: (value: Value) => void
  const promise = new Promise<Value>((onResolve) => {
    resolve = onResolve
  })
  return { promise, resolve }
}

let databaseId = 0
const activeStores = new Set<RemeshStore>()

const createFixture = (read: Promise<AppStatus | null> = new Promise(() => {})) => {
  const get = vi.fn(() => read)
  const set = vi.fn(async () => {})
  const watch = vi.fn(async () => async () => {})
  const localStorage: Storage = {
    get: get as Storage['get'],
    set: set as Storage['set'],
    watch
  }
  const browserGet = vi.fn(async () => SELF)
  const browserStorage: Storage = {
    get: browserGet as Storage['get'],
    set: async () => {},
    watch: async () => async () => {}
  }
  const messageListeners = new Set<(message: ChatMessage) => void>()
  const sessionListeners = new Set<(sessions: readonly ChatSession[]) => void>()
  const chat: ChatRoom = {
    joinRoom: async () => {},
    leaveRoom: async () => {},
    sendMessage: async () => {
      throw new Error('unused')
    },
    onMessage: (listener) => {
      messageListeners.add(listener)
      return () => messageListeners.delete(listener)
    },
    onJoinRoom: () => () => {},
    onLeaveRoom: () => () => {},
    onSessions: (listener) => {
      sessionListeners.add(listener)
      return () => sessionListeners.delete(listener)
    },
    onError: () => () => {}
  }
  const store = Remesh.store({
    externs: [
      LocalStorageExtern.impl(localStorage),
      BrowserSyncStorageExtern.impl(browserStorage),
      ChatRoomExtern.impl(chat),
      ReadinessExtern.impl({ onState: () => () => {} }),
      MessageDatabaseExtern.impl(createMemoryMessageDatabase(`app-status-${databaseId++}`))
    ]
  })
  const action = AppStatusDomain()
  const domain = store.getDomain(action)
  store.igniteDomain(action)
  activeStores.add(store)
  return {
    store,
    domain,
    get,
    set,
    watch,
    browserGet,
    emitMessage: (message: ChatMessage) => messageListeners.forEach((listener) => listener(message)),
    emitSessions: (sessions: readonly ChatSession[]) => sessionListeners.forEach((listener) => listener(sessions)),
    messageListeners,
    sessionListeners
  }
}

const textMessage = (id: string, userId: string): ChatMessage => ({
  type: MESSAGE_TYPE.TEXT,
  id,
  hlc: { timestamp: 1, counter: 0 },
  userId,
  body: id,
  mentions: []
})

afterEach(() => {
  activeStores.forEach((store) => store.discard())
  activeStores.clear()
  vi.restoreAllMocks()
})

describe('AppStatus shell ownership', () => {
  it('exposes only the queries, commands, and events used by production consumers', () => {
    const fixture = createFixture()

    expect(Object.keys(fixture.domain.query).sort()).toEqual(
      ['HasUnreadQuery', 'OpenQuery', 'PhaseQuery', 'PositionQuery', 'ReadyQuery', 'StatusLoadIsFinishedQuery'].sort()
    )
    expect(Object.keys(fixture.domain.command).sort()).toEqual(
      [
        'MarkReadyCommand',
        'MarkUnavailableCommand',
        'RetryCommand',
        'UpdateOpenCommand',
        'UpdatePositionCommand'
      ].sort()
    )
    expect(Object.keys(fixture.domain.event)).toEqual(['RetryRequestedEvent'])
  })

  it('preserves an open interaction that happens before persisted status hydrates', async () => {
    const read = deferred<AppStatus | null>()
    const fixture = createFixture(read.promise)

    await vi.waitFor(() => expect(fixture.get).toHaveBeenCalledOnce())
    fixture.store.send(fixture.domain.command.UpdateOpenCommand(true))
    read.resolve({ open: false, unread: 4, position: { x: 80, y: 40 } })
    await vi.waitFor(() => expect(fixture.store.query(fixture.domain.query.StatusLoadIsFinishedQuery())).toBe(true))

    expect(fixture.store.query(fixture.domain.query.OpenQuery())).toBe(true)
    expect(fixture.store.query(fixture.domain.query.HasUnreadQuery())).toBe(false)
    expect(fixture.store.query(fixture.domain.query.PositionQuery())).toEqual({ x: 80, y: 40 })
    await vi.waitFor(() =>
      expect(fixture.set).toHaveBeenLastCalledWith(
        APP_STATUS_STORAGE_KEY,
        expect.objectContaining({ open: true, unread: 0 })
      )
    )
  })

  it('restores persisted open state when the shell has not been toggled', async () => {
    const fixture = createFixture(Promise.resolve({ open: true, unread: 0, position: { x: 50, y: 22 } }))

    await vi.waitFor(() => expect(fixture.store.query(fixture.domain.query.StatusLoadIsFinishedQuery())).toBe(true))

    expect(fixture.store.query(fixture.domain.query.OpenQuery())).toBe(true)
  })

  it('hydrates the persisted expanded shell before application initialization is relevant', async () => {
    const read = deferred<AppStatus | null>()
    const fixture = createFixture(read.promise)
    const persisted = { open: true, unread: 2, position: { x: 72, y: 31 } }

    await vi.waitFor(() => expect(fixture.get).toHaveBeenCalledOnce())
    read.resolve(persisted)
    await vi.waitFor(() => expect(fixture.store.query(fixture.domain.query.StatusLoadIsFinishedQuery())).toBe(true))

    expect(fixture.store.query(fixture.domain.query.OpenQuery())).toBe(true)
    expect(fixture.store.query(fixture.domain.query.HasUnreadQuery())).toBe(true)
    expect(fixture.store.query(fixture.domain.query.PositionQuery())).toEqual(persisted.position)
    await vi.waitFor(() => expect(fixture.set).toHaveBeenLastCalledWith(APP_STATUS_STORAGE_KEY, persisted))
    expect(fixture.watch).toHaveBeenCalledOnce()
  })

  it('consumes persisted collapsed provenance instead of merely retaining the default', async () => {
    const persisted = { open: false, unread: 3, position: { x: 91, y: 27 } }
    const fixture = createFixture(Promise.resolve(persisted))

    await vi.waitFor(() => expect(fixture.store.query(fixture.domain.query.StatusLoadIsFinishedQuery())).toBe(true))

    expect(fixture.get).toHaveBeenCalledOnce()
    expect(fixture.store.query(fixture.domain.query.OpenQuery())).toBe(false)
    expect(fixture.store.query(fixture.domain.query.HasUnreadQuery())).toBe(true)
    expect(fixture.store.query(fixture.domain.query.PositionQuery())).toEqual(persisted.position)
    await vi.waitFor(() => expect(fixture.set).toHaveBeenLastCalledWith(APP_STATUS_STORAGE_KEY, persisted))
  })

  it('keeps the current collapsed default when no persisted record exists', async () => {
    const fixture = createFixture(Promise.resolve(null))

    await vi.waitFor(() => expect(fixture.store.query(fixture.domain.query.StatusLoadIsFinishedQuery())).toBe(true))

    expect(fixture.get).toHaveBeenCalledOnce()
    expect(fixture.store.query(fixture.domain.query.OpenQuery())).toBe(false)
    expect(fixture.store.query(fixture.domain.query.HasUnreadQuery())).toBe(false)
    expect(fixture.store.query(fixture.domain.query.PositionQuery())).toEqual({ x: 50, y: 22 })
  })

  it('persists a pre-hydration interaction and rejects the older opposite snapshot', async () => {
    const read = deferred<AppStatus | null>()
    const fixture = createFixture(read.promise)

    await vi.waitFor(() => expect(fixture.get).toHaveBeenCalledOnce())
    fixture.store.send(fixture.domain.command.UpdateOpenCommand(true))
    await vi.waitFor(() =>
      expect(fixture.set).toHaveBeenLastCalledWith(APP_STATUS_STORAGE_KEY, expect.objectContaining({ open: true }))
    )

    read.resolve({ open: false, unread: 7, position: { x: 64, y: 29 } })
    await vi.waitFor(() => expect(fixture.store.query(fixture.domain.query.StatusLoadIsFinishedQuery())).toBe(true))

    expect(fixture.store.query(fixture.domain.query.OpenQuery())).toBe(true)
    expect(fixture.store.query(fixture.domain.query.HasUnreadQuery())).toBe(false)
    expect(fixture.store.query(fixture.domain.query.PositionQuery())).toEqual({ x: 64, y: 29 })
    await vi.waitFor(() =>
      expect(fixture.set).toHaveBeenLastCalledWith(
        APP_STATUS_STORAGE_KEY,
        expect.objectContaining({ open: true, unread: 0 })
      )
    )
  })

  it('does not apply or repersist hydration after its shell store is discarded', async () => {
    const staleRead = deferred<AppStatus | null>()
    const stale = createFixture(staleRead.promise)
    await vi.waitFor(() => expect(stale.get).toHaveBeenCalledOnce())
    stale.store.discard()
    activeStores.delete(stale.store)

    const current = createFixture(Promise.resolve({ open: true, unread: 0, position: { x: 75, y: 25 } }))
    await vi.waitFor(() => expect(current.store.query(current.domain.query.StatusLoadIsFinishedQuery())).toBe(true))

    staleRead.resolve({ open: false, unread: 9, position: { x: 12, y: 12 } })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(stale.set).not.toHaveBeenCalled()
    expect(current.store.query(current.domain.query.OpenQuery())).toBe(true)
  })

  it('reuses one storage lifecycle when another consumer ignites the same status domain', async () => {
    const fixture = createFixture(Promise.resolve({ open: true, unread: 0, position: { x: 70, y: 30 } }))
    await vi.waitFor(() => expect(fixture.store.query(fixture.domain.query.StatusLoadIsFinishedQuery())).toBe(true))

    fixture.store.igniteDomain(AppStatusDomain())
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(fixture.get).toHaveBeenCalledOnce()
    expect(fixture.watch).toHaveBeenCalledOnce()
  })

  it('counts only incoming non-self text while closed and clears unread when opened', async () => {
    const fixture = createFixture(Promise.resolve({ open: false, unread: 0, position: { x: 50, y: 22 } }))
    await vi.waitFor(() => expect(fixture.store.query(fixture.domain.query.StatusLoadIsFinishedQuery())).toBe(true))
    await vi.waitFor(() => expect(fixture.browserGet).toHaveBeenCalled())
    await vi.waitFor(() => expect(fixture.messageListeners.size).toBe(1))
    await vi.waitFor(() => expect(fixture.sessionListeners.size).toBe(1))
    fixture.set.mockClear()

    fixture.emitSessions([
      { sessionId: 'local-session', user: SELF },
      { sessionId: 'remote-session', user: OTHER }
    ])
    fixture.emitMessage(textMessage('remote-1', OTHER.id))

    await vi.waitFor(() =>
      expect(fixture.set).toHaveBeenLastCalledWith(APP_STATUS_STORAGE_KEY, expect.objectContaining({ unread: 1 }))
    )
    expect(fixture.store.query(fixture.domain.query.HasUnreadQuery())).toBe(true)

    fixture.emitMessage(textMessage('self-1', SELF.id))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(fixture.set).toHaveBeenCalledTimes(1)

    fixture.store.send(fixture.domain.command.UpdateOpenCommand(true))
    await vi.waitFor(() =>
      expect(fixture.set).toHaveBeenLastCalledWith(
        APP_STATUS_STORAGE_KEY,
        expect.objectContaining({ open: true, unread: 0 })
      )
    )
    expect(fixture.store.query(fixture.domain.query.HasUnreadQuery())).toBe(false)

    fixture.set.mockClear()
    fixture.emitMessage(textMessage('remote-2', OTHER.id))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(fixture.set).not.toHaveBeenCalled()
    expect(fixture.store.query(fixture.domain.query.HasUnreadQuery())).toBe(false)
  })
})
