import { browser } from '#imports'
import { nanoid } from 'nanoid'
import { ROOM_TRANSPORT_PROVIDER } from '@/constants/config'
import { portChannel, RESET_HOST_MESSAGE, RUNTIME_PORT_NAME } from '@/runtime/channel'
import { createRuntime } from '@/runtime/core/Runtime'
import { createRoomTransport as createArtico } from '@/runtime/transports/artico'
import { createRoomTransport as createTrystero } from '@/runtime/transports/trystero'

/**
 * Runs the Runtime in the current document and accepts page connections. Used by the Chromium
 * Offscreen document and the Firefox background page; a future worker host is another file like
 * this one that calls `runtime.attach` with MessagePort channels.
 */
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

/**
 * Chromium can drop WebRTC from a long-lived Offscreen document. Nothing else notices: joins fail
 * and pages keep waiting, so the host asks the service worker to replace it.
 */
export const startHost = () => {
  const runtime = createRuntime({
    transport: ROOM_TRANSPORT_PROVIDER === 'artico' ? createArtico() : createTrystero(),
    nextId: nanoid,
    unhealthyReason: webRtcFailure,
    onUnhealthy: (reason) => {
      console.error('[webchat] host cannot serve pages:', reason)
      void Promise.resolve(browser.runtime.sendMessage({ type: RESET_HOST_MESSAGE })).catch(() => {})
    }
  })
  browser.runtime.onConnect.addListener((port) => {
    if (port.name !== RUNTIME_PORT_NAME) return
    // The site comes from the browser, never from what the page claims.
    const url = port.sender?.origin ?? port.sender?.url
    if (!url || !URL.canParse(url)) return port.disconnect()
    runtime.attach(portChannel(port, new URL(url).origin))
  })
  return runtime
}
