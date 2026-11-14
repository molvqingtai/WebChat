import { browser } from '#imports'
import { nanoid } from 'nanoid'
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
/** A stream of reports must still replace the host; debounce cannot wait forever. */
const REPORT_MAX_WAIT_MS = 2000

export const startHost = () => {
  note('boot')
  let reportAt = 0
  let reportTimer: ReturnType<typeof setTimeout> | undefined
  const create = () =>
    createRuntime({
      transport: ROOM_TRANSPORT_PROVIDER === 'artico' ? createArtico() : createTrystero(),
      nextId: nanoid,
      unhealthyReason: webRtcFailure,
      onUnhealthy: (reason) => {
        // Collapse a burst of reports into one replacement: wait for the reports to stop, but never
        // longer than the maximum, so a host that reports continuously is still replaced.
        reportAt ||= Date.now()
        clearTimeout(reportTimer)
        const waited = Date.now() - reportAt
        reportTimer = setTimeout(
          () => {
            reportAt = 0
            console.error('[webchat] host cannot serve pages:', reason)
            note(`unhealthy: ${reason}`)
            resetHost()
          },
          Math.max(0, Math.min(REPORT_DEBOUNCE_MS, REPORT_MAX_WAIT_MS - waited))
        )
      },
      resetHost: () => {
        note('refresh')
        resetHost()
      }
    })
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
