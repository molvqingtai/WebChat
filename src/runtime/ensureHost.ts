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

/**
 * WXT's `browser` has no usable storage in the background on Chromium, and a throw there stopped
 * the reset before it closed anything. Use the platform API, and never let a failed write keep a
 * dead host alive.
 */
type StorageArea = {
  get: (key: string) => Promise<Record<string, unknown>>
  set: (items: Record<string, unknown>) => Promise<void>
}

const localStorageArea = () => (globalThis as { chrome?: { storage?: { local?: StorageArea } } }).chrome?.storage?.local

const readLastClose = async (): Promise<number> => {
  try {
    const area = localStorageArea()
    if (!area) return 0
    const stored = await area.get(LAST_CLOSE_KEY)
    const value = stored?.[LAST_CLOSE_KEY]
    return typeof value === 'number' ? value : 0
  } catch {
    return 0
  }
}

const writeLastClose = async (at: number) => {
  try {
    await localStorageArea()?.set({ [LAST_CLOSE_KEY]: at })
  } catch {
    // The in-memory record still protects this worker's lifetime.
  }
}

/** Chromium: drop the current host so the next page connection creates a clean one. */
export const resetOffscreen = async () => {
  if (!(await browser.offscreen.hasDocument())) return
  const at = Date.now()
  const recorded = Math.max(await readLastClose(), lastCloseAt)
  if (at - recorded < RESET_QUIET_MS) return
  lastCloseAt = at
  await writeLastClose(at)
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
