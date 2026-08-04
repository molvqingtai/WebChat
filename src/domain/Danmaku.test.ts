import { afterEach, describe, expect, it, vi } from 'vitest'
import { Remesh } from 'remesh'
import DanmakuDomain from '@/domain/Danmaku'
import UserInfoDomain, { type UserInfo } from '@/domain/UserInfo'
import { ChatRoomExtern, type ChatRoom } from '@/domain/externs/ChatRoom'
import { DanmakuExtern } from '@/domain/externs/Danmaku'
import { ReadinessExtern } from '@/domain/externs/Readiness'
import { BrowserSyncStorageExtern, type Storage, type StorageValue } from '@/domain/externs/Storage'
import { createMemoryMessageDatabase } from '@/domain/impls/database/Memory'
import { MessageDatabaseExtern } from '@/domain/MessageStore'
import { type ChatMessage, type ChatSession } from '@/protocol'

const USER_INFO: UserInfo = {
  id: 'local-user',
  name: 'Local',
  avatar: '',
  createTime: 1,
  themeMode: 'system',
  danmakuEnabled: true,
  notificationEnabled: true,
  notificationType: 'all'
}

const REMOTE = { id: 'remote-user', name: 'Remote', avatar: '' }
const MESSAGE = {
  type: 'text',
  id: 'message-1',
  hlc: { timestamp: 1, counter: 0 },
  userId: REMOTE.id,
  body: 'hello',
  mentions: []
} satisfies ChatMessage
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0))
let databaseId = 0

const createFixture = (danmakuEnabled: boolean) => {
  let user = { ...USER_INFO, danmakuEnabled }
  let documentIsVisible = true
  const push = vi.fn()
  const mount = vi.fn()
  const unmount = vi.fn()
  const storage: Storage = {
    get: async <T extends StorageValue>() => user as T,
    set: async () => {},
    watch: async () => async () => {}
  }
  const messageListeners = new Set<(message: ChatMessage) => void>()
  const sessionListeners = new Set<(sessions: readonly ChatSession[]) => void>()
  const subscribe = <T>(listeners: Set<(value: T) => void>, listener: (value: T) => void) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }
  const chatRoom: ChatRoom = {
    joinRoom: async () => {},
    leaveRoom: async () => {},
    sendMessage: async () => {
      throw new Error('not used')
    },
    onMessage: (listener) => subscribe(messageListeners, listener),
    onJoinRoom: () => () => {},
    onLeaveRoom: () => () => {},
    onSessions: (listener) => subscribe(sessionListeners, listener),
    onError: () => () => {}
  }
  const database = createMemoryMessageDatabase(`danmaku-domain-${databaseId++}`)
  const store = Remesh.store({
    externs: [
      DanmakuExtern.impl({ push, mount, unmount }),
      BrowserSyncStorageExtern.impl(storage),
      ChatRoomExtern.impl(chatRoom),
      ReadinessExtern.impl({ onState: () => () => {} }),
      MessageDatabaseExtern.impl(database)
    ]
  })
  const danmakuAction = DanmakuDomain()
  const danmaku = store.getDomain(danmakuAction)
  const userInfo = store.getDomain(UserInfoDomain())
  store.igniteDomain(danmakuAction)
  store.send(userInfo.command.UpdateUserInfoCommand(user))

  return {
    danmaku,
    push,
    mountExtern: mount,
    unmountExtern: unmount,
    mount: () =>
      store.send(
        danmaku.command.MountCommand({
          container: document.createElement('div'),
          onOpen: () => {},
          documentIsVisible: () => documentIsVisible
        })
      ),
    unmount: () => store.send(danmaku.command.UnmountCommand()),
    setDocumentIsVisible: (isVisible: boolean) => {
      documentIsVisible = isVisible
    },
    setDanmakuEnabled: (enabled: boolean) => {
      user = { ...user, danmakuEnabled: enabled }
      store.send(userInfo.command.UpdateUserInfoCommand(user))
    },
    emitMessage: (id: string) => {
      sessionListeners.forEach((listener) => listener([{ sessionId: 'remote-session', user: REMOTE }]))
      messageListeners.forEach((listener) => listener({ ...MESSAGE, id }))
    },
    dispose: async () => {
      store.discard()
      await database.close()
    }
  }
}

const fixtures: Array<ReturnType<typeof createFixture>> = []

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((fixture) => fixture.dispose()))
  vi.restoreAllMocks()
})

describe('DanmakuDomain consumer surface', () => {
  it('exposes only the mount lifecycle commands used by App', () => {
    const fixture = createFixture(true)
    fixtures.push(fixture)

    expect(Object.keys(fixture.danmaku)).toEqual(['command'])
    expect(Object.keys(fixture.danmaku.command).sort()).toEqual(['MountCommand', 'UnmountCommand'])
  })

  it('admits only messages delivered during a mounted presentation lifetime', async () => {
    const fixture = createFixture(true)
    fixtures.push(fixture)

    fixture.emitMessage('before-mount')
    await settle()
    expect(fixture.push).not.toHaveBeenCalled()

    fixture.mount()
    fixture.emitMessage('while-mounted')
    await settle()
    expect(fixture.push).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ id: 'while-mounted', userId: MESSAGE.userId, author: REMOTE })
    )

    fixture.unmount()
    fixture.emitMessage('while-unmounted')
    await settle()
    expect(fixture.push).toHaveBeenCalledTimes(1)

    fixture.mount()
    await settle()
    expect(fixture.push).toHaveBeenCalledTimes(1)

    fixture.emitMessage('after-remount')
    await settle()
    expect(fixture.push).toHaveBeenCalledTimes(2)
    expect(fixture.push).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: 'after-remount', userId: MESSAGE.userId, author: REMOTE })
    )
  })

  it('keeps same-domain document presentation lifetimes independent', async () => {
    const hiddenDocument = createFixture(true)
    const visibleDocument = createFixture(true)
    fixtures.push(hiddenDocument, visibleDocument)
    visibleDocument.mount()

    hiddenDocument.emitMessage('shared-message')
    visibleDocument.emitMessage('shared-message')
    await settle()

    expect(hiddenDocument.push).not.toHaveBeenCalled()
    expect(visibleDocument.push).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ id: 'shared-message', userId: MESSAGE.userId, author: REMOTE })
    )
  })

  it('rejects a delivery after visibility becomes ineligible but before passive lifecycle sync', async () => {
    const fixture = createFixture(true)
    fixtures.push(fixture)
    fixture.mount()
    fixture.mountExtern.mockClear()

    fixture.setDocumentIsVisible(false)
    fixture.emitMessage('hidden-before-effect')
    await settle()

    expect(fixture.unmountExtern).toHaveBeenCalledOnce()
    expect(fixture.push).not.toHaveBeenCalled()
  })

  it('admits a delivery after visibility becomes eligible but before passive lifecycle sync', async () => {
    const fixture = createFixture(true)
    fixtures.push(fixture)
    fixture.setDocumentIsVisible(false)
    fixture.mount()

    expect(fixture.mountExtern).not.toHaveBeenCalled()

    fixture.setDocumentIsVisible(true)
    fixture.emitMessage('visible-before-effect')
    await settle()

    expect(fixture.mountExtern).toHaveBeenCalledOnce()
    expect(fixture.push).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ id: 'visible-before-effect', userId: MESSAGE.userId, author: REMOTE })
    )
  })

  it('reconciles setting changes synchronously through the same delivery eligibility', async () => {
    const fixture = createFixture(true)
    fixtures.push(fixture)
    fixture.mount()
    fixture.mountExtern.mockClear()

    fixture.setDanmakuEnabled(false)
    expect(fixture.unmountExtern).toHaveBeenCalledOnce()

    fixture.emitMessage('disabled-before-effect')
    await settle()
    expect(fixture.push).not.toHaveBeenCalled()

    fixture.setDanmakuEnabled(true)
    expect(fixture.mountExtern).toHaveBeenCalledOnce()

    fixture.emitMessage('enabled-before-effect')
    await settle()
    expect(fixture.push).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ id: 'enabled-before-effect', userId: MESSAGE.userId, author: REMOTE })
    )
  })
})
