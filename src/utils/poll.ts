export interface PollOptions {
  timeoutMs: number
  intervalMs: number
  signal?: AbortSignal
}

/**
 * Repeats an async attempt until it resolves, waiting `intervalMs` between
 * failures and rethrowing the last error once `timeoutMs` is exhausted.
 * Used to ride out transient failures during cold starts.
 */
const wait = (delayMs: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = globalThis.setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, delayMs)
    const onAbort = () => {
      globalThis.clearTimeout(timer)
      reject(signal?.reason ?? new DOMException('Aborted', 'AbortError'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })

const poll = async <T>(attempt: () => Promise<T>, options: PollOptions): Promise<T> => {
  const deadline = Date.now() + options.timeoutMs
  for (;;) {
    options.signal?.throwIfAborted()
    try {
      return await attempt()
    } catch (error) {
      options.signal?.throwIfAborted()
      if (Date.now() + options.intervalMs > deadline) throw error
      await wait(options.intervalMs, options.signal)
    }
  }
}

export default poll
