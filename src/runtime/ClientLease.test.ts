import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ClientLease } from './ClientLease'
import type { RuntimeCoordinator, RuntimeHostStatus, RuntimeServer, RuntimeSnapshot } from './Contract'

const deferred = <T>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

const snapshot: RuntimeSnapshot = {
  hostId: 'host-a',
  hostPhase: 'ready',
  peerId: 'peer-a',
  domains: [],
  world: { joined: false, peerId: 'peer-a', presences: [] }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('ClientLease generation ownership', () => {
  it('does not attach, publish ready, or start a watchdog after init is detached', async () => {
    const registration = deferred<RuntimeHostStatus>()
    const coordinator = {
      registerPage: vi.fn(() => registration.promise),
      unregisterPage: vi.fn(async () => {})
    } as unknown as RuntimeCoordinator
    const server = {
      attachPage: vi.fn(async () => snapshot),
      detachPage: vi.fn(async () => {})
    } as unknown as RuntimeServer
    const interval = vi.spyOn(globalThis, 'setInterval')
    const ready = vi.fn()
    const client = new ClientLease({ coordinator, server, pageId: 'page-a', domain: 'https://example.test' })
    client.whenReady(ready)

    const initializing = client.init()
    await vi.waitFor(() => expect(coordinator.registerPage).toHaveBeenCalledOnce())
    client.detach()
    registration.resolve({ phase: 'ready', generation: 1 })
    await initializing

    expect(server.attachPage).not.toHaveBeenCalled()
    expect(ready).not.toHaveBeenCalled()
    expect(interval).not.toHaveBeenCalled()
  })

  it('does not publish a late initial server attachment after detach', async () => {
    const attachment = deferred<RuntimeSnapshot>()
    const coordinator = {
      registerPage: vi.fn(async () => ({ phase: 'ready' as const, generation: 1 })),
      unregisterPage: vi.fn(async () => {})
    } as unknown as RuntimeCoordinator
    const server = {
      attachPage: vi.fn(() => attachment.promise),
      detachPage: vi.fn(async () => {})
    } as unknown as RuntimeServer
    const interval = vi.spyOn(globalThis, 'setInterval')
    const ready = vi.fn()
    const client = new ClientLease({ coordinator, server, pageId: 'page-a', domain: 'https://example.test' })
    client.whenReady(ready)

    const initializing = client.init()
    await vi.waitFor(() => expect(server.attachPage).toHaveBeenCalledOnce())
    client.detach()
    attachment.resolve(snapshot)
    await initializing

    expect(server.detachPage).toHaveBeenCalled()
    expect(ready).not.toHaveBeenCalled()
    expect(interval).not.toHaveBeenCalled()
  })

  it('does not resurrect a detached lease from an in-flight recovery check', async () => {
    const recoveryRegistration = deferred<RuntimeHostStatus>()
    let registrations = 0
    const coordinator = {
      registerPage: vi.fn(async () => {
        registrations += 1
        return registrations === 1 ? { phase: 'ready' as const, generation: 1 } : recoveryRegistration.promise
      }),
      unregisterPage: vi.fn(async () => {})
    } as unknown as RuntimeCoordinator
    const server = {
      attachPage: vi.fn(async () => snapshot),
      detachPage: vi.fn(async () => {}),
      getSnapshot: vi.fn(async () => snapshot)
    } as unknown as RuntimeServer
    const interval = vi.spyOn(globalThis, 'setInterval')
    const ready = vi.fn()
    const client = new ClientLease({ coordinator, server, pageId: 'page-a', domain: 'https://example.test' })
    client.whenReady(ready)
    await client.init()
    expect(server.attachPage).toHaveBeenCalledOnce()
    expect(ready).toHaveBeenCalledOnce()
    expect(interval).toHaveBeenCalledOnce()

    const checking = client.checkNow()
    await vi.waitFor(() => expect(coordinator.registerPage).toHaveBeenCalledTimes(2))
    client.detach()
    recoveryRegistration.resolve({ phase: 'ready', generation: 2 })
    await checking

    expect(server.attachPage).toHaveBeenCalledOnce()
    expect(ready).toHaveBeenCalledOnce()
    expect(interval).toHaveBeenCalledOnce()
  })
})
