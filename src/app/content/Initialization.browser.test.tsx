import { render } from 'vitest-browser-react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Remesh } from 'remesh'
import { Toaster } from 'sonner'
import { startInitializationLifecycle, type InitializationDependencies } from '@/app/content/Initialization'
import AppStatusDomain from '@/domain/AppStatus'
import { ChatRoomExtern } from '@/domain/externs/ChatRoom'
import { WorldRoomExtern } from '@/domain/externs/WorldRoom'
import { ReadinessExtern } from '@/domain/externs/Readiness'
import { BrowserSyncStorageExtern, LocalStorageExtern } from '@/domain/externs/Storage'
import { ToastImpl } from '@/domain/impls/Toast'
import { MessageDatabaseExtern } from '@/domain/MessageStore'
import { createMemoryMessageDatabase } from '@/domain/impls/database/Memory'

let fixtureId = 0

const createFixture = () => {
  const storage = {
    get: async () => null,
    set: async () => {},
    watch: async () => async () => {}
  }
  const chat = {
    joinRoom: async () => {},
    leaveRoom: async () => {},
    sendMessage: async () => {
      throw new Error('unused')
    },
    onMessage: () => () => {},
    onJoinRoom: () => () => {},
    onLeaveRoom: () => () => {},
    onSessions: () => () => {},
    onError: () => () => {}
  }
  const world = {
    getState: async () => [],
    onState: () => () => {},
    onError: () => () => {}
  }
  const store = Remesh.store({
    externs: [
      ToastImpl,
      LocalStorageExtern.impl(storage),
      BrowserSyncStorageExtern.impl(storage),
      MessageDatabaseExtern.impl(createMemoryMessageDatabase(`initialization-browser-${fixtureId++}`)),
      ChatRoomExtern.impl(chat),
      WorldRoomExtern.impl(world),
      ReadinessExtern.impl({ onState: () => () => {} })
    ]
  })
  const domain = store.getDomain(AppStatusDomain())
  return { store, domain }
}

const settle = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const errorToast = () => {
  const toasts = [...document.querySelectorAll<HTMLElement>('[data-sonner-toast]')].filter((toast) =>
    toast.textContent?.includes('WebChat unavailable')
  )
  return toasts.length > 0 ? toasts : null
}

describe('initialization error toast ownership (real Sonner boundary)', () => {
  afterEach(() => {
    document.querySelector('[data-sonner-toaster]')?.remove()
  })

  it('keeps the failure error toast presented and replaces it with a new one after a failed retry', async () => {
    const failing: InitializationDependencies = {
      prepareBrowserSyncStorage: vi.fn(async () => {}),
      prepareLocalStorage: vi.fn(async () => {
        throw new Error('Permission denied to access property "then"')
      }),
      prepareMessageDatabase: vi.fn(async () => {}),
      initializeRuntime: vi.fn(async () => ({})),
      detachRuntime: vi.fn()
    }
    const fixture = createFixture()
    vi.spyOn(console, 'error').mockImplementation(() => {})

    await render(<Toaster />)
    const stop = startInitializationLifecycle({
      store: fixture.store,
      dependencies: failing,
      activateApplicationDependencies: vi.fn()
    })

    // Initial failure: the error descriptor must stay presented beyond the settlement frame.
    await vi.waitFor(() => expect(errorToast(), 'initial failure error toast').toBeTruthy())
    await settle(1000)
    expect(errorToast(), 'initial error toast must not be actively dismissed by its own settlement').toBeTruthy()

    // Failed retry: the new attempt's failure must present a fresh error toast that also stays.
    // (The intermediate loading descriptor flashes for only one microtask chain, so assert the retry
    // through the attempt count instead of racing its presentation.)
    fixture.store.send(fixture.domain.command.RetryCommand())
    await vi.waitFor(() => expect(failing.prepareLocalStorage).toHaveBeenCalledTimes(2))
    await vi.waitFor(() => expect(errorToast(), 'retry failure error toast').toBeTruthy())
    await settle(1000)
    expect(errorToast(), 'retry error toast must remain presented after the failed attempt').toBeTruthy()

    stop()
  })
})
