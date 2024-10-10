import { Remesh } from 'remesh'

export type StorageValue = null | string | number | boolean | object
export type WatchCallback = () => any
export type Unwatch = () => Promise<void>

export interface Storage {
  name: string
  get: <T extends StorageValue>(key: string) => Promise<T | null>
  set: <T extends StorageValue>(key: string, value: T) => Promise<void>
  remove: (key: string) => Promise<void>
  clear: () => Promise<void>
  watch: (callback: WatchCallback) => Promise<Unwatch>
  unwatch: Unwatch
}

export const LocalStorageExtern = Remesh.extern<Storage>({
  default: {
    name: 'STORAGE',
    get: async () => {
      throw new Error('"get" not implemented.')
    },
    set: async () => {
      throw new Error('"set" not implemented.')
    },
    remove: async () => {
      throw new Error('"remove" not implemented.')
    },
    clear: async () => {
      throw new Error('"clear" not implemented.')
    },
    watch: async () => {
      throw new Error('"watch" not implemented.')
    },
    unwatch: async () => {
      throw new Error('"unwatch" not implemented.')
    }
  }
})

export const IndexDBStorageExtern = Remesh.extern<Storage>({
  default: {
    name: 'STORAGE',
    get: async () => {
      throw new Error('"get" not implemented.')
    },
    set: async () => {
      throw new Error('"set" not implemented.')
    },
    remove: async () => {
      throw new Error('"remove" not implemented.')
    },
    clear: async () => {
      throw new Error('"clear" not implemented.')
    },
    watch: async () => {
      throw new Error('"watch" not implemented.')
    },
    unwatch: async () => {
      throw new Error('"unwatch" not implemented.')
    }
  }
})

export const BrowserSyncStorageExtern = Remesh.extern<Storage>({
  default: {
    name: 'STORAGE',
    get: async () => {
      throw new Error('"get" not implemented.')
    },
    set: async () => {
      throw new Error('"set" not implemented.')
    },
    remove: async () => {
      throw new Error('"remove" not implemented.')
    },
    clear: async () => {
      throw new Error('"clear" not implemented.')
    },
    watch: async () => {
      throw new Error('"watch" not implemented.')
    },
    unwatch: async () => {
      throw new Error('"unwatch" not implemented.')
    }
  }
})
