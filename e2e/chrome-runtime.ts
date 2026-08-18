import { execFileSync, spawn } from 'node:child_process'
import { access, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import {
  CdpClient,
  createChromeTeardown,
  createProfileRemovalVerificationAttempt,
  type CleanupAttempt,
  type CleanupFailureEvidence,
  delay,
  evaluateRuntimeMessage,
  readDevToolsActivePort,
  terminateOwnedProcesses,
  waitFor,
  waitForUniqueTarget,
  withDeadline
} from './chrome-harness.ts'

type ProcessEntry = {
  pid: number
  processGroupId: number
  command: string
}

type TargetInfo = {
  targetId: string
  type: string
  title: string
  url: string
}

type ExecutionContext = {
  id: number
  name: string
  origin: string
}

type RuntimeEvent = {
  target?: string
  event: string
  type?: string
  args?: unknown[]
  detail?: unknown
  stack?: unknown
}

type AppState = {
  mounted: boolean
  unavailable: boolean
}

type PortAttack = {
  disconnected: boolean
  responses: unknown[]
  error?: string
}

type Evidence = {
  browser: string | null
  chromePid?: number
  extensionPath: string
  startupMs: number | null
  targets: Array<Pick<TargetInfo, 'type' | 'title' | 'url'>>
  relayed: string[]
  rejectedRelayWarnings: number
  extensionErrors: RuntimeEvent[]
  relayDiagnostics: RuntimeEvent[]
  rawBoundaryMessages: { offscreen: number; content: number }
  presenceSourceBoundary?: {
    content: PortAttack
    options: PortAttack
    durableUnchanged: boolean
    before: Record<string, unknown>
    after: Record<string, unknown>
  }
  sandbox: string
  cleanup: {
    rootExited: boolean
    residualProcesses: string[]
    profileRemoved: boolean
    errors: CleanupFailureEvidence[]
  }
  appState?: AppState
  failure?: string
  events?: RuntimeEvent[]
}

type TargetSession = [sessionId: string, target: TargetInfo]

type RelayMessage = {
  type: string
  sender: { type: string }
  id: string
  path: string[]
  meta: { tab: { id: number; url: string } }
  namespace: string
  timeStamp: number
  data: unknown
}

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error))
const errorStack = (error: unknown): string => (error instanceof Error ? (error.stack ?? error.message) : String(error))

const executable = process.env.WEBCHAT_CHROMIUM_EXECUTABLE
const extensionPath = resolve(process.env.WEBCHAT_CHROME_EXTENSION_PATH ?? '.output/chrome-mv3')
const manifestPath = join(extensionPath, 'manifest.json')
const readPositiveTimeout = (name: string, fallback: number): number => {
  const value = Number(process.env[name] ?? fallback)
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive safe integer`)
  return value
}
const startupTimeoutMs = readPositiveTimeout('WEBCHAT_E2E_STARTUP_TIMEOUT_MS', 20000)
const cdpRequestTimeoutMs = readPositiveTimeout('WEBCHAT_E2E_CDP_TIMEOUT_MS', 5000)
const suiteTimeoutMs = readPositiveTimeout('WEBCHAT_E2E_SUITE_TIMEOUT_MS', 60000)
const cleanupTimeoutMs = 10000
const sandboxSetting = process.env.WEBCHAT_CHROMIUM_DISABLE_SANDBOX ?? 'false'
if (sandboxSetting !== 'true' && sandboxSetting !== 'false') {
  throw new Error('WEBCHAT_CHROMIUM_DISABLE_SANDBOX must be exactly "true" or "false"')
}
const disableSandbox = sandboxSetting === 'true'
if (disableSandbox && (process.env.CI !== 'true' || process.env.GITHUB_ACTIONS !== 'true')) {
  throw new Error('Chromium sandbox may only be disabled by the GitHub Actions CI gate')
}

if (!executable) {
  throw new Error(
    'WEBCHAT_CHROMIUM_EXECUTABLE is required and must point to side-load-capable Chrome for Testing or Chromium'
  )
}
await Promise.all([access(executable), access(manifestPath)])
const extensionManifest: unknown = JSON.parse(await readFile(manifestPath, 'utf8'))
if (
  extensionManifest === null ||
  typeof extensionManifest !== 'object' ||
  !('name' in extensionManifest) ||
  typeof extensionManifest.name !== 'string' ||
  extensionManifest.name.trim().length === 0
) {
  throw new Error('Chrome extension manifest name must be a non-empty string')
}
const extensionName = extensionManifest.name

const remoteValue = (value: any): unknown => {
  if (Object.hasOwn(value, 'value')) return value.value
  if (value.unserializableValue) return value.unserializableValue
  if (value.preview?.properties) {
    return Object.fromEntries(
      value.preview.properties.map((property: { name: string; value: unknown }) => [property.name, property.value])
    )
  }
  return value.description ?? value.type
}

const processEntries = (): ProcessEntry[] => {
  if (process.platform === 'win32') return []
  return execFileSync('ps', ['-axo', 'pid=,pgid=,command='], { encoding: 'utf8' })
    .split('\n')
    .flatMap((line) => {
      const match = line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/)
      return match ? [{ pid: Number(match[1]), processGroupId: Number(match[2]), command: match[3] }] : []
    })
}

const profilePath = await mkdtemp(join(tmpdir(), 'webchat-chrome-runtime-'))
const stderr: string[] = []
const chrome = spawn(
  executable,
  [
    '--headless=new',
    '--remote-debugging-port=0',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-dev-shm-usage',
    ...(disableSandbox ? ['--no-sandbox'] : []),
    `--user-data-dir=${profilePath}`,
    `--disable-extensions-except=${extensionPath}`,
    `--load-extension=${extensionPath}`,
    'about:blank'
  ],
  {
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'ignore', 'pipe']
  }
)
chrome.stderr.setEncoding('utf8')
chrome.stderr.on('data', (chunk: string | Buffer) => {
  stderr.push(String(chunk))
  if (stderr.join('').length > 65536) stderr.shift()
})

let exited = chrome.exitCode !== null
const exitResult = new Promise((resolveExit) => {
  chrome.once('exit', (code, signal) => {
    exited = true
    resolveExit({ code, signal })
  })
})

let cdp: CdpClient | undefined
let runError: unknown
let terminalError: unknown
const runtimeEvents: RuntimeEvent[] = []
const evidence: Evidence = {
  browser: null,
  chromePid: chrome.pid,
  extensionPath,
  startupMs: null,
  targets: [],
  relayed: [],
  rejectedRelayWarnings: 0,
  extensionErrors: [],
  relayDiagnostics: [],
  rawBoundaryMessages: { offscreen: 0, content: 0 },
  sandbox: disableSandbox ? 'disabled-in-github-actions' : 'enabled',
  cleanup: { rootExited: false, residualProcesses: [], profileRemoved: false, errors: [] }
}
const signalPid = (pid: number, signal: NodeJS.Signals): void => {
  try {
    process.kill(pid, signal)
  } catch (error) {
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'ESRCH') throw error
  }
}
const teardown = createChromeTeardown({
  errors: evidence.cleanup.errors,
  cleanupTimeoutMs,
  hasCdp: () => Boolean(cdp),
  closeCdp: () => cdp?.close(),
  closeBrowser: () => cdp!.send('Browser.close'),
  waitForBrowserExit: (remainingMs) => Promise.race([exitResult, delay(remainingMs)]),
  remainingAttempts: (): CleanupAttempt[] => [
    {
      resource: 'chromium-processes',
      phase: 'terminate-owned',
      run: async (remainingMs) => {
        const termTimeoutMs = Math.min(3000, remainingMs)
        const cleanupState = await terminateOwnedProcesses({
          rootPid: chrome.pid,
          isRootExited: () => exited,
          listOwnedProcesses: () =>
            processEntries().filter(
              ({ processGroupId, command }) => processGroupId === chrome.pid || command.includes(profilePath)
            ),
          signalProcessGroup: (pid: number, signal: NodeJS.Signals) => {
            if (process.platform === 'win32') {
              if (!exited) chrome.kill(signal)
            } else {
              signalPid(-pid, signal)
            }
          },
          signalProcess: signalPid,
          termTimeoutMs,
          killTimeoutMs: Math.max(0, remainingMs - termTimeoutMs)
        })
        evidence.cleanup.rootExited = cleanupState.rootExited
        evidence.cleanup.residualProcesses = cleanupState.residualProcesses.map(
          ({ pid, command }) => `${pid} ${command}`
        )
      }
    },
    {
      resource: 'profile',
      phase: 'remove',
      run: () => rm(profilePath, { recursive: true, force: true })
    },
    createProfileRemovalVerificationAttempt(profilePath, access, (removed) => {
      evidence.cleanup.profileRemoved = removed
    })
  ],
  cleanupComplete: () =>
    evidence.cleanup.rootExited && evidence.cleanup.residualProcesses.length === 0 && evidence.cleanup.profileRemoved
})

try {
  await withDeadline(
    (async () => {
      const activePortPath = join(profilePath, 'DevToolsActivePort')
      const activePort = await waitFor(
        async () => {
          if (exited) throw new Error(`Chromium exited before CDP startup: ${stderr.join('')}`)
          return readDevToolsActivePort(activePortPath, (path) => readFile(path, 'utf8'))
        },
        { timeoutMs: 10000, label: 'Chromium DevToolsActivePort', retryErrors: false }
      )
      const [port] = activePort.split('\n')
      const endpoint = `http://127.0.0.1:${port}`
      const version = await withDeadline<{ Browser: string; webSocketDebuggerUrl: string }>(
        fetch(`${endpoint}/json/version`, { signal: AbortSignal.timeout(cdpRequestTimeoutMs) }).then(
          async (response) => (await response.json()) as { Browser: string; webSocketDebuggerUrl: string }
        ),
        cdpRequestTimeoutMs,
        'Chromium version endpoint'
      )
      evidence.browser = version.Browser

      const client = new CdpClient(version.webSocketDebuggerUrl, { requestTimeoutMs: cdpRequestTimeoutMs })
      cdp = client
      await client.connect()

      const targets = new Map<string, TargetInfo>()
      const sessions = new Map<string, TargetInfo>()
      const contexts = new Map<string, ExecutionContext[]>()
      const enabledSessions = new Set<string>()

      const enableSession = async (sessionId: string, targetInfo: TargetInfo): Promise<void> => {
        sessions.set(sessionId, targetInfo)
        contexts.set(sessionId, [])
        await Promise.all([
          client.send('Runtime.enable', {}, sessionId),
          client.send('Log.enable', {}, sessionId),
          targetInfo.type === 'page' ? client.send('Page.enable', {}, sessionId) : Promise.resolve()
        ])
        enabledSessions.add(sessionId)
      }

      client.onEvent((message) => {
        if (message.method === 'Target.targetCreated' || message.method === 'Target.targetInfoChanged') {
          targets.set(message.params.targetInfo.targetId, message.params.targetInfo)
          return
        }
        if (message.method === 'Target.targetDestroyed') {
          targets.delete(message.params.targetId)
          return
        }
        if (message.method === 'Target.attachedToTarget') {
          void enableSession(message.params.sessionId, message.params.targetInfo).catch((error) => {
            runtimeEvents.push({
              target: message.params.targetInfo.url,
              event: 'attach-error',
              detail: errorMessage(error)
            })
          })
          return
        }
        if (message.method === 'Target.detachedFromTarget') {
          sessions.delete(message.params.sessionId)
          contexts.delete(message.params.sessionId)
          enabledSessions.delete(message.params.sessionId)
          return
        }
        if (message.method === 'Runtime.executionContextCreated') {
          contexts.get(message.sessionId)?.push(message.params.context)
          return
        }
        if (message.method === 'Runtime.consoleAPICalled') {
          runtimeEvents.push({
            target: sessions.get(message.sessionId)?.url,
            event: 'console',
            type: message.params.type,
            args: message.params.args.map(remoteValue)
          })
          return
        }
        if (message.method === 'Runtime.exceptionThrown') {
          const detail = message.params.exceptionDetails
          runtimeEvents.push({
            target: sessions.get(message.sessionId)?.url,
            event: 'exception',
            detail: detail.exception ? remoteValue(detail.exception) : detail.text,
            stack: detail.stackTrace?.callFrames
          })
        }
      })

      await client.send('Target.setDiscoverTargets', { discover: true })
      await client.send('Target.setAutoAttach', {
        autoAttach: true,
        waitForDebuggerOnStart: false,
        flatten: true
      })
      const { targetInfos } = await client.send<{ targetInfos: TargetInfo[] }>('Target.getTargets')
      targetInfos.forEach((targetInfo) => targets.set(targetInfo.targetId, targetInfo))
      const sessionForTarget = async (targetInfo: TargetInfo, label: string): Promise<TargetSession> => {
        let current = [...sessions.entries()].find(
          ([sessionId, target]) => enabledSessions.has(sessionId) && target.targetId === targetInfo.targetId
        )
        if (!current) {
          await client.send('Target.attachToTarget', { targetId: targetInfo.targetId, flatten: true })
          current = await waitFor(
            () =>
              [...sessions.entries()].find(
                ([sessionId, target]) => enabledSessions.has(sessionId) && target.targetId === targetInfo.targetId
              ),
            { timeoutMs: 5000, label }
          )
        }
        return current
      }

      const startupStartedAt = Date.now()
      const { targetId: pageTargetId } = await client.send<{ targetId: string }>('Target.createTarget', {
        url: 'https://example.com/'
      })
      const pageSession = await waitFor(
        () =>
          [...sessions.entries()].find(
            ([sessionId, target]) =>
              enabledSessions.has(sessionId) && target.targetId === pageTargetId && target.url.includes('example.com')
          ),
        { timeoutMs: 10000, label: 'content page CDP session' }
      )

      const evaluate = async <T = any>(sessionId: string, expression: string, contextId?: number): Promise<T> => {
        const result = await client.send<{
          result: { value: T }
          exceptionDetails?: { exception?: { description?: string }; text: string }
        }>(
          'Runtime.evaluate',
          {
            expression,
            awaitPromise: true,
            returnByValue: true,
            ...(contextId ? { contextId } : {})
          },
          sessionId
        )
        if (result.exceptionDetails) {
          throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
        }
        return result.result.value
      }

      const appState = await waitFor(
        async () => {
          const state = await evaluate<AppState>(
            pageSession[0],
            `(() => {
          const roots = [...document.querySelectorAll('*')].flatMap((element) =>
            element.shadowRoot ? [element.shadowRoot] : []
          )
          return {
            mounted: roots.some((root) => root.querySelector('#root')),
            unavailable: roots.some((root) => root.querySelector('#runtime-unavailable, [role="alert"]'))
          }
        })()`
          )
          if (state?.unavailable) throw new Error('content mounted the Runtime unavailable UI')
          return state?.mounted ? state : null
        },
        { timeoutMs: startupTimeoutMs, label: 'shared Runtime content UI' }
      )
      evidence.startupMs = Date.now() - startupStartedAt

      const contentContext = await waitFor(
        () => contexts.get(pageSession[0])?.find((context) => context.name === extensionName),
        { timeoutMs: 5000, label: 'content isolated execution context' }
      )
      const extensionId = new URL(contentContext.origin).host
      const extensionTargets = () =>
        [...targets.values()].filter((target) => target.url.startsWith('chrome-extension://'))
      const offscreenTarget = await waitForUniqueTarget(
        () =>
          extensionTargets().filter(
            (target) => new URL(target.url).host === extensionId && target.url.endsWith('/offscreen.html')
          ),
        { timeoutMs: startupTimeoutMs, label: 'WebChat Offscreen target' }
      )
      const worker = await waitForUniqueTarget(
        () =>
          extensionTargets().filter(
            (target) => target.type === 'service_worker' && new URL(target.url).host === extensionId
          ),
        { timeoutMs: startupTimeoutMs, label: 'WebChat Runtime service worker target' }
      )

      const offscreenSession = await sessionForTarget(offscreenTarget, 'Offscreen CDP session')
      const workerSession = await sessionForTarget(worker, 'Service Worker CDP session')
      const presenceNamespace = `WEB_CHAT_RUNTIME_PRESENCE_STORE_V1:${extensionId}`
      const forgedPresence = {
        domain: 'https://forged-source.example',
        lastJoinedAt: 1,
        local: {
          presenceId: 'forged-source-generation',
          userId: 'forged-source-user',
          joinedAt: 1,
          status: 'active'
        },
        observers: []
      }
      const presenceRecords = (sessionId: string) =>
        evaluate<Record<string, unknown>>(
          sessionId,
          `chrome.storage.session.get(null).then((values) => Object.fromEntries(Object.entries(values).filter(([key]) => key.startsWith('WEB_CHAT_RUNTIME_PRESENCE_V1:'))))`
        )
      const attackPresencePort = (label: string) => `new Promise((resolve) => {
        const namespace = ${JSON.stringify(presenceNamespace)};
        const port = chrome.runtime.connect({ name: namespace });
        const responses = [];
        let settled = false;
        const finish = (value) => {
          if (settled) return;
          settled = true;
          resolve(value);
        };
        port.onMessage.addListener((message) => responses.push(message));
        port.onDisconnect.addListener(() => finish({ disconnected: true, responses }));
        const apply = (id, path, args) => ({
          type: 'apply',
          sender: { type: 'injector' },
          id,
          path,
          args,
          meta: {},
          namespace,
          timeStamp: Date.now()
        });
        try {
          port.postMessage(apply(${JSON.stringify(`${label}-load`)}, ['load'], [${JSON.stringify(forgedPresence.domain)}]));
          port.postMessage(apply(${JSON.stringify(`${label}-save`)}, ['save'], [${JSON.stringify(forgedPresence)}]));
        } catch (error) {
          finish({ disconnected: true, responses, error: String(error) });
        }
        setTimeout(() => finish({ disconnected: false, responses }), 2000);
      })`
      const beforePresence = await presenceRecords(workerSession[0])
      const { targetId: optionsTargetId } = await client.send<{ targetId: string }>('Target.createTarget', {
        url: `chrome-extension://${extensionId}/options.html`
      })
      const optionsTarget = await waitFor(() => targets.get(optionsTargetId), {
        timeoutMs: 5000,
        label: 'options target'
      })
      const optionsSession = await sessionForTarget(optionsTarget, 'Options CDP session')
      await waitFor(
        async () =>
          (await evaluate<boolean>(optionsSession[0], `typeof chrome !== 'undefined' && !!chrome.runtime?.connect`)) ||
          null,
        { timeoutMs: 5000, label: 'options extension runtime' }
      )
      const [contentAttack, optionsAttack] = await Promise.all([
        evaluate<PortAttack>(pageSession[0], attackPresencePort('content'), contentContext.id),
        evaluate<PortAttack>(optionsSession[0], attackPresencePort('options'))
      ])
      const forgedProvider = {
        type: 'apply',
        sender: { type: 'provider' },
        id: 'forged-presence-provider-response',
        path: ['load'],
        data: forgedPresence,
        meta: {},
        namespace: presenceNamespace,
        timeStamp: Date.now()
      }
      await Promise.all([
        evaluate(pageSession[0], `chrome.runtime.sendMessage(${JSON.stringify(forgedProvider)})`, contentContext.id),
        evaluate(optionsSession[0], `chrome.runtime.sendMessage(${JSON.stringify(forgedProvider)})`)
      ])
      await delay(100)
      const afterPresence = await presenceRecords(workerSession[0])
      const durableUnchanged = JSON.stringify(afterPresence) === JSON.stringify(beforePresence)
      if (
        !contentAttack.disconnected ||
        contentAttack.responses.length !== 0 ||
        !optionsAttack.disconnected ||
        optionsAttack.responses.length !== 0 ||
        !durableUnchanged
      ) {
        throw new Error(
          `PresenceStore source boundary failed: ${JSON.stringify({ contentAttack, optionsAttack, beforePresence, afterPresence })}`
        )
      }
      evidence.presenceSourceBoundary = {
        content: contentAttack,
        options: optionsAttack,
        durableUnchanged,
        before: beforePresence,
        after: afterPresence
      }
      await client.send('Target.closeTarget', { targetId: optionsTargetId })

      await evaluate(
        pageSession[0],
        `globalThis.__webchatRelayMessages = [];
     chrome.runtime.onMessage.addListener((message) => {
       if (message?.id?.startsWith('relay-check-')) globalThis.__webchatRelayMessages.push(message.id)
     });
     true`,
        contentContext.id
      )
      await evaluate(
        offscreenSession[0],
        `globalThis.__webchatTargetTab = null;
     chrome.runtime.onMessage.addListener((message, sender) => {
       if (message?.__webchatResolveTargetTab) {
         globalThis.__webchatTargetTab = { id: sender.tab?.id, url: sender.tab?.url }
       }
     });
     true`
      )
      await evaluate(
        pageSession[0],
        `chrome.runtime.sendMessage({ __webchatResolveTargetTab: true })`,
        contentContext.id
      )
      const targetTab = await waitFor(
        () => evaluate<{ id?: number; url?: string } | null>(offscreenSession[0], 'globalThis.__webchatTargetTab'),
        {
          timeoutMs: 2000,
          label: 'trusted content sender tab metadata'
        }
      )
      if (
        typeof targetTab?.id !== 'number' ||
        !Number.isSafeInteger(targetTab.id) ||
        targetTab.url !== 'https://example.com/'
      ) {
        throw new Error(`Could not resolve the exact target tab: ${JSON.stringify(targetTab)}`)
      }
      const exactTargetTab = { id: targetTab.id, url: targetTab.url }

      const message = (id: string, overrides: Partial<RelayMessage> = {}): RelayMessage => ({
        type: 'apply',
        sender: { type: 'provider' },
        id,
        path: ['getSnapshot'],
        meta: { tab: exactTargetTab },
        namespace: `WEB_CHAT_RUNTIME_V2:${extensionId}`,
        timeStamp: Date.now(),
        data: {},
        ...overrides
      })
      const relayEventStart = runtimeEvents.length
      const validMessages = [
        message('relay-check-valid-apply'),
        message('relay-check-valid-callback', { type: 'callback', path: ['onInbound'], data: [] })
      ]
      for (const [index, item] of validMessages.entries()) {
        await evaluate(offscreenSession[0], `chrome.runtime.sendMessage(${JSON.stringify(item)})`)
        try {
          await waitFor(
            async () => {
              const received = await evaluate(pageSession[0], 'globalThis.__webchatRelayMessages', contentContext.id)
              return received.length > index ? received : null
            },
            { timeoutMs: 2000, label: `${item.type} provider relay` }
          )
        } catch (error) {
          throw new Error(`${errorMessage(error)}; events: ${JSON.stringify(runtimeEvents.slice(-20))}`)
        }
      }

      const rawBoundaryMessages = [null, 'raw-runtime-message']
      for (const item of rawBoundaryMessages) {
        await evaluateRuntimeMessage((expression) => evaluate(offscreenSession[0], expression), item)
        await evaluateRuntimeMessage((expression) => evaluate(pageSession[0], expression, contentContext.id), item)
      }
      evidence.rawBoundaryMessages = {
        offscreen: rawBoundaryMessages.length,
        content: rawBoundaryMessages.length
      }

      const rejectedMessages = [
        message('relay-check-wrong-namespace', { namespace: 'UNKNOWN_NAMESPACE' }),
        message('relay-check-wrong-direction', { sender: { type: 'injector' } }),
        message('relay-check-invalid-target', {
          meta: { tab: { id: exactTargetTab.id, url: 'http://example.com/' } }
        })
      ]
      await evaluate(
        offscreenSession[0],
        `Promise.all(${JSON.stringify(rejectedMessages)}.map((item) => chrome.runtime.sendMessage(item)))`
      )
      await evaluate(
        pageSession[0],
        `chrome.runtime.sendMessage(${JSON.stringify(message('relay-check-spoofed-content'))})`,
        contentContext.id
      )
      // The rejected messages are dropped silently: none reach the content relay log and no
      // console output is produced. A trailing valid message proves the pipeline processed the
      // rejects before it (in-order delivery from the same offscreen sender).
      const trailingMessage = message('relay-check-after-rejects')
      await evaluate(offscreenSession[0], `chrome.runtime.sendMessage(${JSON.stringify(trailingMessage)})`)
      try {
        await waitFor(
          async () => {
            const received = await evaluate(pageSession[0], 'globalThis.__webchatRelayMessages', contentContext.id)
            return received.includes('relay-check-after-rejects') ? received : null
          },
          { timeoutMs: 2000, label: 'post-rejection provider relay' }
        )
      } catch (error) {
        throw new Error(`${errorMessage(error)}; events: ${JSON.stringify(runtimeEvents.slice(-20))}`)
      }

      evidence.relayed = await evaluate(pageSession[0], 'globalThis.__webchatRelayMessages', contentContext.id)
      const expectedRelay = ['relay-check-valid-apply', 'relay-check-valid-callback', 'relay-check-after-rejects']
      if (JSON.stringify(evidence.relayed) !== JSON.stringify(expectedRelay)) {
        throw new Error(
          `Unexpected relayed messages: ${JSON.stringify(evidence.relayed)}; events: ${JSON.stringify(runtimeEvents.slice(-20))}`
        )
      }

      evidence.rejectedRelayWarnings = runtimeEvents.filter(
        (event) => event.event === 'console' && event.args?.[0] === '[WebChat] Dropped Offscreen Runtime relay:'
      ).length
      if (evidence.rejectedRelayWarnings !== 0) {
        throw new Error(`Expected zero rejected relay console output, received ${evidence.rejectedRelayWarnings}`)
      }

      evidence.extensionErrors = runtimeEvents
        .slice(0, relayEventStart)
        .filter(
          (event) =>
            event.event === 'exception' ||
            (event.event === 'console' &&
              event.type === 'error' &&
              !String(event.args?.[0]).includes('Dropped v2 frame'))
        )
      evidence.relayDiagnostics = runtimeEvents
        .slice(relayEventStart)
        .filter((event) => event.event === 'exception' || (event.event === 'console' && event.type === 'error'))
      const unexpectedRelayDiagnostics = evidence.relayDiagnostics.filter(
        (event) => !JSON.stringify(event).includes('Could not establish connection. Receiving end does not exist.')
      )
      if (unexpectedRelayDiagnostics.length > 0) {
        throw new Error(`Unexpected relay diagnostics: ${JSON.stringify(unexpectedRelayDiagnostics)}`)
      }
      if (evidence.extensionErrors.length > 0) {
        throw new Error(`Extension runtime errors: ${JSON.stringify(evidence.extensionErrors)}`)
      }

      evidence.targets = [...targets.values()].map(({ type, title, url }) => ({ type, title, url }))
      evidence.appState = appState
    })(),
    suiteTimeoutMs,
    'Chrome Runtime suite',
    teardown.timeoutClose
  )
} catch (error) {
  runError = error
  evidence.failure = errorStack(error)
  evidence.events = runtimeEvents.slice(-100)
} finally {
  terminalError = (await teardown.finish(runError)).terminalError
}

if (terminalError) {
  console.error(JSON.stringify({ evidence, stderr: stderr.join('') }, null, 2))
  throw terminalError
}

console.log(
  JSON.stringify(
    {
      ...evidence,
      executable: basename(executable),
      stderr: stderr.join('').split('\n').filter(Boolean).slice(-20)
    },
    null,
    2
  )
)
