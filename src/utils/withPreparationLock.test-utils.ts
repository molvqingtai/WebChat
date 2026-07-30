import { vi } from 'vitest'

interface TestLockManagerOptions {
  beforeGrant?: (name: string, request: number) => Promise<void> | void
}

export const createTestLockManager = ({ beforeGrant }: TestLockManagerOptions = {}): Pick<LockManager, 'request'> => {
  const tails = new Map<string, Promise<void>>()
  const requests = new Map<string, number>()

  const request = async <Result>(name: string, callback: (lock: Lock) => PromiseLike<Result> | Result) => {
    const previous = tails.get(name) ?? Promise.resolve()
    const requestNumber = (requests.get(name) ?? 0) + 1
    requests.set(name, requestNumber)

    const operation = previous.then(async () => {
      await beforeGrant?.(name, requestNumber)
      return callback({ name, mode: 'exclusive' } as Lock)
    })
    const completion = operation.then(
      () => undefined,
      () => undefined
    )
    tails.set(name, completion)
    void completion.then(() => {
      if (tails.get(name) === completion) tails.delete(name)
    })
    return operation
  }

  return { request: request as LockManager['request'] }
}

export const installTestWebLocks = (options?: TestLockManagerOptions) => {
  const locks = createTestLockManager(options)
  vi.stubGlobal('navigator', { locks })
  return locks
}
