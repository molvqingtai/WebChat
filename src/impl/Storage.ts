import { createStorage } from 'unstorage'
import indexedDbDriver from 'unstorage/drivers/indexedb'
import { IndexDBStorageExtern, BrowserSyncStorageExtern } from '@/domain/externs/Storage'
import { STORAGE_NAME } from '@/constants'
import { webExtensionDriver } from '@/utils/webExtensionDriver'

const indexDBStorage = createStorage({
  driver: indexedDbDriver({ base: `${STORAGE_NAME}:` })
})

const browserSyncStorage = createStorage({
  driver: webExtensionDriver({ storageArea: 'sync' })
})

export const IndexDBStorageImpl = IndexDBStorageExtern.impl({
  name: STORAGE_NAME,
  get: indexDBStorage.getItem,
  set: indexDBStorage.setItem,
  remove: indexDBStorage.removeItem,
  clear: indexDBStorage.clear,
  watch: indexDBStorage.watch,
  unwatch: indexDBStorage.unwatch
})

export const BrowserSyncStorageImpl = BrowserSyncStorageExtern.impl({
  name: STORAGE_NAME,
  get: browserSyncStorage.getItem,
  set: browserSyncStorage.setItem,
  remove: browserSyncStorage.removeItem,
  clear: browserSyncStorage.clear,
  watch: browserSyncStorage.watch,
  unwatch: browserSyncStorage.unwatch
})
