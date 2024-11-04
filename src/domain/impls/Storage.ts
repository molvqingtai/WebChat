import { createStorage } from 'unstorage'
import indexedDbDriver from 'unstorage/drivers/indexedb'
import localStorageDriver from 'unstorage/drivers/localstorage'
import { LocalStorageExtern, IndexDBStorageExtern, BrowserSyncStorageExtern } from '@/domain/externs/Storage'
import { STORAGE_NAME } from '@/constants/config'
import { webExtensionDriver } from '@/utils/webExtensionDriver'

import { Storage } from '@/domain/externs/Storage'
import { EVENT } from '@/constants/event'
import { JSONR } from '@/utils'

export const localStorage = createStorage({
  driver: localStorageDriver({ base: `${STORAGE_NAME}:` })
})

export const indexDBStorage = createStorage({
  driver: indexedDbDriver({ base: `${STORAGE_NAME}:` })
})

export const browserSyncStorage = createStorage({
  driver: webExtensionDriver({ storageArea: 'sync' })
})

export const LocalStorageImpl = LocalStorageExtern.impl({
  name: STORAGE_NAME,
  get: async (key) => JSONR.parse(await localStorage.getItem(key)),
  set: (key, value) => localStorage.setItem(key, JSONR.stringify(value)!),
  remove: localStorage.removeItem,
  clear: localStorage.clear,
  watch: async (callback) => {
    const unwatch = await localStorage.watch(callback)

    /**
     * Because the storage event cannot be triggered in the same browsing context
     * it is necessary to listen for click events from DanmukuMessage.
     * @see https://developer.mozilla.org/en-US/docs/Web/API/Window/storage_event
     */
    addEventListener(EVENT.APP_OPEN, callback)
    return async () => {
      removeEventListener(EVENT.APP_OPEN, callback)
      return unwatch()
    }
  },
  unwatch: localStorage.unwatch
})

export const IndexDBStorageImpl = IndexDBStorageExtern.impl({
  name: STORAGE_NAME,
  get: async (key) => JSONR.parse(await indexDBStorage.getItem(key)),
  set: (key, value) => indexDBStorage.setItem(key, JSONR.stringify(value)),
  remove: indexDBStorage.removeItem,
  clear: indexDBStorage.clear,
  watch: indexDBStorage.watch as Storage['watch'],
  unwatch: indexDBStorage.unwatch
})

export const BrowserSyncStorageImpl = BrowserSyncStorageExtern.impl({
  name: STORAGE_NAME,
  get: async (key) => {
    const value: any = await browserSyncStorage.getItem(key)
    // Compatibility with old version data
    try {
      return JSONR.parse(value)
    } catch {
      return value
    }
  },
  set: (key, value) => browserSyncStorage.setItem(key, JSONR.stringify(value)),
  remove: browserSyncStorage.removeItem,
  clear: browserSyncStorage.clear,
  watch: browserSyncStorage.watch as Storage['watch'],
  unwatch: browserSyncStorage.unwatch
})
