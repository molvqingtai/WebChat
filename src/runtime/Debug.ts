const contextName = () => {
  const location = globalThis.location
  if (!location) return 'unknown'
  return location.protocol === 'chrome-extension:'
    ? `${location.protocol}//${location.host}${location.pathname}`
    : location.origin
}

export const runtimeErrorName = (error: unknown) =>
  error instanceof Error ? { name: error.name, message: error.message } : { name: typeof error, message: String(error) }

export const runtimeLifecycleLog = (event: string, details: Record<string, unknown> = {}) => {
  console.debug(
    '[WebChat][RuntimeLifecycle]',
    JSON.stringify({
      event,
      context: contextName(),
      contextTimeOrigin: globalThis.performance?.timeOrigin ?? null,
      at: Date.now(),
      ...details
    })
  )
}
