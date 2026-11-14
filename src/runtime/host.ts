import { browser } from '#imports'
import { nanoid } from 'nanoid'
import { debounce } from '@/utils'
import { ROOM_TRANSPORT_PROVIDER } from '@/constants/config'
import { portChannel, RESET_HOST_MESSAGE, RUNTIME_PORT_NAME } from '@/runtime/channel'
import { createRuntime } from '@/runtime/core/Runtime'
import { createRoomTransport as createArtico } from '@/runtime/transports/artico'
import { createRoomTransport as createTrystero } from '@/runtime/transports/trystero'

/**
 * Artico turns any construction failure into "WebRTC is not supported by this browser", so probe by
 * building one peer and keep the real reason.
 */
const webRtcFailure = (): string | null => {
  try {
    new RTCPeerConnection({ iceServers: [] }).close()
    return null
  } catch (error) {
    return `WebRTC is unusable in this host: ${error instanceof Error ? error.message : String(error)}`
  }
}

const requestOffscreenReset = () => {
  void Promise.resolve(browser.runtime.sendMessage({ type: RESET_HOST_MESSAGE })).catch(() => {})
}

/**
 * Runs the Runtime in the current document and accepts page connections. Used by the Chromium
 * Offscreen document and the Firefox background page; a future worker host is another file like
 * this one that calls `runtime.attach` with MessagePort channels.
 *
 * A host is replaced through exactly one entry point — `resetHost` — which serves both the refresh
 * button and the "this host can no longer build peers" signal.
 */
const HOST_LOG_KEY = 'webchat:host-log'

/**
 * A host dies the moment it is replaced, so anything it wants to say about why has to be written
 * synchronously to storage shared by every host of this origin. localStorage is the only store
 * that survives a document that is about to be closed.
 */
const note = (event: string) => {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(HOST_LOG_KEY) ?? '[]')
    const log = Array.isArray(parsed) ? parsed : []
    log.push({ at: new Date().toISOString(), event })
    localStorage.setItem(HOST_LOG_KEY, JSON.stringify(log.slice(-30)))
  } catch {
    // Diagnostics must never keep a host alive or stop it from dying.
  }
}

/** Reports arrive as a burst: every room probes on its own within the same second. */
const REPORT_DEBOUNCE_MS = 500
/** A host that stays broken must not be replaced in a loop; give the browser time to reclaim. */
const RESET_MIN_INTERVAL_MS = 5000

export const startHost = () => {
  note('boot')
  const create = () =>
    createRuntime({
      transport: ROOM_TRANSPORT_PROVIDER === 'artico' ? createArtico() : createTrystero(),
      nextId: nanoid,
      unhealthyReason: webRtcFailure,
      onUnhealthy: replaceDeadHost,
      resetHost: () => {
        note('refresh')
        resetHost()
      }
    })
  let resetAt = 0
  // Every room reports the same dead host within the same second; one replacement is enough. The
  // interval holds across Firefox's in-place rebuilds, where the worker's quiet window never runs.
  const replaceDeadHost = debounce((reason: string) => {
    if (Date.now() - resetAt < RESET_MIN_INTERVAL_MS) return
    resetAt = Date.now()
    console.error('[webchat] host cannot serve pages:', reason)
    note(`unhealthy: ${reason}`)
    resetHost()
  }, REPORT_DEBOUNCE_MS)
  let runtime = create()
  // Firefox cannot reopen its background page, so replacing the host rebuilds the Runtime in place;
  // Chromium reopens the Offscreen document, which is the only way to drop a wedged one.
  const resetHost = import.meta.env.FIREFOX
    ? () => {
        runtime.dispose()
        runtime = create()
      }
    : requestOffscreenReset

  browser.runtime.onConnect.addListener((port) => {
    if (port.name !== RUNTIME_PORT_NAME) return
    // The site comes from the browser, never from what the page claims.
    const url = port.sender?.origin ?? port.sender?.url
    if (!url || !URL.canParse(url)) return port.disconnect()
    runtime.attach(portChannel(port, new URL(url).origin))
  })
  return runtime
}
