import type { Browser } from '#imports'
import type { Channel } from '@/runtime/core/Contract'

export const RUNTIME_PORT_NAME = 'webchat-runtime'
export const ENSURE_HOST_MESSAGE = 'webchat:ensure-host'

/** Adapts an extension Port to the Channel the core understands. */
export const portChannel = (port: Browser.runtime.Port, domain: string): Channel => {
  const closeListeners = new Set<() => void>()
  let closed = false
  // A local disconnect() does not fire onDisconnect on this side, so both paths end here.
  const close = () => {
    if (closed) return
    closed = true
    closeListeners.forEach((listener) => listener())
    closeListeners.clear()
  }
  port.onDisconnect.addListener(close)
  return {
    domain,
    post: (frame) => {
      if (closed) return
      try {
        port.postMessage(frame)
      } catch {
        close()
      }
    },
    onMessage: (listener) => {
      port.onMessage.addListener(listener)
      return () => port.onMessage.removeListener(listener)
    },
    onClose: (listener) => {
      if (closed) listener()
      else closeListeners.add(listener)
      return () => closeListeners.delete(listener)
    },
    close: () => {
      port.disconnect()
      close()
    }
  }
}
