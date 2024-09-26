import { Observable } from 'rxjs'

export type Subscribe<T> = (callback: (event: T) => void) => void

const fromEventPattern = <T>(subscribe: Subscribe<T>, unsubscribe?: () => void) => {
  return new Observable<T>((subscriber) => {
    subscribe((event: T) => {
      subscriber.next(event)
    })

    return () => {
      unsubscribe?.()
      subscriber.complete()
    }
  })
}

export default fromEventPattern
