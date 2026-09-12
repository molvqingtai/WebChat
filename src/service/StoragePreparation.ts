import { browser } from '#imports'
import { CONFIG_STORE_VERSION, CONFIG_STORE_VERSION_KEY } from '@/constants/storage'
import { withPreparationLock } from '@/utils/withPreparationLock'

const PREPARE_BROWSER_SYNC_STORAGE = 'WEB_CHAT_PREPARE_BROWSER_SYNC_STORAGE_V1'

interface StorageArea {
  // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- raw browser storage records at this boundary
  get(key: string): Promise<Record<string, unknown>>
  // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- raw browser storage records at this boundary
  set(values: Record<string, unknown>): Promise<void>
  clear(): Promise<void>
}

interface RuntimeApi {
  readonly id: string
  readonly onInstalled: {
    addListener(listener: () => Promise<void>): void
  }
  readonly onMessage: {
    // oxlint-disable-next-line anti-slop/no-unknown-parameters -- runtime messages are untyped at this boundary
    addListener(listener: (message: unknown) => Promise<{ readonly ready: boolean }> | undefined): void
  }
  // oxlint-disable-next-line anti-slop/no-unknown-parameters, anti-slop/no-unknown-returns -- runtime messages are untyped at this boundary
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

const runtimeApi = () => {
  // SAFETY: browser.runtime is the extension runtime object; widen once before re-narrowing.
  const raw = browser.runtime as unknown
  // SAFETY: raw is the browser.runtime object narrowed to the RuntimeApi contract used here.
  return raw as RuntimeApi
}
const syncStorage = () => {
  // SAFETY: browser.storage.sync is the extension sync area; widen once before re-narrowing.
  const raw = browser.storage.sync as unknown
  // SAFETY: raw is the browser.storage.sync area narrowed to the StorageArea contract used here.
  return raw as StorageArea
}

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

  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- structural discrimination of the runtime response
  if (typeof response === 'object' && response !== null && 'ready' in response) {
    // SAFETY: the `in` probe above established that this object carries a `ready` field.
    const ready = (response as { ready: unknown }).ready
    if (ready === true) return
  }

  throw new Error('Browser sync configuration preparation unavailable')
}
