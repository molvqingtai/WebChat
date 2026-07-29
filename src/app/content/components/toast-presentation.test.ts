import { createRequire } from 'node:module'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { Remesh, type RemeshStore } from 'remesh'
import type { ComponentType, ReactNode } from 'react'
import AppFeedbackDomain from '@/domain/AppFeedback'
import ChatRoomDomain from '@/domain/ChatRoom'
import ToastDomain from '@/domain/Toast'
import ToastPresentationDomain, { type ToastDescriptor } from '@/domain/ToastPresentation'
import UserInfoDomain, { type UserInfo } from '@/domain/UserInfo'
import { ChatRoomExtern, type ChatRoom } from '@/domain/externs/ChatRoom'
import { ReadinessExtern, type ReadinessState } from '@/domain/externs/Readiness'
import { BrowserSyncStorageExtern, LocalStorageExtern, type Storage, type StorageValue } from '@/domain/externs/Storage'
import { ToastExtern } from '@/domain/externs/Toast'
import { WorldRoomExtern } from '@/domain/externs/WorldRoom'
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
  let reject!: (reason?: unknown) => void
  const promise = new Promise<void>((onResolve, onReject) => {
    resolve = onResolve
    reject = onReject
  })
  return { promise, resolve, reject }
}

const RUNTIME_TOAST_ID = 'webchat-runtime-readiness'

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
  const legacyLoading = vi.fn(() => 'legacy-loading')
  const legacyError = vi.fn(() => 'legacy-error')
  const portSnapshots: { visible: boolean; startedAt: number }[] = []
  const chat: ChatRoom = {
    joinRoom: vi.fn(async () => {}),
    leaveRoom: vi.fn(() => {
      portSnapshots.push({
        visible: document.body.textContent.includes('Connected to the chat.'),
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
          listener('ready')
          return () => readinessListeners.delete(listener)
        }
      }),
      MessageDatabaseExtern.impl(database),
      BrowserSyncStorageExtern.impl(browserStorage),
      LocalStorageExtern.impl(localStorage),
      ToastExtern.impl({
        success: vi.fn(() => 'success'),
        error: legacyError,
        info: vi.fn(() => 'info'),
        warning: vi.fn(() => 'warning'),
        loading: legacyLoading,
        cancel: vi.fn(() => 'cancelled')
      }),
      WorldRoomExtern.impl({
        getState: async () => [],
        onState: () => () => {},
        onError: () => () => {}
      })
    ]
  })
  const chatAction = ChatRoomDomain()
  const feedbackAction = AppFeedbackDomain()
  const toastAction = ToastDomain()
  const presentationAction = ToastPresentationDomain()
  const userAction = UserInfoDomain()
  const room = store.getDomain(chatAction)
  const presentation = store.getDomain(presentationAction)
  const user = store.getDomain(userAction)
  store.igniteDomain(chatAction)
  store.igniteDomain(feedbackAction)
  store.igniteDomain(toastAction)
  store.send(user.command.UpdateUserInfoCommand(SELF))

  return {
    store,
    room,
    presentation,
    chat,
    legacyLoading,
    legacyError,
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
  it('uses one fixed connection owner for direct and manual loading', async () => {
    const fixture = createFixture()
    const descriptors: ToastDescriptor[] = []
    const dismissals: string[] = []
    fixture.store.subscribeEvent(fixture.presentation.event.DescriptorEvent, (descriptor) =>
      descriptors.push(descriptor)
    )
    fixture.store.subscribeEvent(fixture.presentation.event.DismissEvent, (id) => dismissals.push(id))
    fixture.store.send(fixture.presentation.command.SetSurfaceMountedCommand(true))

    const joining = deferred()
    vi.mocked(fixture.chat.joinRoom).mockReturnValueOnce(joining.promise)
    fixture.store.send(fixture.room.command.JoinRoomCommand())
    await waitFor(() => descriptors.some(({ type }) => type === 'loading'))
    const directLoading = descriptors.find(({ type }) => type === 'loading')
    expect.soft(directLoading).toMatchObject({
      id: RUNTIME_TOAST_ID,
      type: 'loading',
      message: 'Connected to the chat.'
    })

    joining.resolve()
    await waitFor(() => fixture.store.query(fixture.room.query.JoinIsFinishedQuery()))
    await waitFor(() => dismissals.includes(RUNTIME_TOAST_ID))
    expect.soft(fixture.legacyLoading).not.toHaveBeenCalled()

    const reconnecting = deferred()
    fixture.usePort(() => reconnecting.promise)
    const descriptorCount = descriptors.length
    fixture.store.send(fixture.room.command.ReconnectCommand())
    await waitFor(() => descriptors.length > descriptorCount)
    const manualLoading = descriptors.slice(descriptorCount).find(({ type }) => type === 'loading')
    expect.soft(manualLoading).toMatchObject({
      id: RUNTIME_TOAST_ID,
      type: 'loading',
      message: 'Connected to the chat.'
    })
    expect.soft(descriptors.some(({ message }) => message === 'Reconnecting to the chat...')).toBe(false)
    expect(fixture.store.query(fixture.room.query.ConnectionIsLoadingQuery())).toBe(true)
    expect(fixture.store.query(fixture.room.query.ReconnectAvailableQuery())).toBe(false)

    reconnecting.resolve()
    fixture.store.discard()
  })

  it('publishes only the fixed generic error for a final connection failure', async () => {
    const fixture = createFixture()
    const descriptors: ToastDescriptor[] = []
    fixture.store.subscribeEvent(fixture.presentation.event.DescriptorEvent, (descriptor) =>
      descriptors.push(descriptor)
    )
    fixture.store.send(fixture.presentation.command.SetSurfaceMountedCommand(true))
    const joining = deferred()
    vi.mocked(fixture.chat.joinRoom).mockReturnValueOnce(joining.promise)

    fixture.store.send(fixture.room.command.JoinRoomCommand())
    await waitFor(() => descriptors.some(({ type }) => type === 'loading'))
    fixture.emitReadiness('unavailable')
    joining.reject(new Error('provider detail'))
    await waitFor(() => !fixture.store.query(fixture.room.query.ConnectionOperationIsLoadingQuery()))
    await settle(50)

    expect.soft(descriptors.find(({ type }) => type === 'loading')).toMatchObject({
      id: RUNTIME_TOAST_ID,
      message: 'Connected to the chat.'
    })
    expect.soft(descriptors.filter(({ type }) => type === 'error')).toEqual([
      {
        id: RUNTIME_TOAST_ID,
        type: 'error',
        message: 'Connection failed'
      }
    ])
    expect.soft(fixture.legacyError).not.toHaveBeenCalled()
    fixture.store.discard()
  })

  it('maps business sources while preserving immediate requests, bounded absence, and unrelated Toasts', async () => {
    const fixture = createFixture()
    const descriptorIds: string[] = []
    const descriptors: ToastDescriptor[] = []
    fixture.store.subscribeEvent(fixture.presentation.event.DescriptorEvent, (descriptor) => {
      descriptorIds.push(descriptor.id)
      descriptors.push(descriptor)
    })
    fixture.store.send(fixture.room.command.JoinRoomCommand())
    await waitFor(() => fixture.store.query(fixture.room.query.JoinIsFinishedQuery()))
    expect(fixture.legacyLoading).not.toHaveBeenCalled()

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
    const waitForSurfaceAbsent = async () => {
      await waitFor(() => document.querySelector('[data-sonner-toaster]') === null)
      await waitFor(() => !fixture.store.query(fixture.presentation.query.SurfaceMountedQuery()))
    }
    render()
    await waitFor(() => fixture.store.query(fixture.presentation.query.SurfaceMountedQuery()))

    fixture.emitReadiness('unavailable')
    await waitFor(() => operations.some((item) => item.type === 'error' && item.id === 'webchat-runtime-readiness'))

    const unrelatedId = 'unrelated-feedback'
    toast.error('Unrelated feedback', { id: unrelatedId, duration: Infinity, testId: unrelatedId })
    await waitFor(() => document.body.textContent.includes('Unrelated feedback'))

    const unavailableDescriptorCount = descriptors.filter(({ id }) => id === 'webchat-runtime-readiness').length
    fixture.emitReadiness('ready')
    await waitFor(() => vi.mocked(fixture.chat.joinRoom).mock.calls.length === 2)
    await waitFor(() => operations.some((item) => item.type === 'dismiss' && item.id === 'webchat-runtime-readiness'))
    await settle(50)
    const runtimeDescriptors = descriptors.filter(({ id }) => id === 'webchat-runtime-readiness')
    expect(operations.some((item) => item.type === 'success' && item.id === 'webchat-runtime-readiness')).toBe(false)
    expect(runtimeDescriptors.length).toBeGreaterThan(unavailableDescriptorCount)
    expect(runtimeDescriptors.slice(unavailableDescriptorCount).every(({ type }) => type === 'loading')).toBe(true)
    expect(
      runtimeDescriptors
        .filter(({ type }) => type === 'loading')
        .every(({ message }) => message === 'Connected to the chat.')
    ).toBe(true)
    expect(
      descriptors.some(
        ({ id, type, message }) =>
          id === 'webchat-runtime-readiness' && (type === 'success' || message === 'Ready to chat')
      )
    ).toBe(false)
    expect(toast.getToasts().some(({ id }) => id === unrelatedId)).toBe(true)

    const runtimeDescriptorCount = runtimeDescriptors.length
    const runtimeDismissCount = operations.filter(
      (item) => item.type === 'dismiss' && item.id === 'webchat-runtime-readiness'
    ).length
    fixture.emitReadiness('ready')
    fixture.emitReadiness('ready')
    await settle(50)
    expect(
      operations.filter((item) => item.type === 'dismiss' && item.id === 'webchat-runtime-readiness')
    ).toHaveLength(runtimeDismissCount)
    expect(descriptors.filter(({ id }) => id === 'webchat-runtime-readiness')).toHaveLength(runtimeDescriptorCount)

    setMounted(false)
    await waitForSurfaceAbsent()
    setMounted(true)
    await waitFor(() => fixture.store.query(fixture.presentation.query.SurfaceMountedQuery()))
    await waitFor(
      () =>
        operations.filter((item) => item.type === 'dismiss' && item.id === 'webchat-runtime-readiness').length ===
        runtimeDismissCount + 1
    )
    expect(descriptors.filter(({ id }) => id === 'webchat-runtime-readiness')).toHaveLength(runtimeDescriptorCount)
    expect(toast.getToasts().some(({ id }) => id === unrelatedId)).toBe(true)

    activeDescriptorId = null
    firstVisibleAt = null
    const operationCountBeforeReconnect = operations.length
    const runtimeErrorCountBeforeReconnect = operations.filter(
      (item) => item.type === 'error' && item.id === RUNTIME_TOAST_ID
    ).length
    fixture.store.send(fixture.room.command.ReconnectCommand())
    fixture.store.send(fixture.room.command.ReconnectCommand())
    let request = fixture.store.query(fixture.room.query.ReconnectRequestQuery())!
    activeDescriptorId = RUNTIME_TOAST_ID
    await waitFor(() => fixture.portSnapshots.length === 1)
    expect(fixture.portSnapshots[0].visible).toBe(false)
    await waitFor(() =>
      Boolean(document.querySelector(`[data-testid="${activeDescriptorId}"][data-mounted="true"][data-visible="true"]`))
    )
    await waitFor(() => fixture.store.query(fixture.room.query.ReconnectRequestQuery()) === null)
    await waitFor(() =>
      operations
        .slice(operationCountBeforeReconnect)
        .some((item) => item.type === 'dismiss' && item.id === activeDescriptorId)
    )
    const reconnectOperations = operations.slice(operationCountBeforeReconnect)
    const dismissOperation = reconnectOperations.find(
      (item) => item.type === 'dismiss' && item.id === activeDescriptorId
    )!
    expect(firstVisibleAt).not.toBeNull()
    expect(dismissOperation.at - firstVisibleAt!).toBeGreaterThanOrEqual(290)
    expect(reconnectOperations.some((item) => item.type === 'success' && item.id === activeDescriptorId)).toBe(false)
    expect(operations.filter((item) => item.type === 'error' && item.id === RUNTIME_TOAST_ID)).toHaveLength(
      runtimeErrorCountBeforeReconnect
    )
    expect(document.body.textContent).not.toContain('Ready to chat')
    expect(vi.mocked(fixture.chat.leaveRoom)).toHaveBeenCalledOnce()
    expect(toast.getToasts().some(({ id }) => id === unrelatedId)).toBe(true)
    await waitFor(() => document.querySelector(`[data-testid="${RUNTIME_TOAST_ID}"]`) === null)

    const closeDuringPresentation = deferred()
    fixture.usePort(() => closeDuringPresentation.promise)
    activeDescriptorId = null
    firstVisibleAt = null
    fixture.store.send(fixture.room.command.ReconnectCommand())
    request = fixture.store.query(fixture.room.query.ReconnectRequestQuery())!
    activeDescriptorId = RUNTIME_TOAST_ID
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
    await waitFor(() => operations.some((item) => item.type === 'dismiss' && item.id === activeDescriptorId))
    expect(operations.some((item) => item.type === 'success' && item.id === activeDescriptorId)).toBe(false)

    const openDuringActive = deferred()
    fixture.usePort(() => openDuringActive.promise)
    setMounted(false)
    await waitForSurfaceAbsent()
    activeDescriptorId = null
    firstVisibleAt = null
    fixture.store.send(fixture.room.command.ReconnectCommand())
    request = fixture.store.query(fixture.room.query.ReconnectRequestQuery())!
    activeDescriptorId = RUNTIME_TOAST_ID
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
    await waitForSurfaceAbsent()
    fixture.usePort(() => Promise.reject(new Error('closed reset')))
    const descriptorCountBeforeOmitted = descriptorIds.filter((id) => id === RUNTIME_TOAST_ID).length
    fixture.store.send(fixture.room.command.ReconnectCommand())
    await waitFor(() => fixture.store.query(fixture.room.query.ReconnectRequestQuery()) === null)
    setMounted(true)
    await settle(100)
    expect(descriptorIds.filter((id) => id === RUNTIME_TOAST_ID)).toHaveLength(descriptorCountBeforeOmitted)
    expect(document.body.textContent).not.toContain('closed reset')

    fixture.usePort(() => Promise.reject(new Error('open reset')))
    activeDescriptorId = null
    firstVisibleAt = null
    fixture.store.send(fixture.room.command.ReconnectCommand())
    request = fixture.store.query(fixture.room.query.ReconnectRequestQuery())!
    activeDescriptorId = RUNTIME_TOAST_ID
    await waitFor(
      () =>
        document.querySelector(`[data-testid="${activeDescriptorId}"]`)?.textContent?.includes('Connection failed') ===
        true
    )
    expect(fixture.store.query(fixture.room.query.ReconnectRequestQuery())).toBeNull()
    expect(operations.some((item) => item.type === 'error' && item.id === activeDescriptorId)).toBe(true)
    expect(descriptors.filter(({ id, type }) => id === RUNTIME_TOAST_ID && type === 'error').at(-1)).toEqual({
      id: RUNTIME_TOAST_ID,
      type: 'error',
      message: 'Connection failed'
    })
    expect(document.body.textContent).not.toContain('open reset')
    expect(operations.some((item) => item.type === 'dismiss' && item.id === undefined)).toBe(false)
    expect(operations.some((item) => item.type === 'dismiss' && item.id === unrelatedId)).toBe(false)
    expect(toast.getToasts().some(({ id }) => id === unrelatedId)).toBe(true)

    setMounted(false)
    await waitForSurfaceAbsent()
    fixture.usePort(() => Promise.resolve())
    const absentStartedAt = Date.now()
    fixture.store.send(fixture.room.command.ReconnectCommand())
    await waitFor(() => fixture.store.query(fixture.room.query.ReconnectRequestQuery()) === null)
    expect(Date.now() - absentStartedAt).toBeLessThan(1000)
    expect(document.body.textContent).not.toContain('Connected to the chat.')
    expect(descriptorIds.some((id) => id.startsWith('webchat-request-'))).toBe(false)

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
