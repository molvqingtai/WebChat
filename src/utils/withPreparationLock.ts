export interface PreparationLock {
  readonly signal: AbortSignal
  read<Value>(operation: Promise<Value>): Promise<Value>
  write<Value>(operation: () => Promise<Value>): Promise<Value>
  checkpoint(): void
}

interface PreparationCompletion {
  readonly promise: Promise<void>
  readonly resolve: () => void
  readonly reject: (reason: unknown) => void
}

interface PreparationGeneration {
  readonly controller: AbortController
  readonly completion: PreparationCompletion
}

type PreparationOutcome = { readonly status: 'resolved' } | { readonly status: 'rejected'; readonly error: unknown }

const preparations = new Map<string, PreparationGeneration>()

const createCompletion = (): PreparationCompletion => {
  let resolve!: () => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<void>((onResolve, onReject) => {
    resolve = onResolve
    reject = onReject
  })
  return { promise, resolve, reject }
}

const abortReason = (signal: AbortSignal): unknown =>
  signal.reason ?? new DOMException('Persistence preparation superseded', 'AbortError')

const raceWithSignal = <Value>(operation: Promise<Value>, signal: AbortSignal): Promise<Value> =>
  new Promise<Value>((resolve, reject) => {
    let settled = false
    const finish = (callback: () => void) => {
      if (settled) return
      settled = true
      signal.removeEventListener('abort', onAbort)
      callback()
    }
    const onAbort = () => finish(() => reject(abortReason(signal)))
    signal.addEventListener('abort', onAbort, { once: true })
    operation.then(
      (value) => finish(() => resolve(value)),
      (error) => finish(() => reject(error))
    )
    if (signal.aborted) onAbort()
  })

const settleGeneration = (identity: string, generation: PreparationGeneration, outcome: PreparationOutcome): void => {
  if (preparations.get(identity) !== generation) return
  preparations.delete(identity)
  if (outcome.status === 'resolved') generation.completion.resolve()
  else generation.completion.reject(outcome.error)
}

export const withPreparationLock = (
  identity: string,
  prepare: (lock: PreparationLock) => Promise<void>
): Promise<void> => {
  const current = preparations.get(identity)
  const completion = current?.completion ?? createCompletion()
  const generation: PreparationGeneration = {
    controller: new AbortController(),
    completion
  }
  preparations.set(identity, generation)
  current?.controller.abort(new DOMException('Persistence preparation superseded', 'AbortError'))

  const signal = generation.controller.signal
  const lock: PreparationLock = {
    signal,
    read: (operation) => raceWithSignal(operation, signal),
    // Once a write starts, retain the physical Web Lock until that write settles.
    write: async (operation) => {
      signal.throwIfAborted()
      return operation()
    },
    checkpoint: () => signal.throwIfAborted()
  }
  const preparation = Promise.resolve().then(() => {
    signal.throwIfAborted()
    const locks = typeof navigator === 'undefined' ? undefined : navigator.locks
    if (!locks) {
      console.error('[WebChat] Persistence preparation coordination unavailable')
      throw new Error('Persistence preparation coordination unavailable')
    }
    return locks.request(`webchat-persistence:${identity}`, async () => {
      signal.throwIfAborted()
      await prepare(lock)
      signal.throwIfAborted()
    })
  })
  void preparation.then(
    () => settleGeneration(identity, generation, { status: 'resolved' }),
    (error: unknown) => settleGeneration(identity, generation, { status: 'rejected', error })
  )
  return completion.promise
}
