import { afterEach, describe, expect, it, vi } from 'vitest'
import { serializePreparation } from './serializedPreparation'
import { installTestWebLocks } from './serializedPreparation.test-utils'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('serialized persistence preparation', () => {
  it('runs an owned preparation while cross-realm Web Locks are available', async () => {
    installTestWebLocks()
    const prepare = vi.fn(async () => {})

    await serializePreparation('available', prepare)

    expect(prepare).toHaveBeenCalledTimes(1)
  })

  it('fails closed before preparation when cross-realm Web Locks are unavailable', async () => {
    vi.stubGlobal('navigator', {})
    const prepare = vi.fn(async () => {})
    const diagnostic = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(serializePreparation('unavailable', prepare)).rejects.toThrow(
      'Persistence preparation coordination unavailable'
    )

    expect(prepare).not.toHaveBeenCalled()
    expect(diagnostic).toHaveBeenCalledWith('[WebChat] Persistence preparation coordination unavailable')
    diagnostic.mockRestore()
  })
})
