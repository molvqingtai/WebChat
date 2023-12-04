import { Observable } from 'rxjs'
import { type Storage } from '@/domain/externs/Storage'

const storageToObservable = (storage: Storage) => {
  return new Observable((subscriber) => {
    storage.watch((event) => {
      subscriber.next(event)
    })
    return () => {
      storage.unwatch()
    }
  })
}

export default storageToObservable
