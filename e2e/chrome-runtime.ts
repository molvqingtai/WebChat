import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { chromium, type CDPSession, type Page } from 'playwright'

/**
 * Loads the built extension in a real Chromium and checks the host lifecycle from one page:
 * the service worker can die without anyone noticing, and when the Offscreen host dies the
 * page brings it back and carries on, with no reload and no user action.
 */
const extensionPath = resolve(process.env.WEBCHAT_CHROME_EXTENSION_PATH ?? '.output/chrome-mv3')
const executablePath = process.env.WEBCHAT_CHROMIUM_EXECUTABLE
const SITE = 'https://example.com/'

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms))
const until = async (check: () => Promise<boolean>, what: string, timeoutMs = 30000) => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await check()) return
    await sleep(250)
  }
  throw new Error(`Timed out waiting for ${what}`)
}

const targets = async (cdp: CDPSession) => (await cdp.send('Target.getTargets')).targetInfos
const hosts = async (cdp: CDPSession) => (await targets(cdp)).filter((target) => target.url.endsWith('/offscreen.html'))
const workers = async (cdp: CDPSession) => (await targets(cdp)).filter((target) => target.type === 'service_worker')
const stopWorkers = async (cdp: CDPSession) => {
  for (const { targetId } of await workers(cdp)) await cdp.send('Target.closeTarget', { targetId })
  await until(async () => (await workers(cdp)).length === 0, 'the service worker to stop')
}

// The UI lives in an open shadow root, so it is driven from inside the page.
const ui = (page: Page) => ({
  click: (label: string) =>
    page.evaluate((text) => {
      const root = document.querySelector('web-chat')!.shadowRoot!
      const button = [...root.querySelectorAll('button')].find(
        (item) => item.getAttribute('aria-label') === text || item.textContent?.trim() === text
      )
      button?.click()
      return button !== undefined
    }, label),
  canType: () =>
    page.evaluate(() => {
      const root = document.querySelector('web-chat')?.shadowRoot
      const input = root?.querySelector('textarea')
      return input !== null && input !== undefined && !input.disabled && !root!.querySelector('[data-sonner-toast]')
    }),
  say: async (text: string) => {
    await page.evaluate((value) => {
      const input = document.querySelector('web-chat')!.shadowRoot!.querySelector('textarea')!
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, value)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    }, text)
    await sleep(200)
    await page.evaluate(() =>
      document
        .querySelector('web-chat')!
        .shadowRoot!.querySelector('textarea')!
        .dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    )
  },
  count: (text: string) =>
    page.evaluate(
      (value) =>
        [...document.querySelector('web-chat')!.shadowRoot!.querySelectorAll('#root *')].filter(
          (item) => item.children.length === 0 && item.textContent?.includes(value)
        ).length,
      text
    )
})

const profile = await mkdtemp(join(tmpdir(), 'webchat-e2e-'))
const context = await chromium.launchPersistentContext(profile, {
  executablePath,
  headless: false,
  args: [
    '--headless=new',
    `--disable-extensions-except=${extensionPath}`,
    `--load-extension=${extensionPath}`,
    ...(process.env.WEBCHAT_CHROMIUM_DISABLE_SANDBOX === 'true' ? ['--no-sandbox'] : [])
  ]
})
const evidence: Record<string, boolean | number> = {}
try {
  const page = await context.newPage()
  await page.goto(SITE, { waitUntil: 'commit' })
  const cdp = await context.newCDPSession(page)
  const app = ui(page)

  await until(async () => (await hosts(cdp)).length === 1, 'the Offscreen host')
  await until(() => app.click('Open WebChat'), 'the launcher')
  await until(() => app.click('Start chatting'), 'the setup view')
  await until(app.canType, 'the room to be joined')
  await app.say('first')
  await until(async () => (await app.count('first')) > 0, 'the first message')

  // The service worker is not on the message path: sending works while it is stopped and does not wake it.
  await stopWorkers(cdp)
  await app.say('while-worker-stopped')
  await until(async () => (await app.count('while-worker-stopped')) > 0, 'a message sent with the worker stopped')
  evidence.workerStayedStopped = (await workers(cdp)).length === 0
  if (!evidence.workerStayedStopped) throw new Error('Sending a message woke the service worker')

  // The host itself dies, together with the worker. The page must recover alone.
  const [dead] = await hosts(cdp)
  await stopWorkers(cdp)
  await cdp.send('Target.closeTarget', { targetId: dead!.targetId })
  const killedAt = Date.now()
  await until(async () => {
    const [current] = await hosts(cdp)
    return current !== undefined && current.targetId !== dead!.targetId
  }, 'a new Offscreen host')
  await until(app.canType, 'the room to be joined again')
  evidence.recoveryMs = Date.now() - killedAt
  await app.say('after-host-restart')
  await until(async () => (await app.count('after-host-restart')) > 0, 'a message after the host restart')
  // The presence was resumed, not recreated: still exactly one self-join notice.
  evidence.selfJoinNotices = await app.count('joined the chat')
  if (evidence.selfJoinNotices !== 1) throw new Error(`Expected one self-join notice, saw ${evidence.selfJoinNotices}`)
  console.log(JSON.stringify(evidence))
} finally {
  await context.close()
  await rm(profile, { recursive: true, force: true })
}
