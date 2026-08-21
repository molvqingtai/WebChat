import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Remesh } from 'remesh'
import ChatRoomDomain from '@/domain/ChatRoom'
import UserInfoDomain, { type UserInfo } from '@/domain/UserInfo'
import { createMemoryMessageDatabase } from '@/domain/impls/database/Memory'
import { ChatRoom } from '@/domain/impls/runtime/ChatRoom'
import { WorldRoom } from '@/domain/impls/runtime/WorldRoom'
import { createConnectionLifecycle } from '@/domain/impls/ConnectionLifecycle'
import { createSendLifecycle } from '@/domain/impls/SendLifecycle'
import { ChatRoomExtern } from '@/domain/externs/ChatRoom'
import { ConnectionLifecycleExtern } from '@/domain/externs/ConnectionLifecycle'
import { ReadinessExtern } from '@/domain/externs/Readiness'
import { SendLifecycleExtern } from '@/domain/externs/SendLifecycle'
import { BrowserSyncStorageExtern, type Storage, type StorageValue } from '@/domain/externs/Storage'
import { WorldRoomExtern } from '@/domain/externs/WorldRoom'
import { createMessageStore, MessageDatabaseExtern } from '@/domain/MessageStore'
import type { PresenceDomainRecord, PresenceStore } from '@/domain/runtime/externs/PresenceStore'
import { MESSAGE_TYPE, type ChatUser } from '@/protocol'
import type { RoomTransport } from '@/runtime/RoomTransport'
import {
  createServer,
  disposeServer,
  getChatRoomId,
  removeServerTab,
  restoreServerPageBindings,
  startServerJoin
} from '@/runtime/Server'
import { ClientLease } from './ClientLease'
import type { RuntimeCoordinator, RuntimePageRegistration, RuntimeServer, RuntimeSnapshot } from './Contract'

const pageId = 'page-a'
const domain = 'https://example.test'
const otherDomain = 'https://other.example.test'
const pageUrl = `${domain}/topic`
const user: ChatUser = { id: 'local-user', name: 'Local', avatar: '' }
const site = { origin: domain, title: 'Example', icon: `${domain}/favicon.ico` }
const userInfo: UserInfo = {
  ...user,
  createTime: 1,
  themeMode: 'system',
  danmakuEnabled: true,
  notificationEnabled: true,
  notificationType: 'all'
}

const snapshot = (hostId = 'host-a'): RuntimeSnapshot => ({
  hostId,
  hostPhase: 'ready',
  peerId: 'peer-a',
  domains: [{ domain, phase: 'active', pageIds: [pageId], chatRoomJoined: true, sessions: [] }],
  world: { joined: true, peerId: 'peer-a', presences: [] }
})

const registration = (hostId = 'host-a'): RuntimePageRegistration => ({ snapshot: snapshot(hostId) })

let databaseId = 0

const createComposedReadiness = ({
  inboundRegistration = Promise.resolve(),
  sessionRegistration = Promise.resolve(),
  worldRegistration = Promise.resolve()
}: {
  inboundRegistration?: Promise<void>
  sessionRegistration?: Promise<void>
  worldRegistration?: Promise<void>
} = {}) => {
  const registerPage = vi.fn<RuntimeCoordinator['registerPage']>().mockResolvedValue(registration())
  const client = new ClientLease({ coordinator: coordinatorWith(registerPage), pageId, domain })
  const server = {
    onInbound: vi.fn(async () => inboundRegistration),
    onSessionEvent: vi.fn(async () => sessionRegistration),
    onError: vi.fn(async () => {}),
    provideHistory: vi.fn(async () => {}),
    onHistoryFeedback: vi.fn(async () => {}),
    replayInbound: vi.fn(async () => []),
    onWorldPresence: vi.fn(async () => worldRegistration),
    getSnapshot: vi.fn(async () => snapshot())
  } as unknown as RuntimeServer
  const database = createMemoryMessageDatabase(`client-lease-readiness-${databaseId++}`)
  const chat = new ChatRoom({
    server,
    messageStore: createMessageStore(database),
    pageDomain: domain,
    pageId,
    getSnapshot: () => client.snapshot(),
    whenReady: (callback) => client.whenReady(callback)
  })
  new WorldRoom({
    server,
    pageId,
    getSnapshot: () => client.snapshot(),
    whenReady: (callback) => client.whenReady(callback)
  })
  return { chat, client, database, registerPage, server }
}

const coordinatorWith = (registerPage: RuntimeCoordinator['registerPage']): RuntimeCoordinator => ({
  registerPage
})

const createRecoveryTransport = (holdJoin?: Promise<void>, joinError?: Error) => {
  const joined = new Set<string>()
  const joinCalls: string[] = []
  const leaveCalls: string[] = []
  const sendCalls: string[] = []
  const listeners = {
    message: new Set<(roomId: string, sourcePeerId: string, rawPayload: string) => void>(),
    peerJoin: new Set<(roomId: string, peerId: string) => void>(),
    peerLeave: new Set<(roomId: string, peerId: string) => void>(),
    roomClose: new Set<(roomId: string) => void>(),
    error: new Set<(error: Error, roomId: string) => void>()
  }
  const transport: RoomTransport = {
    peerIdOf: (roomId) => (joined.has(roomId) ? `peer:${roomId}` : ''),
    join: async (roomId) => {
      joinCalls.push(roomId)
      if (holdJoin && roomId === getChatRoomId(domain)) await holdJoin
      if (joinError && roomId === getChatRoomId(domain)) throw joinError
      joined.add(roomId)
    },
    leave: (roomId) => {
      leaveCalls.push(roomId)
      joined.delete(roomId)
    },
    send: async (roomId) => {
      sendCalls.push(roomId)
      if (!joined.has(roomId)) throw new Error(`Room "${roomId}" is not joined`)
    },
    onMessage: (callback) => {
      listeners.message.add(callback)
      return () => listeners.message.delete(callback)
    },
    onPeerJoin: (callback) => {
      listeners.peerJoin.add(callback)
      return () => listeners.peerJoin.delete(callback)
    },
    onPeerLeave: (callback) => {
      listeners.peerLeave.add(callback)
      return () => listeners.peerLeave.delete(callback)
    },
    onRoomClose: (callback) => {
      listeners.roomClose.add(callback)
      return () => listeners.roomClose.delete(callback)
    },
    onError: (callback) => {
      listeners.error.add(callback)
      return () => listeners.error.delete(callback)
    },
    dispose: () => {
      joined.clear()
      Object.values(listeners).forEach((items) => items.clear())
    }
  }
  return { joinCalls, leaveCalls, sendCalls, transport }
}

const createAutomaticRecoveryPage = ({
  pageId,
  tab,
  getServer,
  recoverySiteOrigin
}: {
  pageId: string
  tab: { id: number; url: string }
  getServer: () => RuntimeServer
  recoverySiteOrigin?: () => string | undefined
}) => {
  const client = new ClientLease({
    coordinator: coordinatorWith(async () => ({
      snapshot: await getServer().attachPage({ domain, pageId, caller: { tab } })
    })),
    pageId,
    domain
  })
  const bind = <Payload extends object>(payload: Payload) => ({
    ...payload,
    pageId,
    runtimeHostId: client.runtimeHostId(),
    caller: { tab }
  })
  const server = {
    attachPage: (payload) => getServer().attachPage(bind(payload)),
    detachPage: (payload) => getServer().detachPage(bind(payload)),
    getSnapshot: () => getServer().getSnapshot(),
    joinChatRoom: (payload) => {
      const origin = recoverySiteOrigin?.()
      return getServer().joinChatRoom(bind(origin ? { ...payload, site: { ...payload.site, origin } } : payload))
    },
    leaveChatRoom: (payload) => getServer().leaveChatRoom(bind(payload)),
    allocateTextMessage: (payload) => getServer().allocateTextMessage(bind(payload)),
    allocateReactionMessage: (payload) => getServer().allocateReactionMessage(bind(payload)),
    sendChatMessage: (payload) => getServer().sendChatMessage(bind(payload)),
    ackInbound: (payload) => getServer().ackInbound(bind(payload)),
    replayInbound: (payload) => getServer().replayInbound(bind(payload)),
    reconnectDomain: (payload) => getServer().reconnectDomain(bind(payload)),
    onInbound: (payload, callback) => getServer().onInbound(bind(payload), callback),
    onSessionEvent: (payload, callback) => getServer().onSessionEvent(bind(payload), callback),
    onWorldPresence: (payload, callback) => getServer().onWorldPresence(bind(payload), callback),
    onError: (payload, callback) => getServer().onError(bind(payload), callback),
    onHistoryFeedback: (payload, callback) => getServer().onHistoryFeedback(bind(payload), callback),
    provideHistory: (payload, callback) => getServer().provideHistory(bind(payload), callback),
    resolveHistorySupply: (payload) => getServer().resolveHistorySupply(bind(payload)),
    rejectHistorySupply: (payload) => getServer().rejectHistorySupply(bind(payload))
  } as RuntimeServer
  const database = createMemoryMessageDatabase(`client-lease-two-page-recovery-${databaseId++}`)
  const chat = new ChatRoom({
    server,
    messageStore: createMessageStore(database),
    pageDomain: domain,
    pageId,
    getSnapshot: () => client.snapshot(),
    whenReady: (callback) => client.whenReady(callback)
  })
  const lifecycle = createConnectionLifecycle()
  chat.bindConnectionResultReporter(lifecycle.report)
  const storage: Storage = {
    get: async <Value extends StorageValue>() => userInfo as Value,
    set: async () => {},
    watch: async () => async () => {}
  }
  const store = Remesh.store({
    externs: [
      ChatRoomExtern.impl(chat),
      ConnectionLifecycleExtern.impl(lifecycle.value),
      SendLifecycleExtern.impl(createSendLifecycle()),
      ReadinessExtern.impl({
        onState: (callback) =>
          client.whenHostPhase((phase) => callback(phase === 'ready' || phase === 'unavailable' ? phase : 'connecting'))
      }),
      MessageDatabaseExtern.impl(database),
      BrowserSyncStorageExtern.impl(storage),
      WorldRoomExtern.impl({ getState: async () => [], onState: () => () => {}, onError: () => () => {} })
    ]
  })
  const roomAction = ChatRoomDomain()
  const userAction = UserInfoDomain()
  const room = store.getDomain(roomAction)
  const info = store.getDomain(userAction)
  store.igniteDomain(roomAction)
  store.send(info.command.UpdateUserInfoCommand(userInfo))

  return {
    chat,
    client,
    dispose: async () => {
      store.discard()
      chat.dispose()
      client.detach()
      await database.close()
    },
    initialize: async () => {
      await client.init()
      store.send(room.command.JoinRoomCommand())
      await vi.waitFor(() => expect(store.query(room.query.JoinIsFinishedQuery())).toBe(true))
    }
  }
}

const createTwoPageRecovery = async ({
  ownerSiteOrigin = domain,
  ownerJoinError,
  ownerJoinGate,
  ownerRebindGate,
  followerRebindGate,
  holdOwnerLoad = true,
  waitForOwnerLoad = true,
  stored = null
}: {
  ownerSiteOrigin?: string
  ownerJoinError?: Error
  ownerJoinGate?: Promise<void>
  ownerRebindGate?: Promise<void>
  followerRebindGate?: Promise<void>
  holdOwnerLoad?: boolean
  waitForOwnerLoad?: boolean
  stored?: PresenceDomainRecord | null
} = {}) => {
  vi.stubGlobal('document', {
    location: { origin: domain },
    title: 'Example',
    querySelector: () => null
  })
  const storageState: Record<string, unknown> = {}
  const ownerPageId = 'page-owner'
  const followerPageId = 'page-follower'
  const ownerTab = { id: 7, url: pageUrl }
  const followerTab = { id: 8, url: `${domain}/second-topic` }
  const tabs = new Map([
    [ownerTab.id, ownerTab],
    [followerTab.id, followerTab]
  ])
  const ownerLoadStarted = deferred<void>()
  const releaseOwnerLoad = deferred<void>()
  let loadCount = 0
  let ownerRecoveryStartedAt = 0
  const presenceStore: PresenceStore = {
    load: vi.fn(async () => {
      loadCount += 1
      if (loadCount === 1) {
        ownerLoadStarted.resolve()
        if (holdOwnerLoad) await releaseOwnerLoad.promise
      }
      return stored
    }),
    save: vi.fn(async () => {})
  }
  let currentServer!: RuntimeServer
  let activeOwnerSiteOrigin: string | undefined
  const pages = new Map<string, ReturnType<typeof createAutomaticRecoveryPage>>()
  const admission = {
    tabs: {
      get: async (tabId: number) => {
        const tab = tabs.get(tabId)
        if (!tab) throw new Error('tab missing')
        return tab
      },
      sendMessage: async () => undefined
    },
    storage: {
      get: async (key: string) => ({ [key]: storageState[key] }),
      set: async (items: Record<string, unknown>) => {
        Object.assign(storageState, items)
      }
    },
    rebindPage: async (_tabId: number, pageId: string) => {
      if (pageId === ownerPageId && ownerRecoveryStartedAt === 0) {
        ownerRecoveryStartedAt = Date.now()
      }
      if (pageId === ownerPageId && ownerRebindGate) await ownerRebindGate
      if (pageId === followerPageId && followerRebindGate) await followerRebindGate
      if (pageId === followerPageId && waitForOwnerLoad) await ownerLoadStarted.promise
      await pages.get(pageId)?.client.rebind()
    },
    ensureTransport: async () => {}
  }
  const firstTransport = createRecoveryTransport()
  const first = createServer({ transport: firstTransport.transport, admission })
  currentServer = first
  const owner = createAutomaticRecoveryPage({
    pageId: ownerPageId,
    tab: ownerTab,
    getServer: () => currentServer,
    recoverySiteOrigin: () => activeOwnerSiteOrigin
  })
  const follower = createAutomaticRecoveryPage({
    pageId: followerPageId,
    tab: followerTab,
    getServer: () => currentServer
  })
  pages.set(ownerPageId, owner)
  pages.set(followerPageId, follower)
  await owner.initialize()
  await follower.initialize()
  activeOwnerSiteOrigin = ownerSiteOrigin === domain ? undefined : ownerSiteOrigin

  const secondTransport = createRecoveryTransport(ownerJoinGate, ownerJoinError)
  const second = createServer({ transport: secondTransport.transport, admission, presenceStore })
  currentServer = second
  const automaticJoin = vi.spyOn(second, 'joinChatRoom')
  const restoring = restoreServerPageBindings(second)
  if (!ownerRebindGate) {
    await ownerLoadStarted.promise
    await vi.waitFor(() => expect(automaticJoin).toHaveBeenCalledTimes(2))
  }

  return {
    automaticJoin,
    dispose: async () => {
      await owner.dispose()
      await follower.dispose()
      disposeServer(first)
      disposeServer(second)
    },
    follower,
    removeFollower: async () => {
      tabs.delete(followerTab.id)
      await removeServerTab(second, followerTab.id)
    },
    owner,
    get ownerRecoveryStartedAt() {
      return ownerRecoveryStartedAt
    },
    presenceStore,
    releaseOwnerLoad,
    restoring,
    second,
    secondTransport
  }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('ClientLease event-driven Runtime admission', () => {
  it('initializes once and never starts a Page watchdog', async () => {
    const registerPage = vi.fn<RuntimeCoordinator['registerPage']>().mockResolvedValue(registration())
    const interval = vi.spyOn(globalThis, 'setInterval')
    const client = new ClientLease({ coordinator: coordinatorWith(registerPage), pageId, domain })

    await client.init()
    await vi.advanceTimersByTimeAsync(60_000)

    expect(registerPage).toHaveBeenCalledOnce()
    expect(interval).not.toHaveBeenCalled()
    client.detach()
  })

  it('refreshes only from one explicit current Page event', async () => {
    const registerPage = vi
      .fn<RuntimeCoordinator['registerPage']>()
      .mockResolvedValueOnce(registration('host-a'))
      .mockResolvedValueOnce(registration('host-b'))
    const ready = vi.fn()
    const client = new ClientLease({ coordinator: coordinatorWith(registerPage), pageId, domain })
    client.whenReady(ready)

    await client.init()
    await client.checkNow()

    expect(registerPage).toHaveBeenCalledTimes(2)
    expect(client.snapshot()).toMatchObject({ hostId: 'host-b' })
    expect(ready).toHaveBeenCalledTimes(2)
    client.detach()
  })

  it('rebinds through a fresh ordinary registration without using the test-only refresh entry', async () => {
    const registerPage = vi
      .fn<RuntimeCoordinator['registerPage']>()
      .mockResolvedValueOnce(registration('host-a'))
      .mockResolvedValueOnce(registration('host-b'))
    const ready = vi.fn()
    const client = new ClientLease({ coordinator: coordinatorWith(registerPage), pageId, domain })
    client.whenReady(ready)

    await client.init()
    await client.rebind()

    expect(registerPage).toHaveBeenCalledTimes(2)
    expect(client.snapshot()).toMatchObject({ hostId: 'host-b' })
    expect(ready).toHaveBeenCalledTimes(2)
    client.detach()
  })

  it('restores a fresh Server target domain through the retained automatic ChatRoom join before releasing actions', async () => {
    vi.stubGlobal('document', {
      location: { origin: domain },
      title: 'Example',
      querySelector: () => null
    })
    const storageState: Record<string, unknown> = {}
    const tab = { id: 7, url: pageUrl }
    let client!: ClientLease
    let chat!: ChatRoom
    let submitDuringRecovery = false
    let recoveryAction: Promise<unknown> | null = null
    const admission = {
      tabs: {
        get: async () => tab,
        sendMessage: async () => undefined
      },
      storage: {
        get: async (key: string) => ({ [key]: storageState[key] }),
        set: async (items: Record<string, unknown>) => {
          Object.assign(storageState, items)
        }
      },
      rebindPage: async () => client.rebind(),
      ensureTransport: async () => {}
    }
    const firstTransport = createRecoveryTransport()
    const first = createServer({ transport: firstTransport.transport, admission })
    let currentServer: RuntimeServer = first
    const registerPage: RuntimeCoordinator['registerPage'] = async () => {
      const snapshot = await currentServer.attachPage({ domain, pageId, caller: { tab } })
      if (submitDuringRecovery) {
        recoveryAction = chat.sendMessage({ type: MESSAGE_TYPE.TEXT, body: 'during recovery', mentions: [] })
      }
      return { snapshot }
    }
    client = new ClientLease({ coordinator: coordinatorWith(registerPage), pageId, domain })
    const bind = <Payload extends object>(payload: Payload) => ({
      ...payload,
      pageId,
      runtimeHostId: client.runtimeHostId(),
      caller: { tab }
    })
    const server = {
      attachPage: (payload) => currentServer.attachPage(bind(payload)),
      detachPage: (payload) => currentServer.detachPage(bind(payload)),
      getSnapshot: () => currentServer.getSnapshot(),
      joinChatRoom: (payload) => currentServer.joinChatRoom(bind(payload)),
      leaveChatRoom: (payload) => currentServer.leaveChatRoom(bind(payload)),
      allocateTextMessage: (payload) => currentServer.allocateTextMessage(bind(payload)),
      allocateReactionMessage: (payload) => currentServer.allocateReactionMessage(bind(payload)),
      sendChatMessage: (payload) => currentServer.sendChatMessage(bind(payload)),
      ackInbound: (payload) => currentServer.ackInbound(bind(payload)),
      replayInbound: (payload) => currentServer.replayInbound(bind(payload)),
      reconnectDomain: (payload) => currentServer.reconnectDomain(bind(payload)),
      onInbound: (payload, callback) => currentServer.onInbound(bind(payload), callback),
      onSessionEvent: (payload, callback) => currentServer.onSessionEvent(bind(payload), callback),
      onWorldPresence: (payload, callback) => currentServer.onWorldPresence(bind(payload), callback),
      onError: (payload, callback) => currentServer.onError(bind(payload), callback),
      onHistoryFeedback: (payload, callback) => currentServer.onHistoryFeedback(bind(payload), callback),
      provideHistory: (payload, callback) => currentServer.provideHistory(bind(payload), callback),
      resolveHistorySupply: (payload) => currentServer.resolveHistorySupply(bind(payload)),
      rejectHistorySupply: (payload) => currentServer.rejectHistorySupply(bind(payload))
    } as RuntimeServer
    const database = createMemoryMessageDatabase(`client-lease-domain-recovery-${databaseId++}`)
    chat = new ChatRoom({
      server,
      messageStore: createMessageStore(database),
      pageDomain: domain,
      pageId,
      getSnapshot: () => client.snapshot(),
      whenReady: (callback) => client.whenReady(callback)
    })
    const lifecycle = createConnectionLifecycle()
    chat.bindConnectionResultReporter(lifecycle.report)
    const storage: Storage = {
      get: async <Value extends StorageValue>() => userInfo as Value,
      set: async () => {},
      watch: async () => async () => {}
    }
    const store = Remesh.store({
      externs: [
        ChatRoomExtern.impl(chat),
        ConnectionLifecycleExtern.impl(lifecycle.value),
        SendLifecycleExtern.impl(createSendLifecycle()),
        ReadinessExtern.impl({
          onState: (callback) =>
            client.whenHostPhase((phase) =>
              callback(phase === 'ready' || phase === 'unavailable' ? phase : 'connecting')
            )
        }),
        MessageDatabaseExtern.impl(database),
        BrowserSyncStorageExtern.impl(storage),
        WorldRoomExtern.impl({ getState: async () => [], onState: () => () => {}, onError: () => () => {} })
      ]
    })
    const roomAction = ChatRoomDomain()
    const userAction = UserInfoDomain()
    const room = store.getDomain(roomAction)
    const info = store.getDomain(userAction)
    store.igniteDomain(roomAction)
    store.send(info.command.UpdateUserInfoCommand(userInfo))

    await client.init()
    store.send(room.command.JoinRoomCommand())
    await vi.waitFor(() => expect(store.query(room.query.JoinIsFinishedQuery())).toBe(true))
    const staleCall = {
      pageId,
      runtimeHostId: client.runtimeHostId(),
      caller: { tab }
    }

    const joinGate = deferred<void>()
    const secondTransport = createRecoveryTransport(joinGate.promise)
    const second = createServer({ transport: secondTransport.transport, admission })
    currentServer = second
    const joinChatRoom = second.joinChatRoom.bind(second)
    const automaticJoin = vi.spyOn(second, 'joinChatRoom')
    submitDuringRecovery = true
    const restore = restoreServerPageBindings(second)
    const staleJoin = joinChatRoom({ domain, user, site, ...staleCall })
    const mismatchedJoin = joinChatRoom({
      domain: otherDomain,
      user,
      site: { ...site, origin: otherDomain },
      pageId,
      runtimeHostId: (await second.getSnapshot()).hostId,
      caller: { tab }
    })

    await restore
    expect(client.runtimeHostId()).toBe((await second.getSnapshot()).hostId)
    await vi.waitFor(() => expect(automaticJoin).toHaveBeenCalledOnce())
    expect(recoveryAction).not.toBeNull()
    await expect(staleJoin).rejects.toThrow('Runtime current-domain recovery owner is no longer current')
    await expect(mismatchedJoin).rejects.toThrow('Runtime current-domain recovery owner is no longer current')
    await vi.waitFor(() =>
      expect(secondTransport.joinCalls.filter((roomId) => roomId === getChatRoomId(domain))).toHaveLength(1)
    )
    let settled = false
    void recoveryAction!.then(() => {
      settled = true
    })
    await Promise.resolve()
    expect(settled).toBe(false)

    joinGate.resolve()
    await expect(recoveryAction).resolves.toMatchObject({ type: MESSAGE_TYPE.TEXT, body: 'during recovery' })
    expect(automaticJoin).toHaveBeenCalledOnce()
    expect(secondTransport.joinCalls.filter((roomId) => roomId === getChatRoomId(domain))).toHaveLength(1)

    store.discard()
    chat.dispose()
    client.detach()
    await database.close()
    disposeServer(first)
    disposeServer(second)
  })

  it('keeps the exact restoring owner exclusive while two surviving Pages automatically rejoin', async () => {
    const recovery = await createTwoPageRecovery()
    let settled = false
    const action = recovery.owner.chat.sendMessage({
      type: MESSAGE_TYPE.TEXT,
      body: 'during owner fence',
      mentions: []
    })
    const followerJoin = recovery.automaticJoin.mock.results[1]?.value as Promise<unknown>
    let followerSettled = false
    void action.then(() => {
      settled = true
    })
    void followerJoin.then(() => {
      followerSettled = true
    })

    await Promise.resolve()
    expect(settled).toBe(false)
    expect(followerSettled).toBe(false)
    expect(recovery.presenceStore.load).toHaveBeenCalledOnce()
    expect(recovery.presenceStore.save).not.toHaveBeenCalled()
    expect(recovery.secondTransport.joinCalls.filter((roomId) => roomId === getChatRoomId(domain))).toHaveLength(0)
    expect(recovery.secondTransport.sendCalls).toHaveLength(0)

    recovery.releaseOwnerLoad.resolve()
    await recovery.restoring
    await expect(action).resolves.toMatchObject({ type: MESSAGE_TYPE.TEXT, body: 'during owner fence' })
    await expect(followerJoin).resolves.toMatchObject({ hostId: expect.any(String) })
    expect(recovery.automaticJoin).toHaveBeenCalledTimes(2)
    expect(recovery.presenceStore.load).toHaveBeenCalledOnce()
    expect(recovery.presenceStore.save).toHaveBeenCalledTimes(2)
    expect(recovery.secondTransport.joinCalls.filter((roomId) => roomId === getChatRoomId(domain))).toHaveLength(1)
    await recovery.dispose()
  })

  it('rejects the restoring owner, follower, and waiting action with one physical-join failure', async () => {
    const failure = new Error('exact restoring physical join failed')
    const recovery = await createTwoPageRecovery({ ownerJoinError: failure })
    const action = recovery.owner.chat.sendMessage({
      type: MESSAGE_TYPE.TEXT,
      body: 'must share owner failure',
      mentions: []
    })
    const ownerJoin = recovery.automaticJoin.mock.results[0]?.value as Promise<unknown>
    const followerJoin = recovery.automaticJoin.mock.results[1]?.value as Promise<unknown>
    const ownerOutcome = ownerJoin.catch((error) => error)
    const followerOutcome = followerJoin.catch((error) => error)
    const actionOutcome = action.catch((error) => error)

    recovery.releaseOwnerLoad.resolve()
    await recovery.restoring

    await expect(ownerOutcome).resolves.toBe(failure)
    await expect(followerOutcome).resolves.toBe(failure)
    await expect(actionOutcome).resolves.toBe(failure)
    expect(recovery.presenceStore.load).toHaveBeenCalledOnce()
    expect(recovery.secondTransport.joinCalls.filter((roomId) => roomId === getChatRoomId(domain))).toHaveLength(1)
    expect(recovery.secondTransport.sendCalls).toHaveLength(0)
    expect(
      (await recovery.second.getSnapshot()).domains.find((item) => item.domain === domain)?.localSession
    ).toBeUndefined()
    await recovery.dispose()
  })

  it('settles a superseded restoring owner quietly while a real successor command commits', async () => {
    const ownerJoinGate = deferred<void>()
    const recovery = await createTwoPageRecovery({ ownerJoinGate: ownerJoinGate.promise })
    const ownerJoin = recovery.automaticJoin.mock.results[0]?.value as Promise<unknown>
    const followerJoin = recovery.automaticJoin.mock.results[1]?.value as Promise<unknown>
    const ownerOutcome = ownerJoin.catch((error) => error)
    const followerOutcome = followerJoin.catch((error) => error)

    recovery.releaseOwnerLoad.resolve()
    await recovery.restoring
    await vi.waitFor(() =>
      expect(recovery.secondTransport.joinCalls.filter((roomId) => roomId === getChatRoomId(domain))).toHaveLength(1)
    )

    const successor = startServerJoin(recovery.second, {
      operationId: 'superseding-test-join',
      domain,
      user,
      site
    })

    await expect(ownerOutcome).resolves.toBeNull()
    await expect(followerOutcome).resolves.toBeNull()
    expect(recovery.secondTransport.leaveCalls).toHaveLength(0)
    expect(recovery.secondTransport.sendCalls).toHaveLength(0)

    ownerJoinGate.resolve()
    await expect(successor).resolves.toBe(true)
    expect(recovery.secondTransport.leaveCalls).toHaveLength(0)
    expect(recovery.secondTransport.joinCalls.filter((roomId) => roomId === getChatRoomId(domain))).toHaveLength(2)
    await recovery.dispose()
  })

  it('fences a restoring owner whose physical join completes after the shared deadline', async () => {
    const ownerJoinGate = deferred<void>()
    const recovery = await createTwoPageRecovery({ ownerJoinGate: ownerJoinGate.promise })
    const action = recovery.owner.chat.sendMessage({
      type: MESSAGE_TYPE.TEXT,
      body: 'must not survive owner deadline',
      mentions: []
    })
    const ownerJoin = recovery.automaticJoin.mock.results[0]?.value as Promise<unknown>
    const followerJoin = recovery.automaticJoin.mock.results[1]?.value as Promise<unknown>
    const ownerOutcome = ownerJoin.catch((error) => error)
    const followerOutcome = followerJoin.catch((error) => error)
    const actionOutcome = action.catch((error) => error)

    recovery.releaseOwnerLoad.resolve()
    await recovery.restoring
    await vi.waitFor(() =>
      expect(recovery.secondTransport.joinCalls.filter((roomId) => roomId === getChatRoomId(domain))).toHaveLength(1)
    )
    let ownerSettled = false
    void ownerOutcome.then(() => {
      ownerSettled = true
    })
    const remainingDeadline = 10_000 - (Date.now() - recovery.ownerRecoveryStartedAt)
    expect(remainingDeadline).toBeGreaterThan(0)
    await vi.advanceTimersByTimeAsync(remainingDeadline)
    await Promise.resolve()
    expect(ownerSettled).toBe(true)

    const timeout = await ownerOutcome
    expect(timeout).toMatchObject({ message: 'Runtime current-domain recovery timed out' })
    await expect(followerOutcome).resolves.toBe(timeout)
    await expect(actionOutcome).resolves.toBe(timeout)
    expect(
      (await recovery.second.getSnapshot()).domains.find((item) => item.domain === domain)?.localSession
    ).toBeUndefined()
    expect(recovery.secondTransport.sendCalls).toHaveLength(0)

    ownerJoinGate.resolve()
    await vi.waitFor(() => expect(recovery.secondTransport.transport.peerIdOf(getChatRoomId(domain))).not.toBe(''))
    await vi.advanceTimersByTimeAsync(0)

    expect(
      (await recovery.second.getSnapshot()).domains.find((item) => item.domain === domain)?.localSession
    ).toBeUndefined()
    expect(recovery.secondTransport.sendCalls).toHaveLength(0)
    await recovery.dispose()
  })

  it('keeps a preclaim timeout on every retained Page until each late automatic join observes it', async () => {
    const ownerRebindGate = deferred<void>()
    const followerRebindGate = deferred<void>()
    const recovery = await createTwoPageRecovery({
      ownerRebindGate: ownerRebindGate.promise,
      followerRebindGate: followerRebindGate.promise,
      holdOwnerLoad: false,
      waitForOwnerLoad: false
    })
    const action = recovery.owner.chat.sendMessage({
      type: MESSAGE_TYPE.TEXT,
      body: 'must not escape the preclaim timeout',
      mentions: []
    })
    const actionOutcome = action.catch((error) => error)

    for (let turn = 0; turn < 20 && recovery.ownerRecoveryStartedAt === 0; turn += 1) {
      await Promise.resolve()
    }
    expect(recovery.ownerRecoveryStartedAt).not.toBe(0)
    const remainingDeadline = 10_000 - (Date.now() - recovery.ownerRecoveryStartedAt)
    expect(remainingDeadline).toBeGreaterThan(0)
    await vi.advanceTimersByTimeAsync(remainingDeadline)

    expect(recovery.automaticJoin).not.toHaveBeenCalled()
    expect(recovery.presenceStore.load).not.toHaveBeenCalled()
    expect(recovery.presenceStore.save).not.toHaveBeenCalled()
    expect(recovery.secondTransport.joinCalls).toHaveLength(0)
    expect(recovery.secondTransport.sendCalls).toHaveLength(0)

    ownerRebindGate.resolve()
    await vi.waitFor(() => expect(recovery.automaticJoin).toHaveBeenCalledOnce())
    const ownerJoin = recovery.automaticJoin.mock.results[0]?.value as Promise<unknown>
    for (let turn = 0; turn < 20; turn += 1) await Promise.resolve()
    const timeout = await ownerJoin.catch((error) => error)

    expect(timeout).toMatchObject({ message: 'Runtime current-domain recovery timed out' })
    expect(recovery.presenceStore.load).not.toHaveBeenCalled()
    expect(recovery.presenceStore.save).not.toHaveBeenCalled()
    expect(recovery.secondTransport.joinCalls).toHaveLength(0)
    expect(recovery.secondTransport.sendCalls).toHaveLength(0)
    expect(
      (await recovery.second.getSnapshot()).domains.find((item) => item.domain === domain)?.localSession
    ).toBeUndefined()
    await expect(actionOutcome).resolves.toBeInstanceOf(DOMException)
    await expect(recovery.owner.chat.joinRoom({ user, site })).rejects.toBe(timeout)

    followerRebindGate.resolve()
    await vi.waitFor(() => expect(recovery.automaticJoin).toHaveBeenCalledTimes(2))
    const followerJoin = recovery.automaticJoin.mock.results[1]?.value as Promise<unknown>
    await expect(followerJoin).rejects.toBe(timeout)
    await recovery.restoring
    expect(recovery.presenceStore.load).not.toHaveBeenCalled()
    expect(recovery.presenceStore.save).not.toHaveBeenCalled()
    expect(recovery.secondTransport.joinCalls).toHaveLength(0)
    expect(recovery.secondTransport.sendCalls).toHaveLength(0)

    await recovery.owner.chat.joinRoom({ user, site })
    expect(recovery.presenceStore.load).toHaveBeenCalledOnce()
    expect(recovery.secondTransport.joinCalls.filter((roomId) => roomId === getChatRoomId(domain))).toHaveLength(1)
    await recovery.dispose()
  })

  it('does not let a timed-out sibling release erase the retained owner timeout', async () => {
    const ownerRebindGate = deferred<void>()
    const followerRebindGate = deferred<void>()
    const recovery = await createTwoPageRecovery({
      ownerRebindGate: ownerRebindGate.promise,
      followerRebindGate: followerRebindGate.promise,
      holdOwnerLoad: false,
      waitForOwnerLoad: false
    })

    for (let turn = 0; turn < 20 && recovery.ownerRecoveryStartedAt === 0; turn += 1) {
      await Promise.resolve()
    }
    expect(recovery.ownerRecoveryStartedAt).not.toBe(0)
    const remainingDeadline = 10_000 - (Date.now() - recovery.ownerRecoveryStartedAt)
    expect(remainingDeadline).toBeGreaterThan(0)
    await vi.advanceTimersByTimeAsync(remainingDeadline)
    await recovery.removeFollower()

    ownerRebindGate.resolve()
    await vi.waitFor(() => expect(recovery.automaticJoin).toHaveBeenCalledOnce())
    const ownerJoin = recovery.automaticJoin.mock.results[0]?.value as Promise<unknown>
    const timeout = await ownerJoin.catch((error) => error)

    expect(timeout).toMatchObject({ message: 'Runtime current-domain recovery timed out' })
    expect(recovery.presenceStore.load).not.toHaveBeenCalled()
    expect(recovery.presenceStore.save).not.toHaveBeenCalled()
    expect(recovery.secondTransport.joinCalls).toHaveLength(0)
    expect(recovery.secondTransport.sendCalls).toHaveLength(0)
    expect(
      (await recovery.second.getSnapshot()).domains.find((item) => item.domain === domain)?.localSession
    ).toBeUndefined()

    followerRebindGate.resolve()
    await recovery.restoring
    await recovery.dispose()
  })

  it.each([
    ['site', otherDomain, null],
    [
      'durable local user',
      domain,
      {
        domain,
        lastJoinedAt: 1,
        local: {
          presenceId: 'retained-presence',
          userId: 'different-user',
          joinedAt: 1,
          status: 'active' as const
        },
        observers: []
      } satisfies PresenceDomainRecord
    ]
  ])(
    'does not let a second surviving Page rescue a restoring owner %s conflict',
    async (_kind, ownerSiteOrigin, stored) => {
      const recovery = await createTwoPageRecovery({ ownerSiteOrigin, stored })
      const action = recovery.owner.chat.sendMessage({ type: MESSAGE_TYPE.TEXT, body: 'must not rescue', mentions: [] })

      await Promise.resolve()
      expect(recovery.presenceStore.load).toHaveBeenCalledOnce()
      expect(recovery.presenceStore.save).not.toHaveBeenCalled()
      expect(recovery.secondTransport.joinCalls).toHaveLength(0)
      expect(recovery.secondTransport.sendCalls).toHaveLength(0)

      recovery.releaseOwnerLoad.resolve()
      await recovery.restoring
      await expect(action).rejects.toThrow('Runtime current-domain recovery identity is no longer current')
      expect(recovery.automaticJoin).toHaveBeenCalledTimes(2)
      expect(recovery.presenceStore.load).toHaveBeenCalledOnce()
      expect(recovery.presenceStore.save).not.toHaveBeenCalled()
      expect(recovery.secondTransport.joinCalls).toHaveLength(0)
      expect(recovery.secondTransport.sendCalls).toHaveLength(0)
      expect(
        (await recovery.second.getSnapshot()).domains.find((item) => item.domain === domain)?.localSession
      ).toBeUndefined()
      await recovery.dispose()
    }
  )

  it('waits for the real ChatRoom callback registration before the lease is ready', async () => {
    const sessionRegistration = deferred<void>()
    const fixture = createComposedReadiness({ sessionRegistration: sessionRegistration.promise })
    let settled = false
    const init = fixture.client.init().then(() => {
      settled = true
    })

    await vi.waitFor(() => {
      expect(fixture.server.onInbound).toHaveBeenCalledOnce()
      expect(fixture.server.onSessionEvent).toHaveBeenCalledOnce()
      expect(fixture.server.onError).toHaveBeenCalledOnce()
      expect(fixture.server.provideHistory).toHaveBeenCalledOnce()
      expect(fixture.server.onHistoryFeedback).toHaveBeenCalledOnce()
      expect(fixture.server.onWorldPresence).toHaveBeenCalledOnce()
    })
    expect(settled).toBe(false)

    sessionRegistration.resolve()
    await init
    expect(settled).toBe(true)
    fixture.chat.dispose()
    await fixture.database.close()
    fixture.client.detach()
  })

  it('waits for the real WorldRoom attachment before the lease is ready', async () => {
    const worldRegistration = deferred<void>()
    const fixture = createComposedReadiness({ worldRegistration: worldRegistration.promise })
    let settled = false
    const init = fixture.client.init().then(() => {
      settled = true
    })

    await vi.waitFor(() => expect(fixture.server.onWorldPresence).toHaveBeenCalledOnce())
    expect(settled).toBe(false)

    worldRegistration.resolve()
    await init
    expect(settled).toBe(true)
    fixture.chat.dispose()
    await fixture.database.close()
    fixture.client.detach()
  })

  it('propagates a real ChatRoom registration failure through the lease readiness barrier', async () => {
    const failure = new Error('ChatRoom Session registration failed')
    const fixture = createComposedReadiness({ inboundRegistration: Promise.reject(failure) })

    await expect(fixture.client.init()).rejects.toBe(failure)

    fixture.chat.dispose()
    await fixture.database.close()
    fixture.client.detach()
  })

  it('does not resolve a rebind until every asynchronous Page registration callback has settled', async () => {
    const registerPage = vi
      .fn<RuntimeCoordinator['registerPage']>()
      .mockResolvedValueOnce(registration('host-a'))
      .mockResolvedValueOnce(registration('host-b'))
    const callbacksStarted = deferred<void>()
    const releaseCallbacks = deferred<void>()
    let generation = 0
    let started = 0
    const client = new ClientLease({ coordinator: coordinatorWith(registerPage), pageId, domain })
    Array.from({ length: 5 }).forEach(() => {
      client.whenReady(() => {
        if (generation === 0) return
        started += 1
        if (started === 5) callbacksStarted.resolve()
        return releaseCallbacks.promise
      })
    })

    await client.init()
    generation = 1
    let settled = false
    const rebind = client.rebind().then(() => {
      settled = true
    })
    await callbacksStarted.promise
    expect(settled).toBe(false)
    expect(client.snapshot()).toMatchObject({ hostId: 'host-b' })

    releaseCallbacks.resolve()
    await rebind
    expect(settled).toBe(true)
    client.detach()
  })

  it('fails a rebind when an exact Page registration callback rejects', async () => {
    const registerPage = vi
      .fn<RuntimeCoordinator['registerPage']>()
      .mockResolvedValueOnce(registration('host-a'))
      .mockResolvedValueOnce(registration('host-b'))
    const failure = new Error('Session snapshot registration failed')
    let generation = 0
    const failures: Error[] = []
    const client = new ClientLease({ coordinator: coordinatorWith(registerPage), pageId, domain })
    client.whenReady(() => {
      if (generation > 0) throw failure
    })
    client.whenFailure((error) => failures.push(error))

    await client.init()
    generation = 1
    await expect(client.rebind()).rejects.toBe(failure)
    expect(failures).toContain(failure)
    client.detach()
  })

  it('keeps an unrelated timeout from replaying an admitted action', async () => {
    const registerPage = vi
      .fn<RuntimeCoordinator['registerPage']>()
      .mockResolvedValueOnce(registration())
      .mockImplementationOnce(() => new Promise<RuntimePageRegistration>(() => {}))
    const failures: string[] = []
    const client = new ClientLease({
      coordinator: coordinatorWith(registerPage),
      pageId,
      domain,
      startupTimeoutMs: 10,
      startupRetryIntervalMs: 1
    })
    client.whenFailure((error) => failures.push(error.message))

    await client.init()
    const refresh = client.checkNow()
    await vi.advanceTimersByTimeAsync(10)
    await refresh

    expect(registerPage).toHaveBeenCalledTimes(2)
    expect(failures).toEqual(['Runtime control-plane request timed out'])
    client.detach()
  })

  it('fences a stale explicit refresh after the Page detaches', async () => {
    let resolve!: (value: RuntimePageRegistration) => void
    const pending = new Promise<RuntimePageRegistration>((done) => {
      resolve = done
    })
    const registerPage = vi
      .fn<RuntimeCoordinator['registerPage']>()
      .mockResolvedValueOnce(registration())
      .mockReturnValueOnce(pending)
    const client = new ClientLease({ coordinator: coordinatorWith(registerPage), pageId, domain })

    await client.init()
    const refresh = client.checkNow()
    client.detach()
    resolve(registration('host-b'))
    await refresh

    expect(() => client.snapshot()).not.toThrow()
  })
})

const deferred = <T>() => {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((next, fail) => {
    resolve = next
    reject = fail
  })
  return { promise, resolve, reject }
}
