import { afterEach, describe, expect, it, vi } from 'vitest'
import { installTestWebLocks } from './withPreparationLock.test-utils'
import { withPreparationLock } from './withPreparationLock'

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
