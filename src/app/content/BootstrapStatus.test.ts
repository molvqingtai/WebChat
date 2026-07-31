import { createRequire } from 'node:module'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { Remesh, type RemeshStore } from 'remesh'
import type { ComponentType, ReactNode } from 'react'
import type { Root } from 'react-dom/client'
import AppStatusDomain, { type AppStatus } from '@/domain/AppStatus'
import ToastPresentationDomain from '@/domain/ToastPresentation'
import { APP_STATUS_STORAGE_KEY } from '@/constants/storage'
import { LocalStorageExtern, type Storage } from '@/domain/externs/Storage'
import type { BootstrapDependencies } from '@/app/content/Bootstrap'

vi.mock('@/app/content/BootstrapShell', async () => {
  const React = await import('react')
  const { useRemeshDomain, useRemeshQuery, useRemeshSend } = await import('remesh-react')
  const { default: AppStatus } = await import('@/domain/AppStatus')

  return {
    default: ({
      phase,
      onRetry,
      application
    }: {
      phase: 'connecting' | 'unavailable'
      onRetry: () => void
      application?: ReactNode
    }) => {
      const send = useRemeshSend()
      const status = useRemeshDomain(AppStatus())
      const open = useRemeshQuery(status.query.OpenQuery())
      const loaded = useRemeshQuery(status.query.StatusLoadIsFinishedQuery())

      return React.createElement(
        'section',
        {
          'data-testid': 'shell',
          'data-phase': phase,
          'data-open': String(open),
          'data-loaded': String(loaded)
        },
        React.createElement(
          'button',
          {
            type: 'button',
            'data-testid': 'launcher',
            onClick: () => send(status.command.UpdateOpenCommand(!open))
          },
          open ? 'Close WebChat' : 'Open WebChat'
        ),
        React.createElement(
          'button',
          {
            type: 'button',
            'data-testid': 'bootstrap-refresh',
            disabled: phase === 'connecting',
            onClick: onRetry
          },
          'Refresh'
        ),
        application
      )
    }
  }
})

const require = createRequire(import.meta.url)
const wxtRequire = createRequire(require.resolve('wxt'))
const { parseHTML } = wxtRequire('linkedom') as {
  parseHTML: (html: string) => { window: Window & typeof globalThis; document: Document }
}
const { window, document } = parseHTML('<!doctype html><html><body></body></html>')
Object.defineProperty(window, 'location', { value: new URL('https://status-bootstrap.test/'), configurable: true })
Object.defineProperty(document, 'location', { value: window.location, configurable: true })
const previousGlobals = new Map<string, PropertyDescriptor | undefined>()
for (const [name, value] of Object.entries({
  window,
  document,
  navigator: window.navigator,
  location: window.location,
  HTMLElement: window.HTMLElement,
  Element: window.Element,
  Node: window.Node,
  Event: window.Event,
  MutationObserver: window.MutationObserver,
  IS_REACT_ACT_ENVIRONMENT: true
})) {
  previousGlobals.set(name, Object.getOwnPropertyDescriptor(globalThis, name))
  Object.defineProperty(globalThis, name, { value, writable: true, configurable: true })
}

const React = await import('react')
const { act } = React
const { createRoot } = await import('react-dom/client')
const { RemeshRoot, RemeshScope } = await import('remesh-react')
const { default: ContentBootstrap } = await import('@/app/content/Bootstrap')
const TestRemeshRoot = RemeshRoot as ComponentType<{ store: RemeshStore; children?: ReactNode }>
const TestRemeshScope = RemeshScope as ComponentType<{ domains: unknown[]; children?: ReactNode }>

const roots: Root[] = []
const stores: RemeshStore[] = []

const deferred = <Value>() => {
  let resolve!: (value: Value) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<Value>((onResolve, onReject) => {
    resolve = onResolve
    reject = onReject
  })
  return { promise, resolve, reject }
}

const createStorage = (read: Promise<AppStatus | null>) => {
  const get = vi.fn(() => read)
  const set = vi.fn(async () => {})
  const watch = vi.fn(async () => async () => {})
  const storage: Storage = {
    get: get as Storage['get'],
    set: set as Storage['set'],
    watch
  }
  return { storage, get, set, watch }
}

const createDependencies = () => {
  const dependencies: BootstrapDependencies = {
    prepareBrowserSyncStorage: vi.fn(async () => {}),
    prepareLocalStorage: vi.fn(async () => {}),
    prepareMessageDatabase: vi.fn(async () => {}),
    initializeRuntime: vi.fn(async () => ({})),
    detachRuntime: vi.fn()
  }
  return dependencies
}

const render = async (storage: Storage, dependencies: BootstrapDependencies) => {
  const store = Remesh.store({ externs: [LocalStorageExtern.impl(storage)] })
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  const createApplication = vi.fn(() => React.createElement('div', { 'data-testid': 'application' }, 'ready'))
  roots.push(root)
  stores.push(store)

  await act(async () => {
    root.render(
      React.createElement(
        TestRemeshRoot,
        { store },
        React.createElement(
          TestRemeshScope,
          { domains: [AppStatusDomain(), ToastPresentationDomain()] },
          React.createElement(ContentBootstrap, { dependencies, createApplication })
        )
      )
    )
  })

  return { container, createApplication }
}

const shell = (container: HTMLElement) => container.querySelector<HTMLElement>('[data-testid="shell"]')

const click = async (element: Element | null) => {
  if (!element) throw new Error('Expected interactive control')
  await act(async () => element.dispatchEvent(new window.Event('click', { bubbles: true })))
}

afterEach(async () => {
  await act(async () => roots.splice(0).forEach((root) => root.unmount()))
  stores.splice(0).forEach((store) => store.discard())
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

afterAll(() => {
  for (const [name, descriptor] of previousGlobals) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor)
    else Reflect.deleteProperty(globalThis, name)
  }
})

describe('shell status and bootstrap independence', () => {
  const stages = [
    'prepareBrowserSyncStorage',
    'prepareLocalStorage',
    'prepareMessageDatabase',
    'initializeRuntime'
  ] as const

  it.each(stages)('restores persisted expanded state while %s is pending and after it fails', async (stage) => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const statusRead = deferred<AppStatus | null>()
    const stageWork = deferred<never>()
    const storage = createStorage(statusRead.promise)
    const dependencies = createDependencies()
    vi.mocked(dependencies[stage]).mockReturnValueOnce(stageWork.promise)
    const rendered = await render(storage.storage, dependencies)

    await vi.waitFor(() => expect(dependencies[stage]).toHaveBeenCalledOnce())
    expect(shell(rendered.container)?.dataset.phase).toBe('connecting')

    statusRead.resolve({ open: true, unread: 2, position: { x: 72, y: 31 } })
    await vi.waitFor(() => expect(shell(rendered.container)?.dataset.loaded).toBe('true'))
    expect(shell(rendered.container)?.dataset.open).toBe('true')
    expect(rendered.createApplication).not.toHaveBeenCalled()

    stageWork.reject(new Error(`${stage} unavailable`))
    await vi.waitFor(() => expect(shell(rendered.container)?.dataset.phase).toBe('unavailable'))

    expect(shell(rendered.container)?.dataset.open).toBe('true')
    expect(rendered.createApplication).not.toHaveBeenCalled()
    await vi.waitFor(() =>
      expect(storage.set).toHaveBeenLastCalledWith(APP_STATUS_STORAGE_KEY, expect.objectContaining({ open: true }))
    )
  })

  it('keeps a newer pre-hydration shell interaction through an opposite stored snapshot and failure', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const statusRead = deferred<AppStatus | null>()
    const stageWork = deferred<never>()
    const storage = createStorage(statusRead.promise)
    const dependencies = createDependencies()
    vi.mocked(dependencies.prepareBrowserSyncStorage).mockReturnValueOnce(stageWork.promise)
    const rendered = await render(storage.storage, dependencies)

    await vi.waitFor(() => expect(storage.get).toHaveBeenCalledOnce())
    await click(rendered.container.querySelector('[data-testid="launcher"]'))
    expect(shell(rendered.container)?.dataset.open).toBe('true')

    statusRead.resolve({ open: false, unread: 7, position: { x: 61, y: 28 } })
    await vi.waitFor(() => expect(shell(rendered.container)?.dataset.loaded).toBe('true'))
    expect(shell(rendered.container)?.dataset.open).toBe('true')

    stageWork.reject(new Error('bootstrap unavailable'))
    await vi.waitFor(() => expect(shell(rendered.container)?.dataset.phase).toBe('unavailable'))
    expect(shell(rendered.container)?.dataset.open).toBe('true')
    await vi.waitFor(() =>
      expect(storage.set).toHaveBeenLastCalledWith(APP_STATUS_STORAGE_KEY, expect.objectContaining({ open: true }))
    )
  })

  it('reuses one status read and watcher across bootstrap failure, Retry, and ready activation', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const storage = createStorage(Promise.resolve({ open: true, unread: 0, position: { x: 70, y: 30 } }))
    const dependencies = createDependencies()
    vi.mocked(dependencies.prepareBrowserSyncStorage)
      .mockRejectedValueOnce(new Error('initial failure'))
      .mockResolvedValueOnce()
    const rendered = await render(storage.storage, dependencies)

    await vi.waitFor(() => expect(shell(rendered.container)?.dataset.phase).toBe('unavailable'))
    await vi.waitFor(() => expect(shell(rendered.container)?.dataset.open).toBe('true'))
    const originalShell = shell(rendered.container)

    await click(rendered.container.querySelector('[data-testid="bootstrap-refresh"]'))
    await vi.waitFor(() => expect(rendered.container.querySelector('[data-testid="application"]')).not.toBeNull())

    expect(shell(rendered.container)).toBe(originalShell)
    expect(storage.get).toHaveBeenCalledOnce()
    expect(storage.watch).toHaveBeenCalledOnce()
    expect(rendered.createApplication).toHaveBeenCalledOnce()
  })
})
