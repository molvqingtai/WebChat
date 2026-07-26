import { createRequire } from 'node:module'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { Remesh, type RemeshStore } from 'remesh'
import type { ComponentType, ReactNode } from 'react'
import AppStatusDomain from '@/domain/AppStatus'
import ChatRoomDomain from '@/domain/ChatRoom'
import UserInfoDomain, { type UserInfo } from '@/domain/UserInfo'
import { ChatRoomExtern, type ChatRoom } from '@/domain/externs/ChatRoom'
import { ReadinessExtern } from '@/domain/externs/Readiness'
import { BrowserSyncStorageExtern, LocalStorageExtern, type Storage, type StorageValue } from '@/domain/externs/Storage'
import { MessageDatabaseExtern } from '@/domain/MessageStore'

const require = createRequire(import.meta.url)
const wxtRequire = createRequire(require.resolve('wxt'))
const { parseHTML } = wxtRequire('linkedom') as {
  parseHTML: (html: string) => { window: Window & typeof globalThis; document: Document }
}
const { window, document } = parseHTML('<!doctype html><html><body><div id="root"></div></body></html>')
Object.defineProperty(window, 'location', { value: new URL('https://reconnect.test/'), configurable: true })
Object.defineProperty(document, 'location', { value: window.location, configurable: true })
window.matchMedia = () =>
  ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {}
  }) as unknown as MediaQueryList

let activeLoadingId: string | null = null
let frame = 0
let firstVisibleFrame: number | null = null
const requestAnimationFrame = (callback: FrameRequestCallback) =>
  setTimeout(() => {
    frame += 1
    if (activeLoadingId && document.body.textContent.includes('Reconnecting to the chat...')) {
      firstVisibleFrame ??= frame
    }
    callback(Date.now())
  }, 0) as unknown as number
const cancelAnimationFrame = (id: number) => clearTimeout(id)
window.requestAnimationFrame = requestAnimationFrame
window.cancelAnimationFrame = cancelAnimationFrame

const previousGlobals = new Map<string, PropertyDescriptor | undefined>()
for (const [name, value] of Object.entries({
  window,
  document,
  navigator: window.navigator,
  location: window.location,
  HTMLElement: window.HTMLElement,
  Element: window.Element,
  Node: window.Node,
  MutationObserver: window.MutationObserver,
  getComputedStyle: window.getComputedStyle?.bind(window) ?? (() => ({})),
  requestAnimationFrame,
  cancelAnimationFrame
})) {
  previousGlobals.set(name, Object.getOwnPropertyDescriptor(globalThis, name))
  Object.defineProperty(globalThis, name, { value, writable: true, configurable: true })
}

afterAll(async () => {
  await settle(100)
  for (const [name, descriptor] of previousGlobals) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor)
    else Reflect.deleteProperty(globalThis, name)
  }
})

const React = await import('react')
const { createRoot } = await import('react-dom/client')
const { RemeshRoot } = await import('remesh-react')
const TestRemeshRoot = RemeshRoot as ComponentType<{ store: RemeshStore; children?: ReactNode }>
const { toast } = await import('sonner')
const { PanelToaster, ReconnectToastLifecycle } = await import('./reconnect-toast')

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

const settle = (milliseconds = 25) => new Promise((resolve) => setTimeout(resolve, milliseconds))
const waitFor = async (predicate: () => boolean, timeout = 2000) => {
  const deadline = Date.now() + timeout
  while (!predicate() && Date.now() < deadline) await settle(10)
  expect(predicate()).toBe(true)
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
const feedbackIds = (requestId: number) => ({
  loading: `webchat-reconnect-${requestId}-loading`,
  error: `webchat-reconnect-${requestId}-error`
})

const createFixture = () => {
  const transaction = {
    get: async () => undefined,
    scan: async () => [],
    count: async () => 0,
    insert: async () => ({ inserted: true }) as const,
    put: async () => {},
    delete: async () => {},
    clear: async () => {}
  }
  const database = {
    read: async <Result>(_stores: readonly string[], operation: (value: never) => Promise<Result>) =>
      operation(transaction as never),
    write: async <Result>(_stores: readonly string[], operation: (value: never) => Promise<Result>) =>
      operation(transaction as never),
    watch: () => () => {},
    close: async () => {}
  }
  const browserStorage: Storage = {
    get: async <T extends StorageValue>() => SELF as T,
    set: async () => {},
    watch: async () => async () => {}
  }
  const localStorage: Storage = {
    get: async <T extends StorageValue>() => null as T,
    set: async () => {},
    watch: async () => async () => {}
  }
  let reconnectPort = () => Promise.resolve()
  const portSnapshots: { visible: boolean; painted: boolean }[] = []
  const chat: ChatRoom = {
    joinRoom: vi.fn(async () => {}),
    leaveRoom: vi.fn(() => {
      portSnapshots.push({
        visible: document.body.textContent.includes('Reconnecting to the chat...'),
        painted: firstVisibleFrame !== null && frame > firstVisibleFrame
      })
      return reconnectPort()
    }),
    sendMessage: vi.fn(async () => {
      throw new Error('not used')
    }),
    onMessage: () => () => {},
    onJoinRoom: () => () => {},
    onLeaveRoom: () => () => {},
    onSessions: () => () => {},
    onError: () => () => {}
  }
  const store = Remesh.store({
    externs: [
      ChatRoomExtern.impl(chat),
      ReadinessExtern.impl({ onState: () => () => {} }),
      MessageDatabaseExtern.impl(database),
      BrowserSyncStorageExtern.impl(browserStorage),
      LocalStorageExtern.impl(localStorage)
    ]
  })
  const appStatusAction = AppStatusDomain()
  const chatAction = ChatRoomDomain()
  const userAction = UserInfoDomain()
  const appStatus = store.getDomain(appStatusAction)
  const room = store.getDomain(chatAction)
  const user = store.getDomain(userAction)
  store.igniteDomain(appStatusAction)
  store.igniteDomain(chatAction)
  store.send(user.command.UpdateUserInfoCommand(SELF))

  return {
    store,
    appStatus,
    room,
    chat,
    portSnapshots,
    usePort: (port: () => Promise<void>) => {
      reconnectPort = port
    }
  }
}

describe('request-owned reconnect Sonner lifecycle', () => {
  it('commits before ports, restores one active loading, suppresses closed errors, and preserves unrelated Toasts', async () => {
    const fixture = createFixture()
    await waitFor(() => fixture.store.query(fixture.appStatus.query.StatusLoadIsFinishedQuery()))
    fixture.store.send(fixture.appStatus.command.UpdateOpenCommand(true))
    fixture.store.send(fixture.room.command.JoinRoomCommand())
    await waitFor(() => fixture.store.query(fixture.room.query.JoinIsFinishedQuery()))

    const operations: { type: 'dismiss' | 'error'; id: number | string | undefined }[] = []
    const dismiss = toast.dismiss
    const error = toast.error
    toast.dismiss = ((id?: number | string) => {
      operations.push({ type: 'dismiss', id })
      return dismiss(id)
    }) as typeof toast.dismiss
    toast.error = ((message, options) => {
      operations.push({ type: 'error', id: options?.id })
      return error(message, options)
    }) as typeof toast.error

    const root = createRoot(document.getElementById('root')!)
    let panelOpen = true
    const render = () =>
      root.render(
        React.createElement(
          TestRemeshRoot,
          { store: fixture.store },
          React.createElement(ReconnectToastLifecycle),
          panelOpen ? React.createElement(PanelToaster, { theme: 'light' }) : null
        )
      )
    const setPanelOpen = (open: boolean) => {
      panelOpen = open
      fixture.store.send(fixture.appStatus.command.UpdateOpenCommand(open))
      render()
    }
    render()
    await settle()

    const unrelatedId = 'review-unrelated-error'
    toast.error('Unrelated feedback', { id: unrelatedId, duration: Infinity, testId: unrelatedId })
    await waitFor(() => document.body.textContent.includes('Unrelated feedback'))

    fixture.store.send(fixture.room.command.ReconnectCommand())
    fixture.store.send(fixture.room.command.ReconnectCommand())
    let request = fixture.store.query(fixture.room.query.ReconnectRequestQuery())!
    activeLoadingId = feedbackIds(request.id).loading
    firstVisibleFrame = null
    await waitFor(() => fixture.portSnapshots.length === 1)
    expect(fixture.portSnapshots[0]).toEqual({ visible: true, painted: true })
    await waitFor(() => fixture.store.query(fixture.room.query.ReconnectRequestQuery()) === null)
    await settle(600)
    expect(vi.mocked(fixture.chat.leaveRoom)).toHaveBeenCalledOnce()
    expect(toast.getToasts().some(({ id }) => id === unrelatedId)).toBe(true)
    expect(document.body.textContent).toContain('Unrelated feedback')

    const active = deferred()
    fixture.usePort(() => active.promise)
    fixture.store.send(fixture.room.command.ReconnectCommand())
    request = fixture.store.query(fixture.room.query.ReconnectRequestQuery())!
    const activeFeedback = feedbackIds(request.id)
    activeLoadingId = activeFeedback.loading
    firstVisibleFrame = null
    await waitFor(() => fixture.portSnapshots.length === 2)
    await waitFor(() => document.body.textContent.includes('Reconnecting to the chat...'))

    setPanelOpen(false)
    await settle()
    expect(document.body.textContent).not.toContain('Reconnecting to the chat...')
    expect(toast.getToasts().some(({ id }) => id === activeFeedback.loading)).toBe(true)

    setPanelOpen(true)
    await waitFor(() => document.body.textContent.includes('Reconnecting to the chat...'))
    expect(document.querySelectorAll(`[data-testid="${activeFeedback.loading}"]`)).toHaveLength(1)
    expect(vi.mocked(fixture.chat.leaveRoom)).toHaveBeenCalledTimes(2)

    active.resolve()
    await waitFor(() => fixture.store.query(fixture.room.query.ReconnectRequestQuery()) === null)
    await settle(600)
    expect(toast.getToasts().some(({ id }) => id === activeFeedback.loading)).toBe(false)

    const closedFailure = deferred()
    fixture.usePort(() => closedFailure.promise)
    fixture.store.send(fixture.room.command.ReconnectCommand())
    request = fixture.store.query(fixture.room.query.ReconnectRequestQuery())!
    const closedFeedback = feedbackIds(request.id)
    activeLoadingId = closedFeedback.loading
    firstVisibleFrame = null
    await waitFor(() => fixture.portSnapshots.length === 3)

    panelOpen = false
    fixture.store.send(fixture.appStatus.command.UpdateOpenCommand(false))
    closedFailure.reject('closed reset')
    await waitFor(() => fixture.store.query(fixture.room.query.ReconnectRequestQuery()) === null)
    render()
    await settle()
    expect(toast.getToasts().some(({ id }) => id === closedFeedback.loading || id === closedFeedback.error)).toBe(false)

    setPanelOpen(true)
    await settle(100)
    expect(document.body.textContent).not.toContain('closed reset')
    expect(document.body.textContent).not.toContain('Reconnecting to the chat...')

    fixture.usePort(() => Promise.reject(new Error('open reset')))
    fixture.store.send(fixture.room.command.ReconnectCommand())
    request = fixture.store.query(fixture.room.query.ReconnectRequestQuery())!
    const openFailure = feedbackIds(request.id)
    activeLoadingId = openFailure.loading
    firstVisibleFrame = null
    await waitFor(() => document.body.textContent.includes('open reset'))
    expect(toast.getToasts().some(({ id }) => id === openFailure.loading)).toBe(false)
    expect(toast.getToasts().some(({ id }) => id === openFailure.error)).toBe(true)
    expect(operations.findIndex((item) => item.type === 'dismiss' && item.id === openFailure.loading)).toBeLessThan(
      operations.findIndex((item) => item.type === 'error' && item.id === openFailure.error)
    )
    expect(operations.some((item) => item.type === 'dismiss' && item.id === undefined)).toBe(false)
    expect(operations.some((item) => item.type === 'dismiss' && item.id === unrelatedId)).toBe(false)
    expect(toast.getToasts().some(({ id }) => id === unrelatedId)).toBe(true)

    setPanelOpen(false)
    await settle(600)
    expect(toast.getToasts().some(({ id }) => id === openFailure.error)).toBe(false)
    expect(toast.getToasts().some(({ id }) => id === unrelatedId)).toBe(true)
    setPanelOpen(true)
    await settle(100)
    expect(document.body.textContent).not.toContain('open reset')

    toast.dismiss(unrelatedId)
    root.unmount()
    await settle(600)
    fixture.store.discard()
    toast.dismiss = dismiss
    toast.error = error
    activeLoadingId = null
  })
})
