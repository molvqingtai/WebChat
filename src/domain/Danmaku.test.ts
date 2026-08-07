import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Remesh } from 'remesh'
import DanmakuDomain from '@/domain/Danmaku'
import UserInfoDomain, { type UserInfo } from '@/domain/UserInfo'
import { ChatRoomExtern, type ChatRoom } from '@/domain/externs/ChatRoom'
import { DanmakuExtern } from '@/domain/externs/Danmaku'
import { ReadinessExtern } from '@/domain/externs/Readiness'
import { BrowserSyncStorageExtern, type Storage, type StorageValue } from '@/domain/externs/Storage'
import { createMemoryMessageDatabase } from '@/domain/impls/database/Memory'
import { SendLifecycleExtern } from '@/domain/externs/SendLifecycle'
import { createSendLifecycle } from '@/domain/impls/SendLifecycle'
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
let documentVisibilityState: DocumentVisibilityState = 'visible'

const createFixture = (danmakuEnabled: boolean) => {
  let user = { ...USER_INFO, danmakuEnabled }
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
      SendLifecycleExtern.impl(createSendLifecycle()),
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
          onOpen: () => {}
        })
      ),
    unmount: () => store.send(danmaku.command.UnmountCommand()),
    setDocumentIsVisible: (isVisible: boolean) => {
      documentVisibilityState = isVisible ? 'visible' : 'hidden'
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

beforeEach(() => {
  documentVisibilityState = 'visible'
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => documentVisibilityState)
})

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

  it('keeps same-domain document admissions independent without changing either lifecycle', async () => {
    const hiddenDocument = createFixture(true)
    const visibleDocument = createFixture(true)
    fixtures.push(hiddenDocument, visibleDocument)
    hiddenDocument.mount()
    visibleDocument.mount()
    hiddenDocument.setDocumentIsVisible(false)

    hiddenDocument.emitMessage('shared-message')
    await settle()

    visibleDocument.setDocumentIsVisible(true)
    visibleDocument.emitMessage('shared-message')
    await settle()

    expect(hiddenDocument.push).not.toHaveBeenCalled()
    expect(visibleDocument.push).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ id: 'shared-message', userId: MESSAGE.userId, author: REMOTE })
    )
    expect(hiddenDocument.mountExtern).toHaveBeenCalledOnce()
    expect(hiddenDocument.unmountExtern).not.toHaveBeenCalled()
    expect(visibleDocument.mountExtern).toHaveBeenCalledOnce()
    expect(visibleDocument.unmountExtern).not.toHaveBeenCalled()
  })

  it('gates only new admissions while preserving the mounted lifetime across visibility changes', async () => {
    const fixture = createFixture(true)
    fixtures.push(fixture)
    fixture.mount()

    fixture.emitMessage('visible-before-switch')
    await settle()
    expect(fixture.push).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ id: 'visible-before-switch', userId: MESSAGE.userId, author: REMOTE })
    )

    fixture.setDocumentIsVisible(false)
    fixture.emitMessage('hidden-delivery')
    await settle()

    fixture.setDocumentIsVisible(true)
    expect(fixture.push).toHaveBeenCalledTimes(1)
    fixture.emitMessage('visible-after-switch')
    await settle()

    expect(fixture.mountExtern).toHaveBeenCalledOnce()
    expect(fixture.unmountExtern).not.toHaveBeenCalled()
    expect(fixture.push).toHaveBeenCalledTimes(2)
    expect(fixture.push).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: 'visible-after-switch', userId: MESSAGE.userId, author: REMOTE })
    )
  })

  it('keeps setting eligibility at admission without creating a second lifecycle owner', async () => {
    const fixture = createFixture(true)
    fixtures.push(fixture)
    fixture.mount()

    fixture.setDanmakuEnabled(false)
    expect(fixture.mountExtern).toHaveBeenCalledOnce()
    expect(fixture.unmountExtern).not.toHaveBeenCalled()

    fixture.emitMessage('disabled-delivery')
    await settle()
    expect(fixture.push).not.toHaveBeenCalled()

    fixture.setDanmakuEnabled(true)
    expect(fixture.mountExtern).toHaveBeenCalledOnce()
    expect(fixture.unmountExtern).not.toHaveBeenCalled()

    fixture.emitMessage('enabled-delivery')
    await settle()
    expect(fixture.push).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ id: 'enabled-delivery', userId: MESSAGE.userId, author: REMOTE })
    )
  })
})
