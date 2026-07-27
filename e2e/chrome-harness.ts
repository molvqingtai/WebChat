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
