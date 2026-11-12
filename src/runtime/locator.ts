import { browser } from '#imports'
import { ENSURE_HOST_MESSAGE, portChannel, RUNTIME_PORT_NAME } from '@/runtime/channel'
import { HostUnavailableError, type HostLocator } from '@/runtime/core/Contract'

/**
 * Finds the Runtime host from a content script. The one-shot message wakes the background, which
 * makes sure the host document exists; the Port then goes straight to the host.
 */
export const createHostLocator = (): HostLocator => ({
  connect: async () => {
    // An orphaned content script (extension reloaded or updated) can never reach a host again.
    if (!browser.runtime?.id) throw new HostUnavailableError('Extension context invalidated')
    await browser.runtime.sendMessage({ type: ENSURE_HOST_MESSAGE })
    return portChannel(browser.runtime.connect({ name: RUNTIME_PORT_NAME }), document.location.origin)
  }
})
