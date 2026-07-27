import { createRequire } from 'node:module'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { Remesh, type RemeshStore } from 'remesh'
import type { ComponentType, ReactNode } from 'react'
import AppFeedbackDomain from '@/domain/AppFeedback'
import ChatRoomDomain from '@/domain/ChatRoom'
import ToastPresentationDomain from '@/domain/ToastPresentation'
import UserInfoDomain, { type UserInfo } from '@/domain/UserInfo'
import { ChatRoomExtern, type ChatRoom } from '@/domain/externs/ChatRoom'
import { ReadinessExtern, type ReadinessState } from '@/domain/externs/Readiness'
import { BrowserSyncStorageExtern, LocalStorageExtern, type Storage, type StorageValue } from '@/domain/externs/Storage'
import { MessageDatabaseExtern } from '@/domain/MessageStore'

const require = createRequire(import.meta.url)
const wxtRequire = createRequire(require.resolve('wxt'))
const { parseHTML } = wxtRequire('linkedom') as {
  parseHTML: (html: string) => { window: Window & typeof globalThis; document: Document }
}
const { window, document } = parseHTML('<!doctype html><html><body><div id="root"></div></body></html>')
Object.defineProperty(window, 'location', { value: new URL('https://presentation.test/'), configurable: true })
Object.defineProperty(document, 'location', { value: window.location, configurable: true })
window.matchMedia = () =>
  ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {}
  }) as unknown as MediaQueryList

let activeDescriptorId: string | null = null
let firstVisibleAt: number | null = null
const requestAnimationFrame = (callback: FrameRequestCallback) =>
  setTimeout(() => {
    if (activeDescriptorId && document.querySelector(`[data-testid="${activeDescriptorId}"]`)) {
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

const React = await import('react')
const { createRoot } = await import('react-dom/client')
const { RemeshRoot } = await import('remesh-react')
const { Toaster, toast } = await import('sonner')
const { useToastPresentation } = await import('./toast-presentation')
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
  const promise = new Promise<void>((onResolve) => {
    resolve = onResolve
  })
  return { promise, resolve }
}

const descriptorId = (requestId: number) => `webchat-request-${requestId}`

const PresentationHarness = ({ mounted }: { mounted: boolean }) => {
  const toasterRef = useToastPresentation()
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
  const readinessListeners = new Set<(state: ReadinessState) => void>()
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
      ReadinessExtern.impl({
        onState: (listener) => {
          readinessListeners.add(listener)
          return () => readinessListeners.delete(listener)
        }
      }),
      MessageDatabaseExtern.impl(database),
      BrowserSyncStorageExtern.impl(browserStorage),
      LocalStorageExtern.impl(localStorage)
    ]
  })
  const chatAction = ChatRoomDomain()
  const feedbackAction = AppFeedbackDomain()
  const presentationAction = ToastPresentationDomain()
  const userAction = UserInfoDomain()
  const room = store.getDomain(chatAction)
  const presentation = store.getDomain(presentationAction)
  const user = store.getDomain(userAction)
  store.igniteDomain(chatAction)
  store.igniteDomain(feedbackAction)
  store.send(user.command.UpdateUserInfoCommand(SELF))

  return {
    store,
    room,
    presentation,
    chat,
    portSnapshots,
    emitReadiness: (state: ReadinessState) => readinessListeners.forEach((listener) => listener(state)),
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

describe('generic Toast presentation', () => {
  it('maps business sources while preserving immediate requests, bounded absence, and unrelated Toasts', async () => {
    const fixture = createFixture()
    const descriptorIds: string[] = []
    fixture.store.subscribeEvent(fixture.presentation.event.DescriptorEvent, ({ id }) => descriptorIds.push(id))
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
    let mounted = true
    const render = () =>
      root.render(
        React.createElement(
          React.StrictMode,
          null,
          React.createElement(
            TestRemeshRoot,
            { store: fixture.store },
            React.createElement(PresentationHarness, { mounted })
          )
        )
      )
    const setMounted = (value: boolean) => {
      mounted = value
      render()
    }
    render()
    await waitFor(() => fixture.store.query(fixture.presentation.query.SurfaceMountedQuery()))

    fixture.emitReadiness('unavailable')
    await waitFor(() => operations.some((item) => item.type === 'error' && item.id === 'webchat-runtime-readiness'))
    fixture.emitReadiness('ready')
    await waitFor(() => operations.some((item) => item.type === 'success' && item.id === 'webchat-runtime-readiness'))

    const unrelatedId = 'unrelated-feedback'
    toast.error('Unrelated feedback', { id: unrelatedId, duration: Infinity, testId: unrelatedId })
    await waitFor(() => document.body.textContent.includes('Unrelated feedback'))

    activeDescriptorId = null
    firstVisibleAt = null
    fixture.store.send(fixture.room.command.ReconnectCommand())
    fixture.store.send(fixture.room.command.ReconnectCommand())
    let request = fixture.store.query(fixture.room.query.ReconnectRequestQuery())!
    activeDescriptorId = descriptorId(request.id)
    await waitFor(() => fixture.portSnapshots.length === 1)
    expect(fixture.portSnapshots[0].visible).toBe(false)
    await waitFor(() =>
      Boolean(document.querySelector(`[data-testid="${activeDescriptorId}"][data-mounted="true"][data-visible="true"]`))
    )
    await waitFor(() => fixture.store.query(fixture.room.query.ReconnectRequestQuery()) === null)
    await waitFor(
      () =>
        document.querySelector(`[data-testid="${activeDescriptorId}"]`)?.textContent?.includes('Ready to chat') === true
    )
    const successOperation = operations.find((item) => item.type === 'success' && item.id === activeDescriptorId)!
    expect(firstVisibleAt).not.toBeNull()
    expect(successOperation.at - firstVisibleAt!).toBeGreaterThanOrEqual(290)
    expect(vi.mocked(fixture.chat.leaveRoom)).toHaveBeenCalledOnce()
    expect(toast.getToasts().some(({ id }) => id === unrelatedId)).toBe(true)

    const closeDuringPresentation = deferred()
    fixture.usePort(() => closeDuringPresentation.promise)
    activeDescriptorId = null
    firstVisibleAt = null
    fixture.store.send(fixture.room.command.ReconnectCommand())
    request = fixture.store.query(fixture.room.query.ReconnectRequestQuery())!
    activeDescriptorId = descriptorId(request.id)
    await waitFor(() => fixture.portSnapshots.length === 2)
    await waitFor(() => document.querySelector(`[data-testid="${activeDescriptorId}"]`) !== null)
    await waitFor(() => {
      const active = fixture.store.query(fixture.room.query.ReconnectRequestQuery())
      return active?.toast.attempted === true && active.toast.settled === true
    })
    const descriptorCountBeforeUnmount = descriptorIds.filter((id) => id === activeDescriptorId).length

    setMounted(false)
    await waitFor(() => document.querySelector(`[data-testid="${activeDescriptorId}"]`) === null)
    await waitFor(() => !fixture.store.query(fixture.presentation.query.SurfaceMountedQuery()))
    expect(fixture.store.query(fixture.room.query.ReconnectRequestQuery())?.id).toBe(request.id)
    expect(fixture.store.query(fixture.room.query.ReconnectIsLoadingQuery())).toBe(true)

    setMounted(true)
    await waitFor(() => document.querySelector(`[data-testid="${activeDescriptorId}"]`) !== null)
    await waitFor(
      () => descriptorIds.filter((id) => id === activeDescriptorId).length === descriptorCountBeforeUnmount + 1
    )
    const descriptorCountAfterReplay = descriptorIds.filter((id) => id === activeDescriptorId).length
    expect(fixture.store.query(fixture.room.query.ReconnectRequestQuery())?.id).toBe(request.id)
    expect(fixture.store.query(fixture.room.query.ReconnectIsLoadingQuery())).toBe(true)
    expect(vi.mocked(fixture.chat.leaveRoom)).toHaveBeenCalledTimes(2)

    setMounted(true)
    await settle(50)
    expect(descriptorIds.filter((id) => id === activeDescriptorId)).toHaveLength(descriptorCountAfterReplay)

    closeDuringPresentation.resolve()
    await waitFor(() => fixture.store.query(fixture.room.query.ReconnectRequestQuery()) === null)
    await waitFor(
      () =>
        document.querySelector(`[data-testid="${activeDescriptorId}"]`)?.textContent?.includes('Ready to chat') === true
    )

    const openDuringActive = deferred()
    fixture.usePort(() => openDuringActive.promise)
    setMounted(false)
    activeDescriptorId = null
    firstVisibleAt = null
    fixture.store.send(fixture.room.command.ReconnectCommand())
    request = fixture.store.query(fixture.room.query.ReconnectRequestQuery())!
    activeDescriptorId = descriptorId(request.id)
    await waitFor(() => fixture.portSnapshots.length === 3)
    await waitFor(() => {
      const active = fixture.store.query(fixture.room.query.ReconnectRequestQuery())
      return active?.toast.settled === true && active.toast.attempted === false
    })
    expect(document.querySelector(`[data-testid="${activeDescriptorId}"]`)).toBeNull()

    setMounted(true)
    await waitFor(() => document.querySelector(`[data-testid="${activeDescriptorId}"]`) !== null)
    expect(vi.mocked(fixture.chat.leaveRoom)).toHaveBeenCalledTimes(3)
    openDuringActive.resolve()
    await waitFor(() => fixture.store.query(fixture.room.query.ReconnectRequestQuery()) === null)

    setMounted(false)
    fixture.usePort(() => Promise.reject(new Error('closed reset')))
    fixture.store.send(fixture.room.command.ReconnectCommand())
    request = fixture.store.query(fixture.room.query.ReconnectRequestQuery())!
    const omittedId = descriptorId(request.id)
    await waitFor(() => fixture.store.query(fixture.room.query.ReconnectRequestQuery()) === null)
    setMounted(true)
    await settle(100)
    expect(document.querySelector(`[data-testid="${omittedId}"]`)).toBeNull()
    expect(descriptorIds).not.toContain(omittedId)
    expect(document.body.textContent).not.toContain('closed reset')

    fixture.usePort(() => Promise.reject(new Error('open reset')))
    activeDescriptorId = null
    firstVisibleAt = null
    fixture.store.send(fixture.room.command.ReconnectCommand())
    request = fixture.store.query(fixture.room.query.ReconnectRequestQuery())!
    activeDescriptorId = descriptorId(request.id)
    await waitFor(
      () =>
        document.querySelector(`[data-testid="${activeDescriptorId}"]`)?.textContent?.includes('open reset') === true
    )
    expect(fixture.store.query(fixture.room.query.ReconnectRequestQuery())).toBeNull()
    expect(operations.some((item) => item.type === 'error' && item.id === activeDescriptorId)).toBe(true)
    expect(operations.some((item) => item.type === 'dismiss' && item.id === undefined)).toBe(false)
    expect(operations.some((item) => item.type === 'dismiss' && item.id === unrelatedId)).toBe(false)
    expect(toast.getToasts().some(({ id }) => id === unrelatedId)).toBe(true)

    setMounted(false)
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
    activeDescriptorId = null
  }, 10000)
})
