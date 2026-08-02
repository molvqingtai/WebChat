export interface PreparationLock {
  readonly signal: AbortSignal
  read<Value>(operation: Promise<Value>): Promise<Value>
  write<Value>(operation: () => Promise<Value>): Promise<Value>
  checkpoint(): void
}

/**
 * Cross-context mutual exclusion for persistence preparation. Acquiring returns the release callback; the
 * implementation decides whether arbitration is local (Web Locks) or delegated (background-mediated).
 */
export interface PreparationLockCoordinator {
  acquire(identity: string): Promise<() => void>
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

/**
 * Web Locks arbitration. Firefox content scripts cannot assimilate the page-realm lock Promise
 * (`Permission denied to access property "then"`), so those contexts delegate arbitration to the
 * background-mediated coordinator instead.
 */
export const createWebLocksPreparationCoordinator = (
  lockManager?: Pick<LockManager, 'request'>
): PreparationLockCoordinator => ({
  acquire: (identity) =>
    new Promise<() => void>((resolve, reject) => {
      const locks = lockManager ?? (typeof navigator === 'undefined' ? undefined : navigator.locks)
      if (!locks) {
        console.error('[WebChat] Persistence preparation coordination unavailable')
        reject(new Error('Persistence preparation coordination unavailable'))
        return
      }
      let release!: () => void
      const gate = new Promise<void>((grantRelease) => {
        release = grantRelease
      })
      void locks
        .request(`webchat-persistence:${identity}`, () => {
          resolve(() => release())
          return gate
        })
        .then(undefined, reject)
    })
})

/**
 * No cross-context arbitration: preparation runs directly and relies on versioned idempotent writes for
 * cross-tab convergence. Used by Firefox content scripts where Web Locks cannot cross the Xray boundary
 * (<https://bugzilla.mozilla.org/show_bug.cgi?id=1873028>).
 */
export const createDirectPreparationCoordinator = (): PreparationLockCoordinator => ({
  acquire: () => Promise.resolve(() => {})
})

export const withPreparationLock = (
  identity: string,
  prepare: (lock: PreparationLock) => Promise<void>,
  coordinator: PreparationLockCoordinator = createWebLocksPreparationCoordinator()
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
    // Once a write starts, retain the physical lock until that write settles.
    write: async (operation) => {
      signal.throwIfAborted()
      return operation()
    },
    checkpoint: () => signal.throwIfAborted()
  }
  const preparation = Promise.resolve().then(async () => {
    signal.throwIfAborted()
    const release = await coordinator.acquire(identity)
    try {
      signal.throwIfAborted()
      await prepare(lock)
      signal.throwIfAborted()
    } finally {
      release()
    }
  })
  void preparation.then(
    () => settleGeneration(identity, generation, { status: 'resolved' }),
    (error: unknown) => settleGeneration(identity, generation, { status: 'rejected', error })
  )
  return completion.promise
}
