import { Remesh } from 'remesh'

export type StorageValue = null | string | number | boolean | object
export type WatchCallback = () => unknown
export type Unwatch = () => Promise<void>

export interface Storage {
  get: <T extends StorageValue>(key: string) => Promise<T | null>
  set: <T extends StorageValue>(key: string, value: T) => Promise<void>
  watch: (callback: WatchCallback) => Promise<Unwatch>
}

const defaultStorage: Storage = {
  get: async () => {
    throw new Error('"get" not implemented.')
  },
  set: async () => {
    throw new Error('"set" not implemented.')
  },
  watch: async () => {
    throw new Error('"watch" not implemented.')
  }
}

export const LocalStorageExtern = Remesh.extern<Storage>({ default: defaultStorage })
export const BrowserSyncStorageExtern = Remesh.extern<Storage>({ default: defaultStorage })
