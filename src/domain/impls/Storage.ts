import { createStorage } from 'unstorage'
import localStorageDriver from 'unstorage/drivers/localstorage'
import { LocalStorageExtern, BrowserSyncStorageExtern } from '@/domain/externs/Storage'
import { STORAGE_NAME } from '@/constants/config'
import webExtensionDriver from '@/utils/webExtensionDriver'
import type { Storage } from '@/domain/externs/Storage'
import { EVENT } from '@/constants/event'

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
