import { afterEach, describe, expect, it, vi } from 'vitest'
import { Remesh, type RemeshStore } from 'remesh'
import AppStatusDomain, { type AppButtonPosition, type AppStatus } from '@/domain/AppStatus'
import { APP_OPEN_STORAGE_KEY, APP_POSITION_STORAGE_KEY, APP_UNREAD_STORAGE_KEY } from '@/constants/storage'
import { BrowserSyncStorageExtern, LocalStorageExtern, type Storage, type StorageValue } from '@/domain/externs/Storage'
import { ChatRoomExtern, type ChatRoom } from '@/domain/externs/ChatRoom'
import { ReadinessExtern } from '@/domain/externs/Readiness'
import { createMessageStore, MessageDatabaseExtern } from '@/domain/MessageStore'
import { createMemoryMessageDatabase } from '@/domain/impls/database/Memory'
import { MESSAGE_TYPE, REACTION_TYPE, type ChatMessage } from '@/protocol/ChatRoom'
import type { ChatSession } from '@/protocol/Session'
import UserInfoDomain, { type UserInfo } from '@/domain/UserInfo'
import { MESSAGE_RECORD_TYPE, type TextMessageRecord } from '@/domain/Message'

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

interface FixtureOptions {
  storage?: Storage
  userInfo?: UserInfo
  databaseName?: string
}

const createFixture = ({
  storage,
  userInfo = SELF,
  databaseName = `app-status-${databaseId++}`
}: FixtureOptions = {}) => {
  const get = vi.fn(storage?.get ?? (async () => null))
  const set = vi.fn(storage?.set ?? (async () => {}))
  const watch = vi.fn(storage?.watch ?? (async () => async () => {}))
  const localStorage: Storage = {
    get: get as Storage['get'],
    set: set as Storage['set'],
    watch
  }
  const browserGet = vi.fn(async () => userInfo)
  const browserStorage: Storage = {
    get: browserGet as Storage['get'],
    set: async () => {},
    watch: async () => async () => {}
  }
  const messageListeners = new Set<(message: ChatMessage) => void>()
  const sessionListeners = new Set<(sessions: readonly ChatSession[]) => void>()
  const joinListeners = new Set<(session: ChatSession) => void>()
  const leaveListeners = new Set<(session: ChatSession) => void>()
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
    onJoinRoom: (listener) => {
      joinListeners.add(listener)
      return () => joinListeners.delete(listener)
    },
    onLeaveRoom: (listener) => {
      leaveListeners.add(listener)
      return () => leaveListeners.delete(listener)
    },
    onSessions: (listener) => {
      sessionListeners.add(listener)
      return () => sessionListeners.delete(listener)
    },
    onError: () => () => {}
  }
  const database = createMemoryMessageDatabase(databaseName)
  const store = Remesh.store({
    externs: [
      LocalStorageExtern.impl(localStorage),
      BrowserSyncStorageExtern.impl(browserStorage),
      ChatRoomExtern.impl(chat),
      ReadinessExtern.impl({ onState: () => () => {} }),
      MessageDatabaseExtern.impl(database)
    ]
  })
  const action = AppStatusDomain()
  const domain = store.getDomain(action)
  const userInfoDomain = store.getDomain(UserInfoDomain())
  store.igniteDomain(action)
  activeStores.add(store)
  return {
    store,
    domain,
    userInfoDomain,
    messageStore: createMessageStore(database),
    get,
    set,
    watch,
    browserGet,
    emitMessage: (message: ChatMessage) => messageListeners.forEach((listener) => listener(message)),
    emitSessions: (sessions: readonly ChatSession[]) => sessionListeners.forEach((listener) => listener(sessions)),
    emitJoin: (session: ChatSession) => joinListeners.forEach((listener) => listener(session)),
    emitLeave: (session: ChatSession) => leaveListeners.forEach((listener) => listener(session)),
    messageListeners,
    sessionListeners
  }
}

type StatusStorageKey = typeof APP_OPEN_STORAGE_KEY | typeof APP_POSITION_STORAGE_KEY | typeof APP_UNREAD_STORAGE_KEY

const createSharedStatusStorage = (initial: AppStatus) => {
  const values = new Map<StatusStorageKey, StorageValue>([
    [APP_OPEN_STORAGE_KEY, initial.open],
    [APP_POSITION_STORAGE_KEY, initial.position],
    [APP_UNREAD_STORAGE_KEY, initial.unread]
  ])
  const watchers = new Map<string, Set<() => unknown>>()
  const pausedTabs = new Set<string>()
  const writes: Array<{ tabId: string; key: StatusStorageKey; value: StorageValue }> = []

  return {
    writes,
    clearWrites: () => writes.splice(0),
    pause: (tabId: string) => pausedTabs.add(tabId),
    resume: (tabId: string) => {
      pausedTabs.delete(tabId)
      watchers.get(tabId)?.forEach((callback) => callback())
    },
    value: <Value extends StorageValue>(key: StatusStorageKey) => values.get(key) as Value,
    createTab(tabId: string): Storage {
      const tabWatchers = new Set<() => unknown>()
      watchers.set(tabId, tabWatchers)
      return {
        get: async <Value extends StorageValue>(key: string) => (values.get(key as StatusStorageKey) as Value) ?? null,
        set: async <Value extends StorageValue>(key: string, value: Value) => {
          const statusKey = key as StatusStorageKey
          if (!values.has(statusKey) || Object.is(values.get(statusKey), value)) return
          values.set(statusKey, value)
          writes.push({ tabId, key: statusKey, value })
          watchers.forEach((callbacks, candidateId) => {
            if (candidateId !== tabId && !pausedTabs.has(candidateId)) {
              callbacks.forEach((callback) => callback())
            }
          })
        },
        watch: async (callback) => {
          tabWatchers.add(callback)
          return async () => {
            tabWatchers.delete(callback)
          }
        }
      }
    }
  }
}

const settle = async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await Promise.resolve()
}

const textMessage = (id: string, userId: string): ChatMessage => ({
  type: MESSAGE_TYPE.TEXT,
  id,
  hlc: { timestamp: 1, counter: 0 },
  userId,
  body: id,
  mentions: []
})

const reactionMessage = (id: string): ChatMessage => ({
  type: MESSAGE_TYPE.REACTION,
  id,
  hlc: { timestamp: 1, counter: 0 },
  targetId: 'target',
  userId: OTHER.id,
  reaction: REACTION_TYPE.LIKE,
  active: true
})

const historyRecord = (id: string): TextMessageRecord => ({
  type: MESSAGE_RECORD_TYPE.CHAT_MESSAGE,
  id,
  message: textMessage(id, OTHER.id) as TextMessageRecord['message'],
  user: OTHER,
  receivedAt: 1
})

type Fixture = ReturnType<typeof createFixture>

const prepareDelivery = async (...fixtures: Fixture[]) => {
  await vi.waitFor(() => {
    fixtures.forEach((fixture) => {
      expect(fixture.store.query(fixture.domain.query.StatusLoadIsFinishedQuery())).toBe(true)
      expect(fixture.store.query(fixture.userInfoDomain.query.UserInfoQuery())).not.toBeNull()
      expect(fixture.messageListeners.size).toBe(1)
      expect(fixture.sessionListeners.size).toBe(1)
    })
  })
  fixtures.forEach((fixture) => {
    fixture.emitSessions([
      { sessionId: 'local-session', user: SELF },
      { sessionId: 'remote-session', user: OTHER }
    ])
  })
}

const statusOf = (fixture: Fixture) => ({
  open: fixture.store.query(fixture.domain.query.OpenQuery()),
  unread: fixture.store.query(fixture.domain.query.HasUnreadQuery()),
  position: fixture.store.query(fixture.domain.query.PositionQuery())
})

afterEach(() => {
  activeStores.forEach((store) => store.discard())
  activeStores.clear()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('AppStatus shared domain status', () => {
  it('exposes only the shell queries, commands, and events used by production consumers', () => {
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

  it('hydrates the three shared fields without writing them back', async () => {
    const shared = createSharedStatusStorage({ open: true, unread: false, position: { x: -84, y: 36 } })
    const fixture = createFixture({ storage: shared.createTab('A') })

    await vi.waitFor(() => expect(fixture.store.query(fixture.domain.query.StatusLoadIsFinishedQuery())).toBe(true))

    expect(statusOf(fixture)).toEqual({ open: true, unread: false, position: { x: -84, y: 36 } })
    expect(fixture.get).toHaveBeenCalledTimes(3)
    expect(fixture.watch).toHaveBeenCalledTimes(3)
    expect(shared.writes).toEqual([])
  })

  it('fences each delayed hydration field without overwriting unrelated current fields', async () => {
    const openRead = deferred<boolean | null>()
    const positionRead = deferred<AppButtonPosition | null>()
    const unreadRead = deferred<boolean | null>()
    const writes: Array<{ key: string; value: StorageValue }> = []
    const storage: Storage = {
      get: <Value extends StorageValue>(key: string) => {
        if (key === APP_OPEN_STORAGE_KEY) return openRead.promise as Promise<Value | null>
        if (key === APP_POSITION_STORAGE_KEY) return positionRead.promise as Promise<Value | null>
        return unreadRead.promise as Promise<Value | null>
      },
      set: async (key, value) => {
        writes.push({ key, value })
      },
      watch: async () => async () => {}
    }
    const fixture = createFixture({ storage })

    await vi.waitFor(() => expect(fixture.get).toHaveBeenCalledTimes(3))
    fixture.store.send(fixture.domain.command.UpdatePositionCommand({ x: -220, y: 48 }))
    fixture.store.send(fixture.domain.command.UpdateOpenCommand(true))
    await vi.waitFor(() => expect(writes).toHaveLength(3))

    positionRead.resolve({ x: 90, y: 20 })
    unreadRead.resolve(true)
    openRead.resolve(false)
    await vi.waitFor(() => expect(fixture.store.query(fixture.domain.query.StatusLoadIsFinishedQuery())).toBe(true))
    await settle()

    expect(statusOf(fixture)).toEqual({ open: true, unread: false, position: { x: -220, y: 48 } })
    expect(writes).toEqual(
      expect.arrayContaining([
        { key: APP_POSITION_STORAGE_KEY, value: { x: -220, y: 48 } },
        { key: APP_OPEN_STORAGE_KEY, value: true },
        { key: APP_UNREAD_STORAGE_KEY, value: false }
      ])
    )
    expect(writes).toHaveLength(3)
  })

  it('writes only the addressed fields and synchronizes position without clobbering status', async () => {
    const domainA = createSharedStatusStorage({ open: false, unread: true, position: { x: 64, y: 24 } })
    const domainB = createSharedStatusStorage({ open: false, unread: false, position: { x: -70, y: 30 } })
    const tabs = {
      A: createFixture({ storage: domainA.createTab('A') }),
      B: createFixture({ storage: domainA.createTab('B') }),
      C: createFixture({ storage: domainA.createTab('C') }),
      D: createFixture({ storage: domainB.createTab('D') })
    }
    await prepareDelivery(...Object.values(tabs))

    domainA.clearWrites()
    tabs.C.store.send(tabs.C.domain.command.UpdateOpenCommand(true))
    await vi.waitFor(() => expect(statusOf(tabs.A)).toMatchObject({ open: true, unread: false }))
    expect(domainA.writes.map(({ key }) => key).toSorted()).toEqual(
      [APP_OPEN_STORAGE_KEY, APP_UNREAD_STORAGE_KEY].toSorted()
    )
    expect(domainA.value(APP_POSITION_STORAGE_KEY)).toEqual({ x: 64, y: 24 })

    domainA.clearWrites()
    tabs.B.store.send(tabs.B.domain.command.UpdatePositionCommand({ x: -180, y: 46 }))
    await vi.waitFor(() => expect(statusOf(tabs.A).position).toEqual({ x: -180, y: 46 }))
    expect(domainA.writes).toEqual([{ tabId: 'B', key: APP_POSITION_STORAGE_KEY, value: { x: -180, y: 46 } }])
    expect(statusOf(tabs.C)).toEqual({ open: true, unread: false, position: { x: -180, y: 46 } })
    expect(statusOf(tabs.D)).toEqual({ open: false, unread: false, position: { x: -70, y: 30 } })
  })

  it.each(['A', 'B', 'C'] as const)(
    'shows one shared unread result only on domain A when tab %s wins first delivery',
    async (winner) => {
      const domainA = createSharedStatusStorage({ open: false, unread: false, position: { x: 50, y: 22 } })
      const domainB = createSharedStatusStorage({ open: false, unread: false, position: { x: 50, y: 22 } })
      const tabs = {
        A: createFixture({ storage: domainA.createTab('A') }),
        B: createFixture({ storage: domainA.createTab('B') }),
        C: createFixture({ storage: domainA.createTab('C') }),
        D: createFixture({ storage: domainB.createTab('D') })
      }
      await prepareDelivery(...Object.values(tabs))

      tabs[winner].emitMessage(textMessage(`remote-${winner}`, OTHER.id))
      await vi.waitFor(() => expect(statusOf(tabs.C).unread).toBe(true))

      expect([statusOf(tabs.A), statusOf(tabs.B), statusOf(tabs.C)]).toEqual([
        { open: false, unread: true, position: { x: 50, y: 22 } },
        { open: false, unread: true, position: { x: 50, y: 22 } },
        { open: false, unread: true, position: { x: 50, y: 22 } }
      ])
      expect(statusOf(tabs.D)).toEqual({ open: false, unread: false, position: { x: 50, y: 22 } })
    }
  )

  it('opens and reads the domain, keeps expanded delivery read, then synchronizes collapse and later unread', async () => {
    const domainA = createSharedStatusStorage({ open: false, unread: false, position: { x: 50, y: 22 } })
    const domainB = createSharedStatusStorage({ open: false, unread: false, position: { x: 50, y: 22 } })
    const tabs = {
      A: createFixture({ storage: domainA.createTab('A') }),
      B: createFixture({ storage: domainA.createTab('B') }),
      C: createFixture({ storage: domainA.createTab('C') }),
      D: createFixture({ storage: domainB.createTab('D') })
    }
    await prepareDelivery(...Object.values(tabs))

    tabs.B.emitMessage(textMessage('domain-a-first', OTHER.id))
    tabs.D.emitMessage(textMessage('domain-b-first', OTHER.id))
    await vi.waitFor(() => expect(statusOf(tabs.C).unread).toBe(true))
    await vi.waitFor(() => expect(statusOf(tabs.D).unread).toBe(true))

    tabs.C.store.send(tabs.C.domain.command.UpdateOpenCommand(true))
    await vi.waitFor(() => expect(statusOf(tabs.A)).toMatchObject({ open: true, unread: false }))
    expect(
      [statusOf(tabs.A), statusOf(tabs.B), statusOf(tabs.C)].every((status) => status.open && !status.unread)
    ).toBe(true)

    domainA.clearWrites()
    tabs.A.emitMessage(textMessage('expanded-delivery', OTHER.id))
    await settle()
    expect(domainA.writes).toEqual([])
    expect(
      [statusOf(tabs.A), statusOf(tabs.B), statusOf(tabs.C)].every((status) => status.open && !status.unread)
    ).toBe(true)

    tabs.A.store.send(tabs.A.domain.command.UpdateOpenCommand(false))
    await vi.waitFor(() => expect(statusOf(tabs.C).open).toBe(false))
    expect(
      [statusOf(tabs.A), statusOf(tabs.B), statusOf(tabs.C)].every((status) => !status.open && !status.unread)
    ).toBe(true)

    tabs.C.emitMessage(textMessage('domain-a-later', OTHER.id))
    await vi.waitFor(() => expect(statusOf(tabs.A).unread).toBe(true))
    expect(
      [statusOf(tabs.A), statusOf(tabs.B), statusOf(tabs.C)].every((status) => !status.open && status.unread)
    ).toBe(true)
    expect(statusOf(tabs.D)).toEqual({ open: false, unread: true, position: { x: 50, y: 22 } })
  })

  it('repairs a stale collapsed tab unread mark after another tab has opened the domain', async () => {
    const domainA = createSharedStatusStorage({ open: false, unread: false, position: { x: 50, y: 22 } })
    const tabs = {
      A: createFixture({ storage: domainA.createTab('A') }),
      B: createFixture({ storage: domainA.createTab('B') }),
      C: createFixture({ storage: domainA.createTab('C') })
    }
    await prepareDelivery(...Object.values(tabs))

    domainA.pause('B')
    tabs.C.store.send(tabs.C.domain.command.UpdateOpenCommand(true))
    await vi.waitFor(() => expect(statusOf(tabs.A).open).toBe(true))
    expect(statusOf(tabs.B).open).toBe(false)

    domainA.clearWrites()
    tabs.B.emitMessage(textMessage('stale-collapsed-delivery', OTHER.id))
    await vi.waitFor(() =>
      expect(domainA.writes.some(({ tabId, value }) => tabId === 'B' && value === true)).toBe(true)
    )
    await vi.waitFor(() => {
      expect(domainA.value<boolean>(APP_UNREAD_STORAGE_KEY)).toBe(false)
      expect(domainA.writes.some(({ tabId, value }) => tabId !== 'B' && value === false)).toBe(true)
    })

    expect(domainA.writes.map(({ key }) => key).every((key) => key === APP_UNREAD_STORAGE_KEY)).toBe(true)
    expect(domainA.writes.some(({ tabId, value }) => tabId === 'B' && value === true)).toBe(true)
    expect(domainA.writes.some(({ tabId, value }) => tabId !== 'B' && value === false)).toBe(true)

    domainA.resume('B')
    await vi.waitFor(() => expect(statusOf(tabs.B)).toMatchObject({ open: true, unread: false }))
    expect(
      [statusOf(tabs.A), statusOf(tabs.B), statusOf(tabs.C)].every((status) => status.open && !status.unread)
    ).toBe(true)
  })

  it('ignores self text, history, duplicate insertion, reactions, and system notices', async () => {
    const shared = createSharedStatusStorage({ open: false, unread: false, position: { x: 50, y: 22 } })
    const fixture = createFixture({ storage: shared.createTab('A') })
    await prepareDelivery(fixture)
    shared.clearWrites()

    const history = historyRecord('history')
    await expect(fixture.messageStore.insert(history)).resolves.toEqual({ inserted: true })
    await expect(fixture.messageStore.insert(history)).resolves.toEqual({ inserted: false, existing: history })
    fixture.emitMessage(textMessage('self', SELF.id))
    fixture.emitMessage(reactionMessage('reaction'))
    fixture.emitJoin({ sessionId: 'remote-session', user: OTHER })
    fixture.emitLeave({ sessionId: 'remote-session', user: OTHER })
    await settle()

    expect(statusOf(fixture).unread).toBe(false)
    expect(shared.writes.filter(({ key }) => key === APP_UNREAD_STORAGE_KEY)).toEqual([])

    fixture.emitMessage(textMessage('remote-1', OTHER.id))
    fixture.emitMessage(textMessage('remote-2', OTHER.id))
    await vi.waitFor(() => expect(statusOf(fixture).unread).toBe(true))
    expect(shared.writes.filter(({ key }) => key === APP_UNREAD_STORAGE_KEY)).toEqual([
      { tabId: 'A', key: APP_UNREAD_STORAGE_KEY, value: true }
    ])
  })

  it.each([
    { notificationEnabled: false, notificationType: 'all' as const, focused: true },
    { notificationEnabled: true, notificationType: 'at' as const, focused: false }
  ])(
    'marks collapsed unread independently of notification settings and focused/highlighted tabs',
    async ({ notificationEnabled, notificationType, focused }) => {
      const shared = createSharedStatusStorage({ open: false, unread: false, position: { x: 50, y: 22 } })
      const tabsQuery = vi.fn(async () => [{ active: true, highlighted: true }])
      const windowsGetLastFocused = vi.fn(async () => ({ focused }))
      vi.stubGlobal('browser', { tabs: { query: tabsQuery }, windows: { getLastFocused: windowsGetLastFocused } })
      const hasFocus = vi.spyOn(document, 'hasFocus').mockReturnValue(focused)
      const fixture = createFixture({
        storage: shared.createTab('A'),
        userInfo: { ...SELF, notificationEnabled, notificationType }
      })
      await prepareDelivery(fixture)

      fixture.emitMessage(textMessage('remote', OTHER.id))
      await vi.waitFor(() => expect(statusOf(fixture).unread).toBe(true))

      expect(hasFocus).not.toHaveBeenCalled()
      expect(tabsQuery).not.toHaveBeenCalled()
      expect(windowsGetLastFocused).not.toHaveBeenCalled()
    }
  )

  it('does not apply delayed hydration after its store is discarded', async () => {
    const reads = {
      open: deferred<boolean | null>(),
      position: deferred<AppButtonPosition | null>(),
      unread: deferred<boolean | null>()
    }
    const storage: Storage = {
      get: <Value extends StorageValue>(key: string) => {
        if (key === APP_OPEN_STORAGE_KEY) return reads.open.promise as Promise<Value | null>
        if (key === APP_POSITION_STORAGE_KEY) return reads.position.promise as Promise<Value | null>
        return reads.unread.promise as Promise<Value | null>
      },
      set: async () => {},
      watch: async () => async () => {}
    }
    const fixture = createFixture({ storage })
    await vi.waitFor(() => expect(fixture.get).toHaveBeenCalledTimes(3))

    fixture.store.discard()
    activeStores.delete(fixture.store)
    reads.open.resolve(true)
    reads.position.resolve({ x: -90, y: 44 })
    reads.unread.resolve(false)
    await settle()

    expect(fixture.set).not.toHaveBeenCalled()
  })
})
