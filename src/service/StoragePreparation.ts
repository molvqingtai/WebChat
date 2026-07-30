import { browser } from '#imports'
import { CONFIG_STORE_VERSION_KEY } from '@/constants/storage'
import { prepareConfigurationStorage, type ConfigurationVersionStorage } from '@/domain/impls/StorageVersion'

const PREPARE_BROWSER_SYNC_STORAGE = 'WEB_CHAT_PREPARE_BROWSER_SYNC_STORAGE_V1'

interface StorageArea {
  get(key: string): Promise<Record<string, unknown>>
  set(values: Record<string, unknown>): Promise<void>
  clear(): Promise<void>
}

interface RuntimeApi {
  readonly id: string
  readonly onInstalled: {
    addListener(listener: () => Promise<void>): void
  }
  readonly onMessage: {
    addListener(listener: (message: unknown) => Promise<{ readonly ready: boolean }> | undefined): void
  }
  sendMessage(message: unknown): Promise<unknown>
}

const versionStorage = (storage: StorageArea): ConfigurationVersionStorage => ({
  async readVersion() {
    const values = await storage.get(CONFIG_STORE_VERSION_KEY)
    return {
      exists: Object.prototype.hasOwnProperty.call(values, CONFIG_STORE_VERSION_KEY),
      value: values[CONFIG_STORE_VERSION_KEY]
    }
  },
  writeVersion: (version) => storage.set({ [CONFIG_STORE_VERSION_KEY]: version }),
  clear: () => storage.clear()
})

const runtimeApi = () => browser.runtime as unknown as RuntimeApi
const syncStorage = () => browser.storage.sync as unknown as StorageArea

export const registerBrowserSyncStoragePreparation = (
  runtime: RuntimeApi = runtimeApi(),
  storage: StorageArea = syncStorage()
) => {
  const prepare = () => prepareConfigurationStorage(`browser-sync:${runtime.id}`, versionStorage(storage))

  runtime.onInstalled.addListener(() => prepare().catch(() => {}))
  runtime.onMessage.addListener((message) => {
    if (message !== PREPARE_BROWSER_SYNC_STORAGE) return undefined
    return prepare().then(
      () => ({ ready: true }),
      () => ({ ready: false })
    )
  })
}

export const requestBrowserSyncStoragePreparation = async (runtime: RuntimeApi = runtimeApi()): Promise<void> => {
  let response: unknown
  try {
    response = await runtime.sendMessage(PREPARE_BROWSER_SYNC_STORAGE)
  } catch {
    console.error('[WebChat] Browser sync configuration preparation unavailable')
    throw new Error('Browser sync configuration preparation unavailable')
  }

  if (typeof response === 'object' && response !== null && 'ready' in response) {
    if ((response as { ready: unknown }).ready === true) return
    throw new Error('Browser sync configuration preparation failed')
  }

  console.error('[WebChat] Browser sync configuration preparation unavailable')
  throw new Error('Browser sync configuration preparation unavailable')
}
