import { Observable } from 'rxjs'

export type Subscribe<T> = (callback: (event: T) => void) => void

const callbackToObservable = <T>(subscribe: Subscribe<T>, unsubscribe?: () => void) => {
  return new Observable((subscriber) => {
    subscribe((event: T) => {
      subscriber.next(event)
    })

    return () => {
      unsubscribe?.()
      subscriber.complete()
    }
  })
}

export default callbackToObservable
