import { Remesh } from 'remesh'

export interface Storage {
  name: string
  get: <T>(key: string) => Promise<T | undefined>
  set: <T>(key: string, value: T) => Promise<void>
}

const StorageExtern = Remesh.extern<Storage>({
  default: {
    name: 'STORAGE',
    get: async () => {
      throw new Error('"get" not implemented')
    },
    set: async () => {
      throw new Error('"set" not implemented')
    }
  }
})

export default StorageExtern
