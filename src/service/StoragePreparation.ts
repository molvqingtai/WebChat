import { browser } from '#imports'
import { CONFIG_STORE_VERSION, CONFIG_STORE_VERSION_KEY } from '@/constants/storage'
import { withPreparationLock } from '@/utils/withPreparationLock'

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

const prepareConfigurationStorage = (identity: string, storage: StorageArea): Promise<void> =>
  withPreparationLock(`configuration:${identity}`, async (lock) => {
    const values = await lock.read(storage.get(CONFIG_STORE_VERSION_KEY))
    if (!Object.prototype.hasOwnProperty.call(values, CONFIG_STORE_VERSION_KEY)) {
      await lock.write(() => storage.set({ [CONFIG_STORE_VERSION_KEY]: CONFIG_STORE_VERSION }))
      lock.checkpoint()
      return
    }
    if (values[CONFIG_STORE_VERSION_KEY] === CONFIG_STORE_VERSION) return

    await lock.write(() => storage.clear())
    lock.checkpoint()
    await lock.write(() => storage.set({ [CONFIG_STORE_VERSION_KEY]: CONFIG_STORE_VERSION }))
    lock.checkpoint()
  })

const runtimeApi = () => browser.runtime as unknown as RuntimeApi
const syncStorage = () => browser.storage.sync as unknown as StorageArea

export const registerBrowserSyncStoragePreparation = (
  runtime: RuntimeApi = runtimeApi(),
  storage: StorageArea = syncStorage()
) => {
  const prepare = () => prepareConfigurationStorage(`browser-sync:${runtime.id}`, storage)

  runtime.onInstalled.addListener(async () => {
    try {
      await prepare()
    } catch (error) {
      // Installation has no current page route, so it owns one direct diagnostic.
      console.error(error)
    }
  })
  runtime.onMessage.addListener((message) => {
    if (message !== PREPARE_BROWSER_SYNC_STORAGE) return undefined
    return prepare().then(() => ({ ready: true }))
  })
}

export const requestBrowserSyncStoragePreparation = async (runtime: RuntimeApi = runtimeApi()): Promise<void> => {
  const response = await runtime.sendMessage(PREPARE_BROWSER_SYNC_STORAGE)

  if (typeof response === 'object' && response !== null && 'ready' in response) {
    if ((response as { ready: unknown }).ready === true) return
  }

  throw new Error('Browser sync configuration preparation unavailable')
}
