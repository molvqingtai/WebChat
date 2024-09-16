import { type RemeshEvent, type RemeshAction, type RemeshDomainContext, type RemeshExtern } from 'remesh'
import { from, fromEventPattern, map, merge, switchMap, tap } from 'rxjs'
import { type Promisable } from 'type-fest'

export type StorageValue = null | string | number | boolean | object
export type WatchEvent = 'update' | 'remove'
export type WatchCallback = (event: WatchEvent, key: string) => any
export type Unwatch = () => Promisable<void>

export interface Storage {
  get: <T extends StorageValue>(key: string) => Promise<T | null>
  set: <T extends StorageValue>(key: string, value: T) => Promise<void>
  watch: (callback: WatchCallback) => Promise<Unwatch>
  unwatch?: Unwatch
}

export interface Options {
  domain: RemeshDomainContext
  extern: RemeshExtern<Storage>
  key: string
}

export default class StorageEffect {
  domain: RemeshDomainContext
  key: string
  storage: Storage

  constructor(options: Options) {
    this.domain = options.domain
    this.key = options.key
    this.storage = options.domain.getExtern(options.extern)
  }

  get<T extends StorageValue>(callback: (value: T | null) => RemeshAction) {
    this.domain.effect({
      name: 'FormStorageToStateEffect',
      impl: () => {
        return from(this.storage.get<T>(this.key)).pipe(map((value) => callback(value)))
      }
    })
    return this
  }

  set<T extends StorageValue, U extends RemeshEvent<any, T>>(event: U) {
    this.domain.effect({
      name: 'FormStateToStorageEffect',
      impl: ({ fromEvent }) => {
        const changeUserInfo$ = fromEvent(event).pipe(
          tap(async (value) => {
            return await this.storage.set(this.key, value)
          })
        )
        return merge(changeUserInfo$).pipe(map(() => null))
      }
    })
    return this
  }

  watch<T extends StorageValue>(callback: (value: T | null) => RemeshAction) {
    this.domain.effect({
      name: 'WatchStorageToStateEffect',
      impl: () => {
        return fromEventPattern(this.storage.watch, this.storage.unwatch).pipe(
          switchMap(() => {
            return from(this.storage.get<T>(this.key)).pipe(map((value) => callback(value)))
          })
        )
      }
    })
    return this
  }
}
