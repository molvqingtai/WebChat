import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react'
import BootstrapShell, { type BootstrapPhase } from '@/app/content/BootstrapShell'

export const CONTENT_BOOTSTRAP_TIMEOUT_MS = 16000

export interface BootstrapDependencies {
  prepareBrowserSyncStorage: () => Promise<void>
  prepareLocalStorage: () => Promise<void>
  prepareMessageDatabase: () => Promise<void>
  initializeRuntime: () => Promise<unknown | null>
  detachRuntime: () => void
}

export interface ContentBootstrapProps {
  dependencies: BootstrapDependencies
  createApplication: () => ReactElement
  timeoutMs?: number
}

const withDeadline = <Value,>(task: Promise<Value>, signal: AbortSignal, timeoutMs: number): Promise<Value> =>
  new Promise<Value>((resolve, reject) => {
    let settled = false
    const finish = (callback: () => void) => {
      if (settled) return
      settled = true
      globalThis.clearTimeout(timeout)
      signal.removeEventListener('abort', onAbort)
      callback()
    }
    const onAbort = () => finish(() => reject(signal.reason ?? new DOMException('Bootstrap aborted', 'AbortError')))
    const timeout = globalThis.setTimeout(
      () => finish(() => reject(new Error('WebChat bootstrap timed out'))),
      timeoutMs
    )
    signal.addEventListener('abort', onAbort, { once: true })
    task.then(
      (value) => finish(() => resolve(value)),
      (error) => finish(() => reject(error))
    )
    if (signal.aborted) onAbort()
  })

export const runBootstrapAttempt = async (
  dependencies: BootstrapDependencies,
  signal: AbortSignal,
  onRuntimeStarted: () => void = () => {},
  timeoutMs = CONTENT_BOOTSTRAP_TIMEOUT_MS
) => {
  const run = <Value,>(task: () => Promise<Value>) => {
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

const ContentBootstrap = ({
  dependencies,
  createApplication,
  timeoutMs = CONTENT_BOOTSTRAP_TIMEOUT_MS
}: ContentBootstrapProps) => {
  const [attempt, setAttempt] = useState(0)
  const [phase, setPhase] = useState<BootstrapPhase>('connecting')
  const [application, setApplication] = useState<ReactElement | null>(null)
  const currentGeneration = useRef(0)
  const retryInFlight = useRef(false)

  useEffect(() => {
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
    void runBootstrapAttempt(
      dependencies,
      controller.signal,
      () => {
        runtimeStarted = true
      },
      timeoutMs
    )
      .then(() => {
        if (!active || controller.signal.aborted || currentGeneration.current !== generation) return
        setApplication(createApplication())
      })
      .catch((error) => {
        if (!active || currentGeneration.current !== generation) return
        detachRuntime()
        retryInFlight.current = false
        console.error('[WebChat] Bootstrap unavailable:', error)
        setPhase('unavailable')
      })

    return () => {
      active = false
      controller.abort(new DOMException('Bootstrap superseded', 'AbortError'))
      detachRuntime()
    }
  }, [attempt, createApplication, dependencies, timeoutMs])

  const retry = useCallback(() => {
    if (phase !== 'unavailable' || retryInFlight.current) return
    retryInFlight.current = true
    setPhase('connecting')
    setAttempt((current) => current + 1)
  }, [phase])

  return application ?? <BootstrapShell phase={phase} onRetry={retry} />
}

export default ContentBootstrap
