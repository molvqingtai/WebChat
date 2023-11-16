import indexedDbDriver from 'unstorage/drivers/indexedb'
import StorageExtern from '@/domain/externs/Storage'
import { STORAGE_NAME } from '@/constants'

const indexDBStorage = createStorage({
  driver: indexedDbDriver({ base: `${STORAGE_NAME}:` })
})

const browserSyncStorage = createStorage({
  driver: webExtensionDriver({ storageArea: 'sync' })
})

export const StorageIndexDBImpl = StorageExtern.impl({
  name: STORAGE_NAME,
  get: indexDBStorage.getItem,
  set: indexDBStorage.setItem,
  clear: indexDBStorage.clear
})

export const StorageBrowserSyncImpl = StorageExtern.impl({
  name: STORAGE_NAME,
  get: browserSyncStorage.getItem,
  set: browserSyncStorage.setItem,
  clear: browserSyncStorage.clear
})
