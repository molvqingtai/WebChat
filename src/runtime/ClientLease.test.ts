import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ClientLease } from './ClientLease'
import type { RuntimeCoordinator, RuntimePageRegistration, RuntimeSnapshot } from './Contract'

const pageId = 'page-a'
const domain = 'https://example.test'

const snapshot = (hostId = 'host-a'): RuntimeSnapshot => ({
  hostId,
  hostPhase: 'ready',
  peerId: 'peer-a',
  domains: [{ domain, phase: 'active', pageIds: [pageId], chatRoomJoined: true, sessions: [] }],
  world: { joined: true, peerId: 'peer-a', presences: [] }
})

const registration = (hostId = 'host-a'): RuntimePageRegistration => ({ snapshot: snapshot(hostId) })

const coordinatorWith = (registerPage: RuntimeCoordinator['registerPage']): RuntimeCoordinator => ({
  registerPage
})

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

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

  it('returns an exact rebind outcome only after every current readiness callback settles', async () => {
    const registerPage = vi
      .fn<RuntimeCoordinator['registerPage']>()
      .mockResolvedValueOnce(registration('host-a'))
      .mockResolvedValueOnce({ ...registration('host-b'), rebindId: 'rebind-a' })
    let releaseReady!: () => void
    const readiness = new Promise<void>((resolve) => {
      releaseReady = resolve
    })
    let readyCalls = 0
    const client = new ClientLease({ coordinator: coordinatorWith(registerPage), pageId, domain })
    client.whenReady(() => {
      readyCalls += 1
      return readyCalls === 1 ? undefined : readiness
    })

    await client.init()
    let settled = false
    const rebind = client.rebind('rebind-a').then((outcome) => {
      settled = true
      return outcome
    })
    await Promise.resolve()

    expect(settled).toBe(false)
    expect(registerPage).toHaveBeenLastCalledWith({ domain, pageId, rebindId: 'rebind-a' })
    releaseReady()
    await expect(rebind).resolves.toEqual({ rebindId: 'rebind-a' })
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
