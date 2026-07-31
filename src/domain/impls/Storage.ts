import { createStorage } from 'unstorage'
import localStorageDriver from 'unstorage/drivers/localstorage'
import { LocalStorageExtern, BrowserSyncStorageExtern } from '@/domain/externs/Storage'
import {
  APP_STATUS_STORAGE_KEY,
  CONFIG_STORE_VERSION,
  CONFIG_STORE_VERSION_KEY,
  STORAGE_NAME
} from '@/constants/storage'
import webExtensionDriver from '@/utils/webExtensionDriver'
import { withPreparationLock } from '@/utils/withPreparationLock'
import type { Storage } from '@/domain/externs/Storage'
import { EVENT } from '@/constants/event'

export interface ConfigurationVersionStorage {
  readVersion(): Promise<{ readonly exists: boolean; readonly value: unknown }>
  writeVersion(version: number): Promise<void>
  clear(): Promise<void>
}

export const prepareConfigurationStorage = (identity: string, storage: ConfigurationVersionStorage): Promise<void> =>
  withPreparationLock(`configuration:${identity}`, async (lock) => {
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
  })

/**
 * Waiting to be resolved
 * @see https://github.com/unjs/unstorage/issues/277
 */
const localStorage = createStorage({
  driver: localStorageDriver({ base: `${STORAGE_NAME}:` })
})

const browserSyncStorage = createStorage({
  driver: webExtensionDriver({ storageArea: 'sync' })
})

const clearVersionManagedLocalConfiguration = async () => {
  const keys = await localStorage.getKeys()
  await Promise.all(keys.filter((key) => key !== APP_STATUS_STORAGE_KEY).map((key) => localStorage.removeItem(key)))
}

export const prepareLocalConfigurationStorage = (): Promise<void> =>
  prepareConfigurationStorage(`origin-local:${globalThis.location?.origin ?? 'headless'}`, {
    async readVersion() {
      const exists = await localStorage.hasItem(CONFIG_STORE_VERSION_KEY)
      return {
        exists,
        value: exists ? await localStorage.getItem(CONFIG_STORE_VERSION_KEY) : undefined
      }
    },
    writeVersion: (version) => localStorage.setItem(CONFIG_STORE_VERSION_KEY, version),
    clear: clearVersionManagedLocalConfiguration
  })

export const LocalStorageImpl = LocalStorageExtern.impl({
  get: localStorage.getItem,
  set: localStorage.setItem,
  watch: async (callback) => {
    const unwatch = await localStorage.watch(callback)

    /**
     * The storage event does not fire in the same browsing context, so
     * DanmakuMessage clicks provide the local synchronization signal.
     * @see https://developer.mozilla.org/en-US/docs/Web/API/Window/storage_event
     */
    addEventListener(EVENT.APP_OPEN, callback)
    return async () => {
      removeEventListener(EVENT.APP_OPEN, callback)
      return unwatch()
    }
  }
})

export const BrowserSyncStorageImpl = BrowserSyncStorageExtern.impl({
  get: browserSyncStorage.getItem,
  set: browserSyncStorage.setItem,
  watch: browserSyncStorage.watch as Storage['watch']
})
