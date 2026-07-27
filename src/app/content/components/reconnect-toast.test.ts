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

let activeFeedbackId: string | null = null
let firstVisibleAt: number | null = null
const requestAnimationFrame = (callback: FrameRequestCallback) =>
  setTimeout(() => {
    if (activeFeedbackId && document.querySelector(`[data-testid="${activeFeedbackId}"]`)) {
      firstVisibleAt ??= Date.now()
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

const settle = (milliseconds = 25) => new Promise((resolve) => setTimeout(resolve, milliseconds))

// React and Sonner must observe the linkedom globals installed above.
const React = await import('react')
const { createRoot } = await import('react-dom/client')
const { RemeshRoot } = await import('remesh-react')
const { Toaster, toast } = await import('sonner')
const { useReconnectToast } = await import('./reconnect-toast')
const TestRemeshRoot = RemeshRoot as ComponentType<{ store: RemeshStore; children?: ReactNode }>

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

const feedbackId = (requestId: number) => `webchat-reconnect-${requestId}`

const FeedbackHarness = ({ mounted }: { mounted: boolean }) => {
  const toasterRef = useReconnectToast()
  if (!mounted) return null
  return React.createElement(Toaster, {
    ref: toasterRef,
    richColors: true,
    theme: 'light',
    offset: '70px',
    visibleToasts: 1,
    toastOptions: {
      classNames: {
        toast: 'dark:bg-slate-950 border dark:border-slate-600'
      }
    },
    position: 'top-center'
  })
}

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
  const portSnapshots: { visible: boolean; startedAt: number }[] = []
  const chat: ChatRoom = {
    joinRoom: vi.fn(async () => {}),
    leaveRoom: vi.fn(() => {
      portSnapshots.push({
        visible: document.body.textContent.includes('Reconnecting to the chat...'),
        startedAt: Date.now()
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

afterAll(async () => {
  await settle(100)
  for (const [name, descriptor] of previousGlobals) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor)
    else Reflect.deleteProperty(globalThis, name)
  }
})

describe('request-owned reconnect flow on the original Toaster', () => {
  it('starts transport before Toast, handles panel mount changes, and preserves unrelated feedback', async () => {
    const fixture = createFixture()
    await waitFor(() => fixture.store.query(fixture.appStatus.query.StatusLoadIsFinishedQuery()))
    fixture.store.send(fixture.appStatus.command.UpdateOpenCommand(true))
    fixture.store.send(fixture.room.command.JoinRoomCommand())
    await waitFor(() => fixture.store.query(fixture.room.query.JoinIsFinishedQuery()))

    const operations: {
      type: 'loading' | 'success' | 'error' | 'dismiss'
      id: number | string | undefined
      at: number
    }[] = []
    const loading = toast.loading
    const success = toast.success
    const error = toast.error
    const dismiss = toast.dismiss
    toast.loading = ((message, options) => {
      operations.push({ type: 'loading', id: options?.id, at: Date.now() })
      return loading(message, options)
    }) as typeof toast.loading
    toast.success = ((message, options) => {
      operations.push({ type: 'success', id: options?.id, at: Date.now() })
      return success(message, options)
    }) as typeof toast.success
    toast.error = ((message, options) => {
      operations.push({ type: 'error', id: options?.id, at: Date.now() })
      return error(message, options)
    }) as typeof toast.error
    toast.dismiss = ((id?: number | string) => {
      operations.push({ type: 'dismiss', id, at: Date.now() })
      return dismiss(id)
    }) as typeof toast.dismiss

    const root = createRoot(document.getElementById('root')!)
    let panelMounted = true
    let toasterMounted = true
    const render = () =>
      root.render(
        React.createElement(
          TestRemeshRoot,
          { store: fixture.store },
          React.createElement(FeedbackHarness, { mounted: panelMounted && toasterMounted })
        )
      )
    const setPanelOpen = (open: boolean) => {
      panelMounted = open
      fixture.store.send(fixture.appStatus.command.UpdateOpenCommand(open))
      render()
    }
    render()
    await settle()

    const unrelatedId = 'unrelated-feedback'
    toast.error('Unrelated feedback', { id: unrelatedId, duration: Infinity, testId: unrelatedId })
    await waitFor(() => document.body.textContent.includes('Unrelated feedback'))

    activeFeedbackId = null
    firstVisibleAt = null
    fixture.store.send(fixture.room.command.ReconnectCommand())
    fixture.store.send(fixture.room.command.ReconnectCommand())
    let request = fixture.store.query(fixture.room.query.ReconnectRequestQuery())!
    activeFeedbackId = feedbackId(request.id)
    await waitFor(() => fixture.portSnapshots.length === 1)
    expect(fixture.portSnapshots[0].visible).toBe(false)
    await waitFor(() =>
      Boolean(document.querySelector(`[data-testid="${activeFeedbackId}"][data-mounted="true"][data-visible="true"]`))
    )
    const loadingItem = document.querySelector<HTMLElement>(`[data-testid="${activeFeedbackId}"]`)!
    expect(loadingItem.getAttribute('data-mounted')).toBe('true')
    expect(loadingItem.getAttribute('data-visible')).toBe('true')
    await waitFor(() => fixture.store.query(fixture.room.query.ReconnectRequestQuery()) === null)
    await waitFor(
      () =>
        document.querySelector(`[data-testid="${activeFeedbackId}"]`)?.textContent?.includes('Ready to chat') === true
    )
    const successOperation = operations.find((item) => item.type === 'success' && item.id === activeFeedbackId)!
    expect(firstVisibleAt).not.toBeNull()
    expect(successOperation.at - firstVisibleAt!).toBeGreaterThanOrEqual(290)
    expect(vi.mocked(fixture.chat.leaveRoom)).toHaveBeenCalledOnce()
    expect(toast.getToasts().some(({ id }) => id === unrelatedId)).toBe(true)

    const closeDuringFeedback = deferred()
    fixture.usePort(() => closeDuringFeedback.promise)
    activeFeedbackId = null
    firstVisibleAt = null
    fixture.store.send(fixture.room.command.ReconnectCommand())
    request = fixture.store.query(fixture.room.query.ReconnectRequestQuery())!
    activeFeedbackId = feedbackId(request.id)
    await waitFor(() => fixture.portSnapshots.length === 2)
    expect(fixture.portSnapshots[1].visible).toBe(false)
    await waitFor(() => document.querySelector(`[data-testid="${activeFeedbackId}"]`) !== null)

    setPanelOpen(false)
    await waitFor(() => document.querySelector(`[data-testid="${activeFeedbackId}"]`) === null)
    await waitFor(() => fixture.store.query(fixture.room.query.ReconnectRequestQuery())?.feedback.phase === 'complete')
    setPanelOpen(true)
    await settle(100)
    expect(document.querySelector(`[data-testid="${activeFeedbackId}"]`)).toBeNull()
    expect(vi.mocked(fixture.chat.leaveRoom)).toHaveBeenCalledTimes(2)

    closeDuringFeedback.resolve()
    await waitFor(() => fixture.store.query(fixture.room.query.ReconnectRequestQuery()) === null)
    await waitFor(
      () =>
        document.querySelector(`[data-testid="${activeFeedbackId}"]`)?.textContent?.includes('Ready to chat') === true
    )

    const openDuringActive = deferred()
    fixture.usePort(() => openDuringActive.promise)
    setPanelOpen(false)
    activeFeedbackId = null
    firstVisibleAt = null
    fixture.store.send(fixture.room.command.ReconnectCommand())
    request = fixture.store.query(fixture.room.query.ReconnectRequestQuery())!
    activeFeedbackId = feedbackId(request.id)
    await waitFor(() => fixture.portSnapshots.length === 3)
    expect(fixture.portSnapshots[2].visible).toBe(false)
    await waitFor(
      () =>
        fixture.store.query(fixture.room.query.ReconnectRequestQuery())?.feedback.phase === 'complete' &&
        fixture.store.query(fixture.room.query.ReconnectRequestQuery())?.feedback.attempted === false
    )
    expect(document.querySelector(`[data-testid="${activeFeedbackId}"]`)).toBeNull()

    setPanelOpen(true)
    await waitFor(() => document.querySelector(`[data-testid="${activeFeedbackId}"]`) !== null)
    expect(vi.mocked(fixture.chat.leaveRoom)).toHaveBeenCalledTimes(3)
    openDuringActive.resolve()
    await waitFor(() => fixture.store.query(fixture.room.query.ReconnectRequestQuery()) === null)
    await waitFor(
      () =>
        document.querySelector(`[data-testid="${activeFeedbackId}"]`)?.textContent?.includes('Ready to chat') === true
    )

    setPanelOpen(false)
    fixture.usePort(() => Promise.reject(new Error('closed reset')))
    fixture.store.send(fixture.room.command.ReconnectCommand())
    request = fixture.store.query(fixture.room.query.ReconnectRequestQuery())!
    const closedFeedbackId = feedbackId(request.id)
    await waitFor(() => fixture.store.query(fixture.room.query.ReconnectRequestQuery()) === null)
    setPanelOpen(true)
    await settle(100)
    expect(document.querySelector(`[data-testid="${closedFeedbackId}"]`)).toBeNull()
    expect(document.body.textContent).not.toContain('closed reset')

    fixture.usePort(() => Promise.reject(new Error('open reset')))
    activeFeedbackId = null
    firstVisibleAt = null
    fixture.store.send(fixture.room.command.ReconnectCommand())
    request = fixture.store.query(fixture.room.query.ReconnectRequestQuery())!
    activeFeedbackId = feedbackId(request.id)
    await waitFor(
      () => document.querySelector(`[data-testid="${activeFeedbackId}"]`)?.textContent?.includes('open reset') === true
    )
    expect(fixture.store.query(fixture.room.query.ReconnectRequestQuery())).toBeNull()
    expect(operations.some((item) => item.type === 'error' && item.id === activeFeedbackId)).toBe(true)
    expect(operations.some((item) => item.type === 'dismiss' && item.id === undefined)).toBe(false)
    expect(operations.some((item) => item.type === 'dismiss' && item.id === unrelatedId)).toBe(false)
    expect(toast.getToasts().some(({ id }) => id === unrelatedId)).toBe(true)

    toasterMounted = false
    render()
    await settle()
    fixture.usePort(() => Promise.resolve())
    const absentStartedAt = Date.now()
    fixture.store.send(fixture.room.command.ReconnectCommand())
    await waitFor(() => fixture.store.query(fixture.room.query.ReconnectRequestQuery()) === null)
    expect(Date.now() - absentStartedAt).toBeLessThan(1000)
    expect(document.body.textContent).not.toContain('Reconnecting to the chat...')

    toast.dismiss(unrelatedId)
    root.unmount()
    await settle(600)
    fixture.store.discard()
    toast.loading = loading
    toast.success = success
    toast.error = error
    toast.dismiss = dismiss
    activeFeedbackId = null
  }, 10000)
})
