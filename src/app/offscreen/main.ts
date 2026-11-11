import { browser } from '#imports'
import { createHost } from '@/runtime/Host'
import { isHostRequest } from '@/runtime/Link'

/**
 * Chrome/Edge Offscreen Document: the long-lived Runtime host.
 *
 * It owns Rooms, Sessions, the WebRTC transport, page bindings, and the delivery buffer. The
 * Background service worker may be suspended and restarted at any time without touching any of
 * that state; it only relays messages and tab events.
 */
const host = createHost({
  sendPush: (push) => {
    void browser.runtime.sendMessage(push).catch(() => {})
  }
})

browser.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (!isHostRequest(message)) return false
  void host.handle(message).then(sendResponse)
  return true
})
