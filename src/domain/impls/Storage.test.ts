import { afterAll, describe, expect, it, vi } from 'vitest'
import { APP_STATUS_STORAGE_KEY, STORAGE_NAME } from '@/constants/config'
import { CONFIG_STORE_VERSION_KEY } from '@/constants/storage'

vi.mock('#imports', () => ({
  browser: {
    storage: {
      sync: {
        get: vi.fn(async () => ({})),
        set: vi.fn(async () => {}),
        remove: vi.fn(async () => {}),
        clear: vi.fn(async () => {}),
        onChanged: { addListener: vi.fn(), removeListener: vi.fn() }
      }
    }
  }
}))

const createLocalStorage = () => {
  const storage = Object.create(null) as Storage
  Object.defineProperties(storage, {
    length: {
      get: () => Object.keys(storage).length
    },
    clear: {
      value: () => Object.keys(storage).forEach((key) => delete (storage as unknown as Record<string, string>)[key])
    },
    getItem: {
      value: (key: string) => (Object.prototype.hasOwnProperty.call(storage, key) ? storage[key] : null)
    },
    key: {
      value: (index: number) => Object.keys(storage)[index] ?? null
    },
    removeItem: {
      value: (key: string) => delete (storage as unknown as Record<string, string>)[key]
    },
    setItem: {
      value: (key: string, value: string) => {
        ;(storage as unknown as Record<string, string>)[key] = String(value)
      }
    }
  })
  return storage
}

afterAll(() => {
  vi.unstubAllGlobals()
})

describe('origin-local configuration preparation', () => {
  it('preserves host keys and applies baseline, same-version, and mismatch rules only to the WebChat namespace', async () => {
    const localStorage = createLocalStorage()
    vi.stubGlobal('window', { localStorage })
    vi.stubGlobal('location', { origin: 'https://storage.test' })
    const { prepareLocalConfigurationStorage } = await import('./Storage')
    const statusKey = `${STORAGE_NAME}:${APP_STATUS_STORAGE_KEY}`
    const versionKey = `${STORAGE_NAME}:${CONFIG_STORE_VERSION_KEY}`
    localStorage.setItem('HOST_PAGE_KEY', 'preserved')
    localStorage.setItem(statusKey, '{"open":true}')

    await prepareLocalConfigurationStorage()
    expect(localStorage.getItem(statusKey)).toBe('{"open":true}')
    expect(localStorage.getItem(versionKey)).toBe('1')

    localStorage.setItem(statusKey, '{"open":false}')
    await prepareLocalConfigurationStorage()
    expect(localStorage.getItem(statusKey)).toBe('{"open":false}')

    localStorage.setItem(versionKey, '7')
    await prepareLocalConfigurationStorage()
    expect(localStorage.getItem(statusKey)).toBeNull()
    expect(localStorage.getItem(versionKey)).toBe('1')
    expect(localStorage.getItem('HOST_PAGE_KEY')).toBe('preserved')
  })
})
