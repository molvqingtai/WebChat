import { get, set } from 'idb-keyval'
import StorageExtern from '@/domain/externs/Storage'
import { STORAGE_NAME } from '@/constants'

const StorageImpl = StorageExtern.impl({
  name: STORAGE_NAME,
  get,
  set
})

export default StorageImpl
