import { Remesh } from 'remesh'
import { type Promisable } from 'type-fest'

export type StorageValue = null | string | number | boolean | object
export type WatchEvent = 'update' | 'remove'
export type WatchCallback = (event: WatchEvent, key: string) => any
export type Unwatch = () => Promisable<void>

export interface Storage {
  name: string
  get: <T extends StorageValue>(key: string) => Promise<T | null>
  set: <T extends StorageValue>(key: string, value: T) => Promise<void>
  remove: (key: string) => Promise<void>
  clear: () => Promise<void>
  watch: (callback: WatchCallback) => Promise<Unwatch>
  unwatch: Unwatch
}

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
    watch: () => {
      throw new Error('"watch" not implemented.')
    },
    unwatch: () => {
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
    watch: () => {
      throw new Error('"watch" not implemented.')
    },
    unwatch: () => {
      throw new Error('"unwatch" not implemented.')
    }
  }
})
