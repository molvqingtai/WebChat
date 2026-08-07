import type { RemeshStore } from 'remesh'
import AppStatusDomain from '@/domain/AppStatus'
import ToastDomain from '@/domain/Toast'

const CONTENT_INITIALIZATION_TIMEOUT_MS = 16000

const INITIALIZATION_TOAST_ID = 'webchat-initialization'

export interface InitializationDependencies {
  prepareBrowserSyncStorage: () => Promise<void>
  prepareLocalStorage: () => Promise<void>
  prepareMessageDatabase: () => Promise<void>
  initializeRuntime: () => Promise<unknown | null>
  detachRuntime: () => void
}

const withDeadline = <Value>(task: Promise<Value>, signal: AbortSignal, timeoutMs: number): Promise<Value> =>
  new Promise<Value>((resolve, reject) => {
    let settled = false
    const finish = (callback: () => void) => {
      if (settled) return
      settled = true
      globalThis.clearTimeout(timeout)
      signal.removeEventListener('abort', onAbort)
      callback()
    }
    const onAbort = () =>
      finish(() => reject(signal.reason ?? new DOMException('Initialization aborted', 'AbortError')))
    const timeout = globalThis.setTimeout(
      () => finish(() => reject(new Error('WebChat initialization timed out'))),
      timeoutMs
    )
    signal.addEventListener('abort', onAbort, { once: true })
    task.then(
      (value) => finish(() => resolve(value)),
      (error) => finish(() => reject(error))
    )
    if (signal.aborted) onAbort()
  })

const runInitializationAttempt = async (
  dependencies: InitializationDependencies,
  signal: AbortSignal,
  onRuntimeStarted: () => void = () => {},
  timeoutMs = CONTENT_INITIALIZATION_TIMEOUT_MS,
  runtimeFailed = { value: false }
) => {
  const deadline = Date.now() + timeoutMs

  const run = <Value>(task: () => Promise<Value>) => {
    signal.throwIfAborted()
    const remaining = deadline - Date.now()
    if (remaining <= 0) return Promise.reject(new Error('WebChat initialization timed out'))
    return withDeadline(task(), signal, remaining)
  }

  await run(dependencies.prepareBrowserSyncStorage)
  await run(dependencies.prepareLocalStorage)
  await run(dependencies.prepareMessageDatabase)
  const runtime = await run(() => {
    onRuntimeStarted()
    runtimeFailed.value = true
    return dependencies.initializeRuntime()
  })
  if (!runtime) {
    runtimeFailed.value = true
    throw new Error('Shared runtime unavailable')
  }
}

interface InitializationLifecycleOptions {
  store: RemeshStore
  dependencies: InitializationDependencies
  activateApplicationDependencies: () => void
  timeoutMs?: number
}

export const startInitializationLifecycle = ({
  store,
  dependencies,
  activateApplicationDependencies,
  timeoutMs = CONTENT_INITIALIZATION_TIMEOUT_MS
}: InitializationLifecycleOptions) => {
  const appStatus = store.getDomain(AppStatusDomain())
  const toast = store.getDomain(ToastDomain())
  let active = true
  let generation = 0
  let controller: AbortController | null = null
  let runtimeStarted = false

  const detachRuntime = () => {
    if (!runtimeStarted) return
    runtimeStarted = false
    dependencies.detachRuntime()
  }

  const startAttempt = () => {
    const attemptGeneration = ++generation
    controller?.abort(new DOMException('Initialization superseded', 'AbortError'))
    controller = new AbortController()
    const signal = controller.signal

    store.send(
      toast.command.LoadingCommand({
        id: INITIALIZATION_TOAST_ID,
        message: 'Preparing WebChat',
        dismissible: false
      })
    )

    const runtimeFailed = { value: false }

    void runInitializationAttempt(
      dependencies,
      signal,
      () => {
        runtimeStarted = true
      },
      timeoutMs,
      runtimeFailed
    )
      .then(() => {
        if (!active || signal.aborted || generation !== attemptGeneration) return
        activateApplicationDependencies()
        if (!active || signal.aborted || generation !== attemptGeneration) return
        store.send([appStatus.command.MarkReadyCommand(), toast.command.CancelCommand(INITIALIZATION_TOAST_ID)])
      })
      .catch((error) => {
        if (!active || signal.aborted || generation !== attemptGeneration) return
        detachRuntime()
        console.error('[WebChat] Initialization unavailable:', error)
        // The stable id owns only the loading descriptor; every real failure gets its own fresh
        // original-message toast. A runtime failure is surfaced once by the Runtime lease owner;
        // a preparation failure is surfaced here with its original message.
        store.send([appStatus.command.MarkUnavailableCommand(), toast.command.CancelCommand(INITIALIZATION_TOAST_ID)])
        if (!runtimeFailed.value) {
          store.send(toast.command.ErrorCommand(error instanceof Error ? error.message : String(error)))
        }
      })
  }

  const retrySubscription = store.subscribeEvent(appStatus.event.RetryRequestedEvent, startAttempt)
  startAttempt()

  return () => {
    active = false
    generation += 1
    controller?.abort(new DOMException('Initialization unmounted', 'AbortError'))
    detachRuntime()
    retrySubscription.unsubscribe()
  }
}
