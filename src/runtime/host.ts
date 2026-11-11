import { browser } from '#imports'
import { nanoid } from 'nanoid'
import { ROOM_TRANSPORT_PROVIDER } from '@/constants/config'
import { portChannel, RUNTIME_PORT_NAME } from '@/runtime/channel'
import { createRuntime } from '@/runtime/core/Runtime'
import { createRoomTransport as createArtico } from '@/runtime/transports/artico'
import { createRoomTransport as createTrystero } from '@/runtime/transports/trystero'

/**
 * Runs the Runtime in the current document and accepts page connections. Used by the Chromium
 * Offscreen document and the Firefox background page; a future worker host is another file like
 * this one that calls `runtime.attach` with MessagePort channels.
 */
export const startHost = () => {
  const runtime = createRuntime({
    transport: ROOM_TRANSPORT_PROVIDER === 'artico' ? createArtico() : createTrystero(),
    nextId: nanoid
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
