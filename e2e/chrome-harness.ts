export type OwnedProcess = {
  pid: number
  command: string
}

type WebSocketLike = {
  addEventListener: (type: string, listener: (event: any) => void, options?: { once?: boolean }) => void
  send: (message: string) => void
  close: () => void
}

type WebSocketConstructor = new (url: string) => WebSocketLike

type CdpMessage = {
  id?: number
  method?: string
  params: Record<string, any>
  sessionId: string
  result?: any
  error?: { code: number; message: string }
}

type CdpWaiter = {
  resolve: (value: any) => void
  reject: (error: unknown) => void
  timer: NodeJS.Timeout
}

type CdpClientOptions = {
  WebSocketImpl?: WebSocketConstructor
  requestTimeoutMs?: number
}

type CleanupState = {
  rootExited: boolean
  residualProcesses: OwnedProcess[]
}

export type CleanupFailureEvidence = {
  resource: string
  phase: string
  message: string
  deadlineAt: number
  remainingMs: number
}

export type CleanupAttempt = {
  resource: string
  phase: string
  run: (remainingMs: number) => unknown | PromiseLike<unknown>
}

export type ChromeTeardownOptions = {
  errors: CleanupFailureEvidence[]
  cleanupTimeoutMs: number
  hasCdp: () => boolean
  closeCdp: () => void
  closeBrowser: () => PromiseLike<unknown>
  waitForBrowserExit: (remainingMs: number) => PromiseLike<unknown>
  remainingAttempts: () => CleanupAttempt[]
  cleanupComplete: () => boolean
  now?: () => number
}

type CleanupOptions = {
  rootPid?: number
  isRootExited: () => boolean
  listOwnedProcesses: () => OwnedProcess[]
  signalProcessGroup: (pid: number, signal: NodeJS.Signals) => void
  signalProcess: (pid: number, signal: NodeJS.Signals) => void
  termTimeoutMs?: number
  killTimeoutMs?: number
  pollIntervalMs?: number
  sleep?: (durationMs: number) => Promise<unknown>
}

export const delay = (durationMs: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, durationMs))

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error))

export const readDevToolsActivePort = async (
  path: string,
  read: (path: string) => Promise<string>
): Promise<string | null> => {
  try {
    return (await read(path)).trim() || null
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return null
    throw error
  }
}

export const createProfileRemovalVerificationAttempt = (
  path: string,
  accessPath: (path: string) => PromiseLike<unknown>,
  setRemoved: (removed: boolean) => void
): CleanupAttempt => ({
  resource: 'profile',
  phase: 'verify-removed',
  run: async () => {
    setRemoved(false)
    try {
      await accessPath(path)
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
        setRemoved(true)
        return
      }
      throw error
    }
  }
})

export const waitFor = async <T>(
  check: () => T | null | undefined | false | Promise<T | null | undefined | false>,
  {
    timeoutMs,
    label,
    intervalMs = 100,
    retryErrors = true
  }: { timeoutMs: number; label: string; intervalMs?: number; retryErrors?: boolean }
): Promise<T> => {
  const startedAt = Date.now()
  let lastError: unknown
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const value = await check()
      if (value) return value
    } catch (error) {
      if (!retryErrors) throw error
      lastError = error
    }
    await delay(intervalMs)
  }
  throw new Error(`Timed out waiting for ${label}${lastError ? `: ${errorMessage(lastError)}` : ''}`)
}

export const waitForUniqueTarget = <Target>(
  candidates: () => readonly Target[] | Promise<readonly Target[]>,
  options: { timeoutMs: number; label: string; intervalMs?: number }
): Promise<Target> =>
  waitFor(async () => {
    const current = await candidates()
    return current.length === 0 ? null : current
  }, options).then((current) => {
    if (current.length !== 1) throw new Error(`Expected one ${options.label}, received ${current.length}`)
    return current[0]
  })

export const withDeadline = <T>(
  promise: PromiseLike<T> | T,
  timeoutMs: number,
  label: string,
  onTimeout: () => void = () => {}
): Promise<T> =>
  new Promise((resolve, reject) => {
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      try {
        onTimeout()
      } catch (error) {
        reject(error)
        return
      }
      reject(new Error(`Timed out waiting for ${label} after ${timeoutMs}ms`))
    }, timeoutMs)

    Promise.resolve(promise).then(
      (value) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        reject(error)
      }
    )
  })

export const appendCleanupFailure = (
  errors: CleanupFailureEvidence[],
  deadlineAt: number,
  resource: string,
  phase: string,
  error: unknown,
  now: () => number = Date.now
) => {
  errors.push({
    resource,
    phase,
    message: errorMessage(error),
    deadlineAt,
    remainingMs: Math.max(0, deadlineAt - now())
  })
}

export const runCleanupAttempts = async (
  attempts: CleanupAttempt[],
  errors: CleanupFailureEvidence[],
  deadlineAt: number,
  now: () => number = Date.now
) => {
  for (const attempt of attempts) {
    const remainingMs = Math.max(0, deadlineAt - now())
    if (remainingMs === 0) {
      appendCleanupFailure(
        errors,
        deadlineAt,
        attempt.resource,
        attempt.phase,
        new Error('Shared cleanup deadline exhausted'),
        now
      )
      continue
    }
    try {
      await withDeadline(
        Promise.resolve().then(() => attempt.run(remainingMs)),
        remainingMs,
        `${attempt.resource} ${attempt.phase}`
      )
    } catch (error) {
      appendCleanupFailure(errors, deadlineAt, attempt.resource, attempt.phase, error, now)
    }
  }
}

export const selectTerminalError = (runError: unknown, cleanupError: Error | undefined): unknown =>
  runError ?? cleanupError

export const createChromeTeardown = (options: ChromeTeardownOptions) => {
  const now = options.now ?? Date.now
  let deadlineAt: number | undefined
  const beginCleanup = () => (deadlineAt ??= now() + options.cleanupTimeoutMs)

  return {
    timeoutClose: () => {
      try {
        options.closeCdp()
      } catch (error) {
        appendCleanupFailure(options.errors, beginCleanup(), 'cdp', 'timeout-close', error, now)
      }
    },
    finish: async (runError: unknown) => {
      const attempts: CleanupAttempt[] = options.hasCdp()
        ? [
            {
              resource: 'browser',
              phase: 'browser-close',
              run: (remainingMs) => withDeadline(options.closeBrowser(), Math.min(1000, remainingMs), 'Browser.close')
            },
            { resource: 'cdp', phase: 'final-close', run: () => options.closeCdp() },
            {
              resource: 'browser',
              phase: 'graceful-exit',
              run: (remainingMs) => options.waitForBrowserExit(Math.min(1000, remainingMs))
            }
          ]
        : []
      await runCleanupAttempts([...attempts, ...options.remainingAttempts()], options.errors, beginCleanup(), now)
      const cleanupError =
        options.cleanupComplete() && options.errors.length === 0
          ? undefined
          : new Error('Owned Chromium cleanup failed')
      return { cleanupError, terminalError: selectTerminalError(runError, cleanupError) }
    }
  }
}

export const evaluateRuntimeMessage = <T>(
  evaluate: (expression: string) => Promise<T>,
  message: unknown
): Promise<T> => {
  const serialized = JSON.stringify(message)
  if (serialized === undefined) throw new TypeError('Runtime message must be JSON-serializable')
  return evaluate(`chrome.runtime.sendMessage(${serialized})`)
}

export class CdpClient {
  requestTimeoutMs: number
  socket: WebSocketLike
  nextId = 1
  pending = new Map<number, CdpWaiter>()
  handlers = new Set<(message: CdpMessage) => void>()

  constructor(url: string, options: CdpClientOptions = {}) {
    const WebSocketImpl = options.WebSocketImpl ?? (WebSocket as unknown as WebSocketConstructor)
    this.requestTimeoutMs = options.requestTimeoutMs ?? 5000
    this.socket = new WebSocketImpl(url)
    this.socket.addEventListener('message', ({ data }) => {
      const message = JSON.parse(String(data)) as CdpMessage
      if (message.id) {
        const waiter = this.pending.get(message.id)
        if (!waiter) return
        this.pending.delete(message.id)
        clearTimeout(waiter.timer)
        if (message.error) waiter.reject(new Error(`${message.error.code}: ${message.error.message}`))
        else waiter.resolve(message.result)
        return
      }
      this.handlers.forEach((handler) => handler(message))
    })
    this.socket.addEventListener('close', () => {
      this.pending.forEach(({ reject, timer }) => {
        clearTimeout(timer)
        reject(new Error('CDP connection closed'))
      })
      this.pending.clear()
    })
  }

  connect(): Promise<unknown> {
    return withDeadline(
      new Promise((resolve, reject) => {
        this.socket.addEventListener('open', resolve, { once: true })
        this.socket.addEventListener('error', reject, { once: true })
      }),
      this.requestTimeoutMs,
      'CDP connection'
    )
  }

  onEvent(handler: (message: CdpMessage) => void): () => boolean {
    this.handlers.add(handler)
    return () => this.handlers.delete(handler)
  }

  send<T = any>(method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<T> {
    return new Promise((resolve, reject) => {
      const id = this.nextId++
      const timer = setTimeout(() => {
        if (!this.pending.delete(id)) return
        reject(new Error(`Timed out waiting for CDP ${method} after ${this.requestTimeoutMs}ms`))
      }, this.requestTimeoutMs)
      this.pending.set(id, { resolve, reject, timer })
      try {
        this.socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }))
      } catch (error) {
        clearTimeout(timer)
        this.pending.delete(id)
        reject(error)
      }
    })
  }

  close(): void {
    this.socket.close()
  }
}

export const terminateOwnedProcesses = async (options: CleanupOptions): Promise<CleanupState> => {
  const {
    rootPid,
    isRootExited,
    listOwnedProcesses,
    signalProcessGroup,
    signalProcess,
    termTimeoutMs = 3000,
    killTimeoutMs = 2000,
    pollIntervalMs = 50,
    sleep = delay
  } = options

  const snapshot = (): CleanupState => ({ rootExited: isRootExited(), residualProcesses: listOwnedProcesses() })
  const isSettled = (state: CleanupState): boolean => state.rootExited && state.residualProcesses.length === 0
  const waitUntilSettled = async (timeoutMs: number): Promise<CleanupState> => {
    const deadline = Date.now() + timeoutMs
    let state = snapshot()
    while (!isSettled(state) && Date.now() < deadline) {
      await sleep(pollIntervalMs)
      state = snapshot()
    }
    return state
  }
  const signalOwned = (signal: NodeJS.Signals, state: CleanupState): void => {
    if (rootPid) signalProcessGroup(rootPid, signal)
    state.residualProcesses.forEach(({ pid }) => {
      if (pid !== rootPid) signalProcess(pid, signal)
    })
  }

  let state = snapshot()
  if (isSettled(state)) return state
  signalOwned('SIGTERM', state)
  state = await waitUntilSettled(termTimeoutMs)
  if (isSettled(state)) return state
  signalOwned('SIGKILL', state)
  return waitUntilSettled(killTimeoutMs)
}
