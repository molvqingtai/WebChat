import { useCallback, useEffect, useRef, useState } from 'react'
import { useRemeshDomain, useRemeshSend } from 'remesh-react'
import ToastPresentationDomain, { type ToastDescriptor } from '@/domain/ToastPresentation'

export const CONTENT_INITIALIZATION_TIMEOUT_MS = 16000

const INITIALIZATION_TOAST_ID = 'webchat-initialization'

const INITIALIZATION_LOADING_TOAST = {
  id: INITIALIZATION_TOAST_ID,
  type: 'loading',
  message: 'Preparing WebChat',
  dismissible: false
} satisfies ToastDescriptor

const INITIALIZATION_ERROR_TOAST = {
  id: INITIALIZATION_TOAST_ID,
  type: 'error',
  message: 'WebChat unavailable'
} satisfies ToastDescriptor

export interface InitializationDependencies {
  prepareBrowserSyncStorage: () => Promise<void>
  prepareLocalStorage: () => Promise<void>
  prepareMessageDatabase: () => Promise<void>
  initializeRuntime: () => Promise<unknown | null>
  detachRuntime: () => void
}

export type InitializationPhase = 'connecting' | 'unavailable' | 'ready'

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

export const runInitializationAttempt = async (
  dependencies: InitializationDependencies,
  signal: AbortSignal,
  onRuntimeStarted: () => void = () => {},
  timeoutMs = CONTENT_INITIALIZATION_TIMEOUT_MS
) => {
  const run = <Value>(task: () => Promise<Value>) => {
    signal.throwIfAborted()
    return withDeadline(task(), signal, timeoutMs)
  }

  await run(dependencies.prepareBrowserSyncStorage)
  await run(dependencies.prepareLocalStorage)
  await run(dependencies.prepareMessageDatabase)
  onRuntimeStarted()
  const runtime = await run(dependencies.initializeRuntime)
  if (!runtime) throw new Error('Shared runtime unavailable')
}

export const useInitialization = ({
  dependencies,
  activateApplicationDependencies,
  timeoutMs = CONTENT_INITIALIZATION_TIMEOUT_MS
}: {
  dependencies: InitializationDependencies
  activateApplicationDependencies: () => void
  timeoutMs?: number
}) => {
  const send = useRemeshSend()
  const presentationDomain = useRemeshDomain(ToastPresentationDomain())
  const [attempt, setAttempt] = useState(0)
  const [phase, setPhase] = useState<InitializationPhase>('connecting')
  const currentGeneration = useRef(0)
  const retryInFlight = useRef(false)

  useEffect(() => {
    // Cleanup owns any Runtime started by this generation; stale continuations may neither activate externs nor settle feedback.
    const generation = ++currentGeneration.current
    const controller = new AbortController()
    let active = true
    let runtimeStarted = false
    const detachRuntime = () => {
      if (!runtimeStarted) return
      runtimeStarted = false
      dependencies.detachRuntime()
    }

    setPhase('connecting')
    send(presentationDomain.command.PublishCommand(INITIALIZATION_LOADING_TOAST))
    void runInitializationAttempt(
      dependencies,
      controller.signal,
      () => {
        runtimeStarted = true
      },
      timeoutMs
    )
      .then(() => {
        if (!active || controller.signal.aborted || currentGeneration.current !== generation) return
        activateApplicationDependencies()
        retryInFlight.current = false
        setPhase('ready')
        send(presentationDomain.command.DismissCommand(INITIALIZATION_TOAST_ID))
      })
      .catch((error) => {
        if (!active || currentGeneration.current !== generation) return
        detachRuntime()
        retryInFlight.current = false
        console.error('[WebChat] Initialization unavailable:', error)
        send(presentationDomain.command.PublishCommand(INITIALIZATION_ERROR_TOAST))
        setPhase('unavailable')
      })

    return () => {
      active = false
      controller.abort(new DOMException('Initialization superseded', 'AbortError'))
      detachRuntime()
    }
  }, [activateApplicationDependencies, attempt, dependencies, presentationDomain.command, send, timeoutMs])

  const retry = useCallback(() => {
    if (phase !== 'unavailable' || retryInFlight.current) return
    retryInFlight.current = true
    setPhase('connecting')
    setAttempt((current) => current + 1)
  }, [phase])

  return { phase, retry }
}
