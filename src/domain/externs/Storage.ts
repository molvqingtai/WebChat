import { Remesh } from 'remesh'

export type StorageValue = null | string | number | boolean | object

export interface Storage {
  name: string
  get: <T extends StorageValue>(key: string) => Promise<T | null>
  set: <T extends StorageValue>(key: string, value: T) => Promise<void>
  clear: () => Promise<void>
}

const StorageExtern = Remesh.extern<Storage>({
  default: {
    name: 'STORAGE',
    get: async () => {
      throw new Error('"get" not implemented')
    },
    set: async () => {
      throw new Error('"set" not implemented')
    },
    clear: async () => {
      throw new Error('"clear" not implemented')
    }
  }
})

export default StorageExtern
