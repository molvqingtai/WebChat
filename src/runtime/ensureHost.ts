import { browser } from '#imports'
import { ENSURE_HOST_MESSAGE, RESET_HOST_MESSAGE } from '@/runtime/channel'

const OFFSCREEN_URL = '/offscreen.html'

let creating: Promise<void> | null = null

/** Chromium: the host is an Offscreen document, created on demand. */
export const ensureOffscreen = async () => {
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

const LAST_CLOSE_KEY = 'webchat:last-host-close'
/** A fresh host that is told it is dead again must not be closed in an endless chain. */
const RESET_QUIET_MS = 5000

let lastCloseAt = 0

/** Chromium: drop the current host so the next page connection creates a clean one. */
export const resetOffscreen = async () => {
  if (!(await browser.offscreen.hasDocument())) return
  const at = Date.now()
  // The worker outlives hosts but not necessarily itself, so the quiet window is also kept on disk.
  const stored = await browser.storage.local.get(LAST_CLOSE_KEY).catch(() => null)
  const recorded = typeof stored?.[LAST_CLOSE_KEY] === 'number' ? stored[LAST_CLOSE_KEY] : 0
  if (at - Math.max(recorded, lastCloseAt) < RESET_QUIET_MS) return
  lastCloseAt = at
  await browser.storage.local.set({ [LAST_CLOSE_KEY]: at }).catch(() => undefined)
  await browser.offscreen.closeDocument()
}

/** The background's whole part in the Runtime: answer "make sure the host exists". */
export const registerEnsureHost = (ensure: () => Promise<void>, reset: () => Promise<void> = resetOffscreen) => {
  browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === RESET_HOST_MESSAGE) {
      reset().then(
        () => sendResponse({ ok: true }),
        (error) => {
          console.error(error)
          sendResponse({ ok: false })
        }
      )
      return true
    }
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
