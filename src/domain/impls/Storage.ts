import { createStorage } from 'unstorage'
import indexedDbDriver from 'unstorage/drivers/indexedb'
import localStorageDriver from 'unstorage/drivers/localstorage'
import { LocalStorageExtern, IndexDBStorageExtern, BrowserSyncStorageExtern } from '@/domain/externs/Storage'
import { STORAGE_NAME } from '@/constants/config'
import { webExtensionDriver } from '@/utils/webExtensionDriver'

import { Storage } from '@/domain/externs/Storage'
import { EVENT } from '@/constants/event'

/**
 * Waiting to be resolved
 * @see https://github.com/unjs/unstorage/issues/277
 * */

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
  get: localStorage.getItem,
  set: localStorage.setItem,
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
  get: indexDBStorage.getItem,
  set: indexDBStorage.setItem,
  remove: indexDBStorage.removeItem,
  clear: indexDBStorage.clear,
  watch: indexDBStorage.watch as Storage['watch'],
  unwatch: indexDBStorage.unwatch
})

export const BrowserSyncStorageImpl = BrowserSyncStorageExtern.impl({
  name: STORAGE_NAME,
  get: browserSyncStorage.getItem,
  set: browserSyncStorage.setItem,
  remove: browserSyncStorage.removeItem,
  clear: browserSyncStorage.clear,
  watch: browserSyncStorage.watch as Storage['watch'],
  unwatch: browserSyncStorage.unwatch
})
