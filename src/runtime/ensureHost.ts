import { browser } from '#imports'
import { ENSURE_HOST_MESSAGE } from '@/runtime/channel'

const OFFSCREEN_URL = '/offscreen.html'

let creating: Promise<void> | null = null

const ensureOffscreen = async () => {
  if (await browser.offscreen.hasDocument()) return
  creating ??= browser.offscreen
    .createDocument({
      url: OFFSCREEN_URL,
      reasons: ['WEB_RTC'],
      justification: 'Maintain shared WebRTC connections across tabs'
    })
    .finally(() => {
      creating = null
    })
  await creating
}

/**
 * The background's whole part in the Runtime: answer "make sure the host exists". `ensure` is
 * absent where the background itself is the host (Firefox).
 */
export const registerEnsureHost = (ensure: () => Promise<void> = ensureOffscreen) => {
  browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== ENSURE_HOST_MESSAGE) return
    ensure().then(
      () => sendResponse({ ok: true }),
      (error) => {
        console.error(error)
        sendResponse({ ok: false })
      }
    )
    return true
  })
}
