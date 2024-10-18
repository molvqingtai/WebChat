import { type RemeshEvent, type RemeshAction, type RemeshDomainContext, type RemeshExtern } from 'remesh'
import { from, map, Observable, switchMap } from 'rxjs'

import { Storage, StorageValue } from '@/domain/externs/Storage'

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
        // TODO: Report the bug to https://github.com/unjs/unstorage
        return new Observable((observer) => {
          const unwatchPromise = this.storage.watch(() => observer.next())
          return () => unwatchPromise.then((unwatch) => unwatch())
        }).pipe(
          switchMap(() => from(this.storage.get<T | null>(this.key))),
          map(callback)
        )
      }
    })
    return this
  }
}
