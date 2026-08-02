import { afterEach, describe, expect, it, vi } from 'vitest'
import { installTestWebLocks } from './withPreparationLock.test-utils'
import { createDirectPreparationCoordinator, withPreparationLock } from './withPreparationLock'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('persistence preparation lock', () => {
  it('runs an owned preparation while cross-realm Web Locks are available', async () => {
    installTestWebLocks()
    const prepare = vi.fn(async () => {})

    await withPreparationLock('available', prepare)

    expect(prepare).toHaveBeenCalledTimes(1)
  })

  it('fails closed before preparation when cross-realm Web Locks are unavailable', async () => {
    vi.stubGlobal('navigator', {})
    const prepare = vi.fn(async () => {})
    const diagnostic = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(withPreparationLock('unavailable', prepare)).rejects.toThrow(
      'Persistence preparation coordination unavailable'
    )

    expect(prepare).not.toHaveBeenCalled()
    expect(diagnostic).toHaveBeenCalledWith('[WebChat] Persistence preparation coordination unavailable')
    diagnostic.mockRestore()
  })
})

describe('persistence preparation lock coordinator', () => {
  it('holds the injected coordinator lease across preparation and releases on settle', async () => {
    const events: string[] = []
    const coordinator = {
      acquire: vi.fn(async () => {
        events.push('acquire')
        return () => {
          events.push('release')
        }
      })
    }
    const prepare = vi.fn(async () => {
      events.push('prepare')
    })

    await withPreparationLock('coordinated', prepare, coordinator)

    expect(coordinator.acquire).toHaveBeenCalledWith('coordinated')
    expect(events).toEqual(['acquire', 'prepare', 'release'])
  })

  it('releases the injected lease when preparation rejects', async () => {
    const release = vi.fn()
    const coordinator = { acquire: vi.fn(async () => release) }
    const prepare = vi.fn(async () => {
      throw new Error('physical failure')
    })

    await expect(withPreparationLock('coordinated-failure', prepare, coordinator)).rejects.toThrow('physical failure')

    expect(release).toHaveBeenCalledTimes(1)
  })

  it('releases an injected lease granted after supersede without running stale preparation', async () => {
    const grants: Array<() => void> = []
    const releases = [vi.fn(), vi.fn()]
    const coordinator = {
      acquire: vi.fn(() => {
        const index = grants.length
        return new Promise<() => void>((resolve) => {
          grants.push(() => resolve(releases[index]))
        })
      })
    }
    const stale = vi.fn(async () => {})
    const current = vi.fn(async () => {})

    const first = withPreparationLock('coordinated-supersede', stale, coordinator)
    await new Promise((resolve) => setTimeout(resolve, 10))
    const second = withPreparationLock('coordinated-supersede', current, coordinator)
    await new Promise((resolve) => setTimeout(resolve, 10))
    // Both generations are granted only after the first was superseded.
    for (const grant of grants.splice(0)) grant()

    await expect(second).resolves.toBeUndefined()
    await expect(first).resolves.toBeUndefined()
    expect(stale).not.toHaveBeenCalled()
    expect(current).toHaveBeenCalledTimes(1)
    expect(releases[0]).toHaveBeenCalledTimes(1)
    expect(releases[1]).toHaveBeenCalledTimes(1)
  })

  it('runs preparation directly without cross-context arbitration under the direct coordinator', async () => {
    const prepare = vi.fn(async () => {})

    await withPreparationLock('direct', prepare, createDirectPreparationCoordinator())

    expect(prepare).toHaveBeenCalledTimes(1)
  })
})
