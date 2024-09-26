import { type RemeshEvent, type RemeshAction, type RemeshDomainContext, type RemeshExtern } from 'remesh'
import { defer, from, fromEventPattern, map, Observable, switchMap } from 'rxjs'
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
        return fromEvent(event).pipe(
          switchMap(async (value) => {
            await this.storage.set(this.key, value)
            return null
          })
        )
      }
    })
    return this
  }

  watch<T extends StorageValue>(callback: (value: T | null) => RemeshAction) {
    this.domain.effect({
      name: 'WatchStorageToStateEffect',
      impl: () => {
        return defer(() => {
          let unwatch: Unwatch
          return new Observable<void>((observer) => {
            this.storage
              .watch(() => observer.next())
              .then((_unwatch) => {
                unwatch = _unwatch
              })
            return () => unwatch?.()
          }).pipe(
            switchMap(() => from(this.storage.get<T | null>(this.key))),
            map(callback)
          )
        })
      }
    })
    return this
  }
}
