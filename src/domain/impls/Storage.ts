import { createStorage } from 'unstorage'
import indexedDbDriver from 'unstorage/drivers/indexedb'
import localStorageDriver from 'unstorage/drivers/localstorage'
import { LocalStorageExtern, IndexDBStorageExtern, BrowserSyncStorageExtern } from '@/domain/externs/Storage'
import { STORAGE_NAME } from '@/constants/config'
import { webExtensionDriver } from '@/utils/webExtensionDriver'
import { browser } from 'wxt/browser'
import { Storage } from '@/domain/externs/Storage'

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
  watch: localStorage.watch as Storage['watch'],
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

// export const BrowserSyncStorageImpl = BrowserSyncStorageExtern.impl({
//   name: STORAGE_NAME,
//   get: async (key: string) => {
//     const res = await browser.storage.sync.get(key)
//     return res[key] ?? null
//   },
//   set: async (key, value) => {
//     await browser.storage.sync.set({ [key]: value ?? null })
//   },
//   remove: browserSyncStorage.removeItem,
//   clear: browserSyncStorage.clear,
//   watch: async (callback) => {
//     browser.storage.sync.onChanged.addListener(callback)
//     return async () => {
//       return browser.storage.sync.onChanged.removeListener(callback)
//     }
//   },
//   unwatch: browserSyncStorage.unwatch
// })
