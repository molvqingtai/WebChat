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
import { MESSAGE_TYPE, type ChatUser } from '@/protocol'
import type { RoomTransport } from '@/runtime/RoomTransport'
import { createServer, disposeServer, getChatRoomId, restoreServerPageBindings } from '@/runtime/Server'
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

const createRecoveryTransport = (holdJoin?: Promise<void>) => {
  const joined = new Set<string>()
  const joinCalls: string[] = []
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
      joined.add(roomId)
    },
    leave: (roomId) => {
      joined.delete(roomId)
    },
    send: async (roomId) => {
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
  return { joinCalls, transport }
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
