import { describe, expect, it, vi } from 'vitest'
import { CONFIG_STORE_VERSION } from '@/constants/storage'
import { prepareConfigurationStorage, type ConfigurationVersionStorage } from './StorageVersion'

let storageId = 0

const createStorage = (version: { exists: boolean; value?: unknown }, values = new Map<string, unknown>()) => {
  let storedVersion = version
  const storage: ConfigurationVersionStorage = {
    readVersion: vi.fn(async () => ({ exists: storedVersion.exists, value: storedVersion.value })),
    writeVersion: vi.fn(async (value) => {
      storedVersion = { exists: true, value }
    }),
    clear: vi.fn(async () => {
      values.clear()
      storedVersion = { exists: false }
    })
  }
  return { storage, values, version: () => storedVersion }
}

const prepare = (fixture: ReturnType<typeof createStorage>) =>
  prepareConfigurationStorage(`test-${storageId++}`, fixture.storage)

describe('configuration storage version ownership', () => {
  it('establishes a missing baseline without clearing pre-version data', async () => {
    const fixture = createStorage({ exists: false }, new Map([['user-info', 'preserved']]))

    await prepare(fixture)

    expect(fixture.storage.clear).not.toHaveBeenCalled()
    expect(fixture.values.get('user-info')).toBe('preserved')
    expect(fixture.version()).toEqual({ exists: true, value: CONFIG_STORE_VERSION })
  })

  it('preserves all values on the same version', async () => {
    const fixture = createStorage({ exists: true, value: CONFIG_STORE_VERSION }, new Map([['app-status', 'preserved']]))

    await prepare(fixture)

    expect(fixture.storage.clear).not.toHaveBeenCalled()
    expect(fixture.storage.writeVersion).not.toHaveBeenCalled()
    expect(fixture.values.get('app-status')).toBe('preserved')
  })

  it.each([0, 2, 7, -1, '1', null, { version: 1 }])(
    'clears an existing non-equal or malformed completion value %j',
    async (storedVersion) => {
      const fixture = createStorage({ exists: true, value: storedVersion }, new Map([['old', 'generation']]))

      await prepare(fixture)

      expect(fixture.storage.clear).toHaveBeenCalledTimes(1)
      expect(fixture.values.size).toBe(0)
      expect(fixture.version()).toEqual({ exists: true, value: CONFIG_STORE_VERSION })
    }
  )

  it('joins concurrent contenders and preserves writes after target completion', async () => {
    const fixture = createStorage({ exists: true, value: 2 }, new Map([['old', 'generation']]))
    let releaseClear!: () => void
    vi.mocked(fixture.storage.clear).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          releaseClear = () => {
            fixture.values.clear()
            resolve()
          }
        })
    )
    const identity = `concurrent-${storageId++}`

    const first = prepareConfigurationStorage(identity, fixture.storage)
    const second = prepareConfigurationStorage(identity, fixture.storage)
    await vi.waitFor(() => expect(fixture.storage.clear).toHaveBeenCalledTimes(1))
    releaseClear()
    await Promise.all([first, second])

    fixture.values.set('new', 'generation')
    await prepareConfigurationStorage(identity, fixture.storage)
    expect(fixture.storage.clear).toHaveBeenCalledTimes(1)
    expect(fixture.values.get('new')).toBe('generation')
  })

  it('does not advance completion after clear failure and retries later', async () => {
    const fixture = createStorage({ exists: true, value: 2 }, new Map([['old', 'generation']]))
    vi.mocked(fixture.storage.clear).mockRejectedValueOnce(new Error('private failure'))
    const diagnostic = vi.spyOn(console, 'error').mockImplementation(() => {})
    const identity = `retry-${storageId++}`

    await expect(prepareConfigurationStorage(identity, fixture.storage)).rejects.toThrow(
      'Configuration store preparation failed'
    )
    expect(fixture.version()).toEqual({ exists: true, value: 2 })
    expect(fixture.storage.writeVersion).not.toHaveBeenCalled()
    expect(diagnostic).toHaveBeenCalledWith('[WebChat] Configuration store preparation failed')

    await prepareConfigurationStorage(identity, fixture.storage)
    expect(fixture.storage.clear).toHaveBeenCalledTimes(2)
    expect(fixture.version()).toEqual({ exists: true, value: CONFIG_STORE_VERSION })
    diagnostic.mockRestore()
  })

  it('retries marker completion after a successful clear without clearing twice', async () => {
    const fixture = createStorage({ exists: true, value: 2 }, new Map([['old', 'generation']]))
    vi.mocked(fixture.storage.writeVersion).mockRejectedValueOnce(new Error('private failure'))
    const diagnostic = vi.spyOn(console, 'error').mockImplementation(() => {})
    const identity = `completion-retry-${storageId++}`

    await expect(prepareConfigurationStorage(identity, fixture.storage)).rejects.toThrow(
      'Configuration store preparation failed'
    )
    expect(fixture.values.size).toBe(0)
    expect(fixture.version()).toEqual({ exists: false })

    await prepareConfigurationStorage(identity, fixture.storage)
    expect(fixture.storage.clear).toHaveBeenCalledTimes(1)
    expect(fixture.version()).toEqual({ exists: true, value: CONFIG_STORE_VERSION })
    expect(diagnostic).toHaveBeenCalledTimes(1)
    diagnostic.mockRestore()
  })

  it('keeps independent physical scopes isolated', async () => {
    const current = createStorage({ exists: true, value: 2 }, new Map([['current', 'old']]))
    const other = createStorage({ exists: true, value: CONFIG_STORE_VERSION }, new Map([['other', 'preserved']]))

    await Promise.all([
      prepareConfigurationStorage(`current-${storageId++}`, current.storage),
      prepareConfigurationStorage(`other-${storageId++}`, other.storage)
    ])

    expect(current.values.size).toBe(0)
    expect(other.values.get('other')).toBe('preserved')
    expect(other.storage.clear).not.toHaveBeenCalled()
  })
})
