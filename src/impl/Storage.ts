import indexedDbDriver from 'unstorage/drivers/indexedb'
import StorageExtern from '@/domain/externs/Storage'
import { STORAGE_NAME } from '@/constants'

const browserLocalStorage = createStorage({
  driver: webExtensionDriver({ storageArea: 'local' })
})

const indexDBStorage = createStorage({
  driver: indexedDbDriver({ base: `${STORAGE_NAME}:` })
})

export const StorageIndexDBImpl = StorageExtern.impl({
  name: STORAGE_NAME,
  get: indexDBStorage.getItem,
  set: indexDBStorage.setItem,
  clear: indexDBStorage.clear
})

export const StorageBrowserLocalImpl = StorageExtern.impl({
  name: STORAGE_NAME,
  get: browserLocalStorage.getItem,
  set: browserLocalStorage.setItem,
  clear: browserLocalStorage.clear
})
