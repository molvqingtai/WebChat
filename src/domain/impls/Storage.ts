import { createStorage } from 'unstorage'
import localStorageDriver from 'unstorage/drivers/localstorage'
import { LocalStorageExtern, BrowserSyncStorageExtern } from '@/domain/externs/Storage'
import {
  APP_OPEN_STORAGE_KEY,
  APP_POSITION_STORAGE_KEY,
  APP_MESSAGE_AUTHOR_STORAGE_KEY,
  APP_UNREAD_STORAGE_KEY,
  CONFIG_STORE_VERSION,
  CONFIG_STORE_VERSION_KEY,
  STORAGE_NAME
} from '@/constants/storage'
import webExtensionDriver from '@/utils/webExtensionDriver'
import { withPreparationLock, type PreparationLockCoordinator } from '@/utils/withPreparationLock'
import type { Storage } from '@/domain/externs/Storage'

export interface ConfigurationVersionStorage {
  readVersion(): Promise<{ readonly exists: boolean; readonly value: unknown }>
  writeVersion(version: number): Promise<void>
  clear(): Promise<void>
}

export const prepareConfigurationStorage = (
  identity: string,
  storage: ConfigurationVersionStorage,
  coordinator?: PreparationLockCoordinator
): Promise<void> =>
  withPreparationLock(
    `configuration:${identity}`,
    async (lock) => {
      try {
        const stored = await lock.read(storage.readVersion())
        if (!stored.exists) {
          await lock.write(() => storage.writeVersion(CONFIG_STORE_VERSION))
          lock.checkpoint()
          return
        }
        if (stored.value === CONFIG_STORE_VERSION) return

        await lock.write(() => storage.clear())
        lock.checkpoint()
        await lock.write(() => storage.writeVersion(CONFIG_STORE_VERSION))
        lock.checkpoint()
      } catch (error) {
        if (lock.signal.aborted) throw error
        console.error('[WebChat] Configuration store preparation failed')
        throw new Error('Configuration store preparation failed')
      }
    },
    coordinator
  )

/**
 * Waiting to be resolved
 * @see https://github.com/unjs/unstorage/issues/277
 */
const localStorage = createStorage({
  driver: localStorageDriver({ base: `${STORAGE_NAME}:`, window: globalThis.window })
})

const browserSyncStorage = createStorage({
  driver: webExtensionDriver({ storageArea: 'sync' })
})

const clearVersionManagedLocalConfiguration = async () => {
  const keys = await localStorage.getKeys()
  const removable = keys.filter(
    (key) =>
      key !== APP_OPEN_STORAGE_KEY &&
      key !== APP_POSITION_STORAGE_KEY &&
      key !== APP_UNREAD_STORAGE_KEY &&
      key !== APP_MESSAGE_AUTHOR_STORAGE_KEY
  )
  // functional-loop: owner-commit — ordered per-key storage removal with no bulk primitive
  for (const key of removable) {
    await localStorage.removeItem(key)
  }
}

export const prepareLocalConfigurationStorage = (coordinator?: PreparationLockCoordinator): Promise<void> =>
  prepareConfigurationStorage(
    `origin-local:${globalThis.location?.origin ?? 'headless'}`,
    {
      async readVersion() {
        const exists = await localStorage.hasItem(CONFIG_STORE_VERSION_KEY)
        return {
          exists,
          value: exists ? await localStorage.getItem(CONFIG_STORE_VERSION_KEY) : undefined
        }
      },
      writeVersion: (version) => localStorage.setItem(CONFIG_STORE_VERSION_KEY, version),
      clear: clearVersionManagedLocalConfiguration
    },
    coordinator
  )

export const LocalStorageImpl = LocalStorageExtern.impl({
  get: localStorage.getItem,
  set: localStorage.setItem,
  watch: localStorage.watch as Storage['watch']
})

export const BrowserSyncStorageImpl = BrowserSyncStorageExtern.impl({
  get: browserSyncStorage.getItem,
  set: browserSyncStorage.setItem,
  watch: browserSyncStorage.watch as Storage['watch']
})
