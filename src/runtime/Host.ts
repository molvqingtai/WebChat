import { browser } from '#imports'
import { createServer } from '@/runtime/Server'
import { createRoomTransport } from '@/runtime/RoomTransportProvider'
import { createBrowserPresenceStore } from '@/runtime/PresenceStore'
import { HostEndpoint } from '@/runtime/HostEndpoint'
import type { HostPush, HostRequest, HostResponse } from '@/runtime/Link'

export interface CreateHostOptions {
  /** Browser delivery for content-free invalidations and History supply events. */
  sendPush: (push: HostPush) => void
}

export interface RuntimeHost {
  handle: (request: HostRequest) => Promise<HostResponse>
}

/**
 * One Runtime host per long-lived extension document.
 *
 * Chromium runs it in the Offscreen document; Firefox runs it in the persistent MV2 Background.
 * In both cases the host outlives the Background service worker on Chromium, which is the whole
 * point: a terminated Background never destroys Rooms, Sessions, peer connections, or the
 * delivery buffer a Page still has to acknowledge.
 */
export const createHost = ({ sendPush }: CreateHostOptions): RuntimeHost => {
  let endpoint: HostEndpoint | null = null
  const transport = createRoomTransport()
  // Firefox MV2 has no storage.session in every supported version; local storage is an acceptable
  // fallback because presence is only a hint, never authoritative state.
  const sessionArea = browser.storage.session ?? browser.storage.local
  const server = createServer({
    transport,
    presenceStore: createBrowserPresenceStore(sessionArea),
    onStateChanged: () => endpoint?.invalidate()
  })
  endpoint = new HostEndpoint(server, sendPush)
  return {
    handle: (request) => endpoint!.handle(request)
  }
}