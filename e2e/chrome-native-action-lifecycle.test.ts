import { describe, expect, it } from 'vitest'

import {
  CHROME_NATIVE_ACTION_ACCEPTED_URL,
  CHROME_NATIVE_ACTION_LIFECYCLE_BUDGET_MS,
  CHROME_NATIVE_ACTION_MAX_MANIFEST_DIFF_ENTRIES,
  CHROME_NATIVE_ACTION_MAX_EVIDENCE_EVENTS,
  CHROME_NATIVE_ACTION_MAX_WORKER_RECORDS,
  CHROME_NATIVE_ACTION_WORKER_DISCOVERY_BUDGET_MS,
  diagnoseChromeNativeActionLifecycle,
  type ChromeLifecycleContext,
  type ChromeLifecycleDomBinding,
  type ChromeLifecycleDomSample,
  type ChromeLifecycleEvent,
  type ChromeLifecycleEventSink,
  type ChromeLifecycleSession,
  type ChromeLifecycleTarget,
  type ChromeLifecycleWorkerIdentity,
  type ChromeNativeActionLifecycleAdapter
} from './chrome-native-action-lifecycle'

const extensionId = 'fignfifoniblkonapihmkfakmlgkbkcf'
const packagedManifest = {
  manifest_version: 3,
  name: 'WebChat',
  permissions: ['storage', 'offscreen'],
  version: '1.0.0',
  background: { type: 'module', service_worker: 'background.js' }
}

const context: ChromeLifecycleContext = {
  candidateExact: '8b6d1fb36986df45bd9435ba170b5675273180ff',
  packageDigest: 'sha256:production-package',
  profileId: 'owned-profile',
  processGeneration: 'chrome-generation-1',
  browserVersion: 'Chrome/150.0.0.0',
  browserExecutable: '/owned/chrome-for-testing',
  packagedManifest
}

const blankTarget: ChromeLifecycleTarget = {
  targetId: 'blank-target',
  type: 'page',
  url: 'about:blank'
}

const workerTarget: ChromeLifecycleTarget = {
  targetId: 'worker-target',
  type: 'service_worker',
  url: `chrome-extension://${extensionId}/background.js`
}

const foreignWorkerTarget: ChromeLifecycleTarget = {
  targetId: 'foreign-worker-target',
  type: 'service_worker',
  url: 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/service_worker.js'
}

const workerSession = 'worker-session'
const foreignWorkerSession = 'foreign-worker-session'

const exactWorkerIdentity = (): ChromeLifecycleWorkerIdentity => ({
  runtimeId: extensionId,
  manifest: {
    version: '1.0.0',
    permissions: ['storage', 'offscreen'],
    name: 'WebChat',
    manifest_version: 3,
    background: { service_worker: 'background.js', type: 'module' }
  }
})

const foreignWorkerIdentity = (): ChromeLifecycleWorkerIdentity => ({
  runtimeId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  manifest: {
    manifest_version: 3,
    name: 'Foreign extension',
    version: '2.0.0',
    background: { service_worker: 'service_worker.js' }
  }
})

const acceptedTarget: ChromeLifecycleTarget = {
  targetId: 'accepted-target',
  type: 'page',
  url: CHROME_NATIVE_ACTION_ACCEPTED_URL
}

const acceptedSession = 'accepted-session'
const mainFrame = 'main-frame'
const isolatedContext = 17

const targetCreated = (target = acceptedTarget): ChromeLifecycleEvent => ({ type: 'target-created', target })

const targetAttached = (target = acceptedTarget, sessionId = acceptedSession): ChromeLifecycleEvent => ({
  type: 'target-attached',
  target,
  sessionId
})

const frameNavigated = (
  overrides: Partial<Extract<ChromeLifecycleEvent, { type: 'frame-navigated' }>> = {}
): ChromeLifecycleEvent => ({
  type: 'frame-navigated',
  targetId: acceptedTarget.targetId,
  sessionId: acceptedSession,
  frameId: mainFrame,
  navigationId: 'navigation-1',
  url: CHROME_NATIVE_ACTION_ACCEPTED_URL,
  ...overrides
})

const contextCreated = (
  overrides: Partial<Extract<ChromeLifecycleEvent, { type: 'execution-context-created' }>> = {}
): ChromeLifecycleEvent => ({
  type: 'execution-context-created',
  targetId: acceptedTarget.targetId,
  sessionId: acceptedSession,
  contextId: isolatedContext,
  frameId: mainFrame,
  origin: `chrome-extension://${extensionId}`,
  world: 'isolated',
  ...overrides
})

const mountedSample = (overrides: Partial<ChromeLifecycleDomSample> = {}): ChromeLifecycleDomSample => ({
  targetId: acceptedTarget.targetId,
  sessionId: acceptedSession,
  mainFrameId: mainFrame,
  url: CHROME_NATIVE_ACTION_ACCEPTED_URL,
  readyState: 'complete',
  bodyPresent: true,
  shadowHostCount: 1,
  shadowRootCount: 1,
  extensionRootCount: 1,
  runtimeUnavailable: false,
  ...overrides
})

type AdapterEffect = ChromeLifecycleEvent | { readonly advanceMs: number }
type AdapterStep = AdapterEffect | { readonly lateEvent: ChromeLifecycleEvent }

class FakeChromeLifecycleAdapter implements ChromeNativeActionLifecycleAdapter {
  nowMs = 1000
  startupTargets: ChromeLifecycleTarget[] = [blankTarget, workerTarget]
  createTargetError: Error | undefined
  sampleError: Error | undefined
  domSamples: ChromeLifecycleDomSample[] = [mountedSample()]
  steps: AdapterStep[] = []
  sink: ChromeLifecycleEventSink | undefined
  readonly trace: string[] = []
  readonly createdUrls: string[] = []
  readonly waitDeadlines: number[] = []
  readonly sampleDeadlines: number[] = []
  readonly operationDeadlines: Array<{ readonly operation: string; readonly deadlineMs: number }> = []
  readonly phaseEffects = new Map<string, AdapterEffect[]>()
  readonly observedSessions: Array<{
    session: ChromeLifecycleSession
    domains: { runtime: true; log: true; page: boolean }
  }> = []
  nativeClicks = 0
  reloads = 0
  repairs = 0
  regressClockAfterTerminalSample = false
  advanceDuringWorkerClassificationMs = 0

  private sampleCompleted = false
  private nowCallsAfterSample = 0
  private exactWorkerIdentityRead = false
  private nowCallsAfterExactWorkerIdentity = 0

  private readonly sessions = new Map<string, ChromeLifecycleSession>([
    [blankTarget.targetId, { targetId: blankTarget.targetId, sessionId: 'blank-session', targetType: 'page' }],
    [
      workerTarget.targetId,
      { targetId: workerTarget.targetId, sessionId: workerSession, targetType: 'service_worker' }
    ],
    [
      foreignWorkerTarget.targetId,
      { targetId: foreignWorkerTarget.targetId, sessionId: foreignWorkerSession, targetType: 'service_worker' }
    ]
  ])

  private readonly workerIdentityResults = new Map<string, Array<ChromeLifecycleWorkerIdentity | Error>>([
    [workerSession, [exactWorkerIdentity()]],
    [foreignWorkerSession, [foreignWorkerIdentity()]]
  ])

  get workerIdentity() {
    const result = this.workerIdentityResults.get(workerSession)?.[0]
    if (!result || result instanceof Error) throw new Error('Exact worker identity is unavailable')
    return structuredClone(result)
  }

  set workerIdentity(identity: ChromeLifecycleWorkerIdentity) {
    this.workerIdentityResults.set(workerSession, [structuredClone(identity)])
  }

  set workerIdentityError(error: Error | undefined) {
    this.workerIdentityResults.set(workerSession, error ? [error] : [exactWorkerIdentity()])
  }

  registerWorker(
    target: ChromeLifecycleTarget,
    sessionId: string,
    identity: ChromeLifecycleWorkerIdentity = foreignWorkerIdentity()
  ) {
    this.sessions.set(target.targetId, { targetId: target.targetId, sessionId, targetType: 'service_worker' })
    this.workerIdentityResults.set(sessionId, [structuredClone(identity)])
  }

  queueWorkerIdentityResults(sessionId: string, ...results: Array<ChromeLifecycleWorkerIdentity | Error>) {
    this.workerIdentityResults.set(
      sessionId,
      results.map((result) => (result instanceof Error ? result : structuredClone(result)))
    )
  }

  now() {
    if (this.exactWorkerIdentityRead && this.advanceDuringWorkerClassificationMs > 0) {
      this.nowCallsAfterExactWorkerIdentity += 1
      if (this.nowCallsAfterExactWorkerIdentity === 2) {
        this.nowMs += this.advanceDuringWorkerClassificationMs
        this.advanceDuringWorkerClassificationMs = 0
      }
    }
    if (this.regressClockAfterTerminalSample && this.sampleCompleted) {
      this.nowCallsAfterSample += 1
      if (this.nowCallsAfterSample === 2) return this.nowMs - 1
    }
    return this.nowMs
  }

  async installEventSink(sink: ChromeLifecycleEventSink) {
    this.trace.push('install-event-sink')
    this.sink = sink
    this.applyPhaseEffects('install-event-sink')
  }

  async enableTargetDiscovery() {
    this.trace.push('enable-target-discovery')
    this.applyPhaseEffects('enable-target-discovery')
  }

  async enableAutoAttach(options: { autoAttach: true; flatten: true; waitForDebuggerOnStart: true }) {
    expect(options).toEqual({ autoAttach: true, flatten: true, waitForDebuggerOnStart: true })
    this.trace.push('enable-auto-attach')
    this.applyPhaseEffects('enable-auto-attach')
  }

  async listStartupTargets(deadlineMs: number) {
    this.trace.push('list-startup-targets')
    this.operationDeadlines.push({ operation: 'list-startup-targets', deadlineMs })
    this.applyPhaseEffects('list-startup-targets')
    return this.startupTargets.map((target) => ({ ...target }))
  }

  async ensureTargetSession(targetId: string, deadlineMs: number) {
    this.trace.push(`ensure-session:${targetId}`)
    this.operationDeadlines.push({ operation: `ensure-session:${targetId}`, deadlineMs })
    this.applyPhaseEffects(`ensure-session:${targetId}`)
    const session = this.sessions.get(targetId)
    if (!session) throw new Error(`Missing session for ${targetId}`)
    return { ...session }
  }

  async enableSessionObservation(
    session: ChromeLifecycleSession,
    domains: { runtime: true; log: true; page: boolean },
    deadlineMs: number
  ) {
    this.trace.push(`observe-session:${session.targetId}:${session.sessionId}`)
    this.operationDeadlines.push({
      operation: `observe-session:${session.targetId}:${session.sessionId}`,
      deadlineMs
    })
    this.observedSessions.push({ session: { ...session }, domains: { ...domains } })
    this.applyPhaseEffects(`observe-session:${session.targetId}:${session.sessionId}`)
  }

  async resumeSession(sessionId: string, deadlineMs: number) {
    this.trace.push(`resume-session:${sessionId}`)
    this.operationDeadlines.push({ operation: `resume-session:${sessionId}`, deadlineMs })
    this.applyPhaseEffects(`resume-session:${sessionId}`)
  }

  async readWorkerIdentity(sessionId: string, deadlineMs: number) {
    this.trace.push(`read-worker:${sessionId}`)
    this.operationDeadlines.push({ operation: `read-worker:${sessionId}`, deadlineMs })
    this.applyPhaseEffects(`read-worker:${sessionId}`)
    const results = this.workerIdentityResults.get(sessionId)
    if (!results?.length) throw new Error(`Missing worker identity for ${sessionId}`)
    const result = results.length > 1 ? results.shift()! : results[0]!
    if (result instanceof Error) throw result
    if (sessionId === workerSession) this.exactWorkerIdentityRead = true
    return structuredClone(result)
  }

  async createTarget(url: string, deadlineMs: number) {
    this.trace.push(`create-target:${url}`)
    this.operationDeadlines.push({ operation: 'create-target', deadlineMs })
    this.createdUrls.push(url)
    this.applyPhaseEffects('create-target')
    if (this.createTargetError) throw this.createTargetError
    return { targetId: acceptedTarget.targetId }
  }

  async waitForEvent(deadlineMs: number) {
    this.trace.push(`wait-event:${deadlineMs}`)
    this.waitDeadlines.push(deadlineMs)
    this.applyPhaseEffects('wait-event')
    const step = this.steps.shift()

    if (!step) {
      this.nowMs = deadlineMs
      return false
    }

    if ('advanceMs' in step) {
      this.nowMs += step.advanceMs
      return false
    }

    if ('lateEvent' in step) {
      this.nowMs = deadlineMs + 1
      this.requireSink()(step.lateEvent)
      return true
    }

    this.requireSink()(step)
    return true
  }

  async sampleDom(binding: ChromeLifecycleDomBinding, deadlineMs: number) {
    this.trace.push(`sample-dom:${binding.targetId}:${binding.sessionId}:${binding.mainFrameId}`)
    this.sampleDeadlines.push(deadlineMs)
    this.applyPhaseEffects('sample-dom')
    if (this.sampleError) throw this.sampleError
    const sample = structuredClone(this.domSamples.shift() ?? mountedSample({ extensionRootCount: 0 }))
    this.sampleCompleted = true
    return sample
  }

  clickNativeAction() {
    this.nativeClicks += 1
  }

  reload() {
    this.reloads += 1
  }

  repair() {
    this.repairs += 1
  }

  private requireSink() {
    if (!this.sink) throw new Error('Event sink is not installed')
    return this.sink
  }

  private applyPhaseEffects(phase: string) {
    const effects = this.phaseEffects.get(phase) ?? []
    this.phaseEffects.delete(phase)
    effects.forEach((effect) => {
      if ('advanceMs' in effect) this.nowMs += effect.advanceMs
      else this.requireSink()(effect)
    })
  }
}

const cleanLifecycleSteps = (): AdapterStep[] => [
  targetCreated(),
  targetAttached(),
  frameNavigated(),
  {
    type: 'page-lifecycle',
    targetId: acceptedTarget.targetId,
    sessionId: acceptedSession,
    frameId: mainFrame,
    name: 'DOMContentLoaded'
  },
  contextCreated(),
  { advanceMs: 1 }
]

const prepareAdapter = (steps: readonly AdapterStep[] = cleanLifecycleSteps()) => {
  const adapter = new FakeChromeLifecycleAdapter()
  adapter.steps = [...steps]
  return adapter
}

const targetBoundSteps = (): AdapterStep[] => [targetCreated(), targetAttached(), frameNavigated()]

const expectPrivateSentinelAbsent = (
  result: Awaited<ReturnType<typeof diagnoseChromeNativeActionLifecycle>>,
  sentinel: string
) => {
  const diffs = result.timeline.flatMap(({ detail }) => {
    if (detail === null || Array.isArray(detail) || typeof detail !== 'object' || !Object.hasOwn(detail, 'diff')) {
      return []
    }
    return [(detail as Record<string, unknown>).diff]
  })

  expect.soft(result.reason).not.toContain(sentinel)
  expect.soft(JSON.stringify(result.timeline)).not.toContain(sentinel)
  expect.soft(JSON.stringify(result.timeline.at(-1))).not.toContain(sentinel)
  expect.soft(JSON.stringify(diffs)).not.toContain(sentinel)
  expect.soft(JSON.stringify(result)).not.toContain(sentinel)
}

describe('Chrome native action lifecycle diagnostic', () => {
  it('establishes observation and exact worker binding before one accepted target and authorizes only its clean mount', async () => {
    const adapter = prepareAdapter()

    const result = await diagnoseChromeNativeActionLifecycle(adapter, context)

    expect(result.outcome, result.reason).toBe('mounted')
    expect(result.actionAuthorization).toMatchObject({
      candidateExact: context.candidateExact,
      packageDigest: context.packageDigest,
      profileId: context.profileId,
      processGeneration: context.processGeneration,
      browserVersion: context.browserVersion,
      browserExecutable: context.browserExecutable,
      extensionId,
      packagedWorkerEntry: 'background.js',
      packagedManifestDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
      workerTargetId: workerTarget.targetId,
      workerSessionId: workerSession,
      workerEntry: 'background.js',
      runtimeManifestDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
      workerDiscoveryStartedAtMs: 1000,
      workerDiscoveryCompletedAtMs: 1000,
      workerDiscoveryDeadlineMs: 1000 + CHROME_NATIVE_ACTION_WORKER_DISCOVERY_BUDGET_MS,
      acceptedUrl: CHROME_NATIVE_ACTION_ACCEPTED_URL,
      pageTargetId: acceptedTarget.targetId,
      pageSessionId: acceptedSession,
      mainFrameId: mainFrame,
      isolatedContextId: isolatedContext,
      authorizedBeforeNativeAction: true,
      evidenceDigest: expect.stringMatching(/^[a-f0-9]{64}$/)
    })
    expect(adapter.nativeClicks).toBe(0)
    expect(adapter.createdUrls).toEqual([CHROME_NATIVE_ACTION_ACCEPTED_URL])

    const createIndex = adapter.trace.indexOf(`create-target:${CHROME_NATIVE_ACTION_ACCEPTED_URL}`)
    expect(adapter.trace.indexOf('install-event-sink')).toBeLessThan(adapter.trace.indexOf('enable-target-discovery'))
    expect(adapter.trace.indexOf('enable-target-discovery')).toBeLessThan(adapter.trace.indexOf('enable-auto-attach'))
    expect(adapter.trace.indexOf('enable-auto-attach')).toBeLessThan(
      adapter.trace.indexOf('read-worker:worker-session')
    )
    expect(adapter.trace.indexOf('read-worker:worker-session')).toBeLessThan(createIndex)
    expect(adapter.trace.indexOf('observe-session:blank-target:blank-session')).toBeLessThan(createIndex)
    expect(adapter.trace.indexOf('observe-session:worker-target:worker-session')).toBeLessThan(createIndex)
    expect(adapter.trace.indexOf('observe-session:accepted-target:accepted-session')).toBeGreaterThan(createIndex)
    expect(adapter.trace.indexOf('observe-session:blank-target:blank-session')).toBeLessThan(
      adapter.trace.indexOf('resume-session:blank-session')
    )
    expect(adapter.trace.indexOf('observe-session:worker-target:worker-session')).toBeLessThan(
      adapter.trace.indexOf('resume-session:worker-session')
    )
    expect(adapter.trace.indexOf('observe-session:accepted-target:accepted-session')).toBeLessThan(
      adapter.trace.indexOf('resume-session:accepted-session')
    )
    expect(adapter.observedSessions).toEqual([
      {
        session: { targetId: blankTarget.targetId, sessionId: 'blank-session', targetType: 'page' },
        domains: { runtime: true, log: true, page: true }
      },
      {
        session: { targetId: workerTarget.targetId, sessionId: 'worker-session', targetType: 'service_worker' },
        domains: { runtime: true, log: true, page: false }
      },
      {
        session: { targetId: acceptedTarget.targetId, sessionId: acceptedSession, targetType: 'page' },
        domains: { runtime: true, log: true, page: true }
      }
    ])
    expect(new Set([...adapter.waitDeadlines, ...adapter.sampleDeadlines])).toEqual(
      new Set([1000 + CHROME_NATIVE_ACTION_LIFECYCLE_BUDGET_MS])
    )
    expect(new Set(adapter.operationDeadlines.map(({ deadlineMs }) => deadlineMs))).toEqual(
      new Set([1000 + CHROME_NATIVE_ACTION_LIFECYCLE_BUDGET_MS])
    )
    const workerEvidence = result.timeline.find(({ type }) => type === 'worker-classified')
    expect(workerEvidence).toMatchObject({
      detail: {
        appearanceOrder: 1,
        diff: [],
        diffOverflow: false,
        entryMatches: true,
        exact: true,
        manifestProjection: {
          manifest_version: 3,
          name: 'WebChat',
          version: '1.0.0',
          background: { service_worker: 'background.js', type: 'module' }
        },
        runtimeId: extensionId,
        runtimeIdMatchesHost: true,
        sessionId: workerSession,
        targetId: workerTarget.targetId,
        targetUrl: workerTarget.url,
        workerEntry: 'background.js'
      }
    })
    const workerEvidenceDetail = workerEvidence!.detail as Record<string, unknown>
    expect(workerEvidenceDetail.packagedManifestDigest).toBe(workerEvidenceDetail.runtimeManifestDigest)
    expect(result.timeline.map(({ sequence }) => sequence)).toEqual(result.timeline.map((_, index) => index + 1))
    expect(
      result.timeline.every((entry, index, timeline) => index === 0 || entry.atMs >= timeline[index - 1]!.atMs)
    ).toBe(true)
    expect(Object.isFrozen(result)).toBe(true)
    expect(Object.isFrozen(result.timeline)).toBe(true)

    if (result.actionAuthorization) adapter.clickNativeAction()
    expect(adapter.nativeClicks).toBe(1)
  })

  it('rejects an accepted startup page instead of adopting a late-observed target', async () => {
    const adapter = prepareAdapter([])
    adapter.startupTargets = [{ ...blankTarget, url: CHROME_NATIVE_ACTION_ACCEPTED_URL }, workerTarget]

    const result = await diagnoseChromeNativeActionLifecycle(adapter, context)

    expect(result.outcome).toBe('target-lifecycle-failed')
    expect(result.actionAuthorization).toBeNull()
    expect(adapter.createdUrls).toEqual([])
    expect(adapter.nativeClicks).toBe(0)
  })

  it('rejects a created page identity that collides with an observed worker', async () => {
    const collidingWorker = { ...workerTarget, targetId: acceptedTarget.targetId }
    const adapter = prepareAdapter([])
    adapter.registerWorker(collidingWorker, 'colliding-worker-session', exactWorkerIdentity())
    adapter.startupTargets = [blankTarget, collidingWorker]

    const result = await diagnoseChromeNativeActionLifecycle(adapter, context)

    expect(result.outcome).toBe('target-lifecycle-failed')
    expect(result.actionAuthorization).toBeNull()
    expect(adapter.createdUrls).toEqual([CHROME_NATIVE_ACTION_ACCEPTED_URL])
  })

  it('rejects invalid packaged MV3 worker declarations before observation or target creation', async () => {
    const invalidManifests: unknown[] = [
      null,
      { ...packagedManifest, manifest_version: 2 },
      { ...packagedManifest, background: [] },
      { ...packagedManifest, background: {} },
      { ...packagedManifest, background: { service_worker: '' } },
      { ...packagedManifest, background: { service_worker: 7 } },
      { ...packagedManifest, background: { service_worker: 'x'.repeat(513) } }
    ]

    for (const packagedManifest of invalidManifests) {
      const adapter = prepareAdapter()
      const result = await diagnoseChromeNativeActionLifecycle(adapter, { ...context, packagedManifest })

      expect.soft(result.outcome).toBe('extension-setup-failed')
      expect.soft(result.actionAuthorization).toBeNull()
      expect.soft(adapter.trace).toEqual([])
      expect.soft(adapter.createdUrls).toEqual([])
    }
  })

  it('derives identity from the package-matching worker when a foreign worker appears first', async () => {
    const adapter = prepareAdapter([{ advanceMs: 5000 }, targetCreated(workerTarget), ...cleanLifecycleSteps()])
    adapter.startupTargets = [blankTarget, foreignWorkerTarget]

    const result = await diagnoseChromeNativeActionLifecycle(adapter, context)

    expect(result.outcome).toBe('mounted')
    expect(result.actionAuthorization?.extensionId).toBe(extensionId)
    expect(adapter.createdUrls).toEqual([CHROME_NATIVE_ACTION_ACCEPTED_URL])
    expect(adapter.waitDeadlines).toContain(1000 + CHROME_NATIVE_ACTION_WORKER_DISCOVERY_BUDGET_MS)
    expect(new Set(adapter.sampleDeadlines)).toEqual(new Set([6000 + CHROME_NATIVE_ACTION_LIFECYCLE_BUDGET_MS]))
    expect(adapter.operationDeadlines).toContainEqual({
      operation: 'create-target',
      deadlineMs: 6000 + CHROME_NATIVE_ACTION_LIFECYCLE_BUDGET_MS
    })
    expect(
      result.timeline
        .filter(({ type }) => type === 'worker-observed')
        .map(({ detail }) => ({
          appearedAfterMs: (detail as Record<string, unknown>).appearedAfterMs,
          targetId: (detail as Record<string, unknown>).targetId
        }))
    ).toEqual([
      { appearedAfterMs: 0, targetId: foreignWorkerTarget.targetId },
      { appearedAfterMs: 5000, targetId: workerTarget.targetId }
    ])
  })

  it('fails exact extension setup before target creation for missing, duplicate, foreign, mismatched, or unresponsive workers', async () => {
    const cases: Array<(adapter: FakeChromeLifecycleAdapter) => void> = [
      (adapter) => {
        adapter.startupTargets = [blankTarget]
      },
      (adapter) => {
        const duplicate = { ...workerTarget, targetId: 'duplicate-worker' }
        adapter.registerWorker(duplicate, 'duplicate-worker-session', exactWorkerIdentity())
        adapter.startupTargets.push(duplicate)
      },
      (adapter) => {
        adapter.startupTargets = [blankTarget, foreignWorkerTarget]
      },
      (adapter) => {
        adapter.startupTargets = [blankTarget, { ...workerTarget, url: `chrome-extension://${extensionId}/other.js` }]
      },
      (adapter) => {
        adapter.startupTargets = [
          blankTarget,
          { ...workerTarget, url: `chrome-extension://${extensionId}/background.js?generation=2` }
        ]
      },
      (adapter) => {
        adapter.startupTargets = [
          blankTarget,
          { ...workerTarget, url: `chrome-extension://${extensionId}/background.js#replacement` }
        ]
      },
      (adapter) => {
        adapter.workerIdentity = { ...adapter.workerIdentity, runtimeId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }
      },
      (adapter) => {
        adapter.workerIdentity = {
          ...adapter.workerIdentity,
          manifest: { ...packagedManifest, permissions: ['storage'] }
        }
      },
      (adapter) => {
        adapter.workerIdentityError = new Error('worker unresponsive')
      },
      (adapter) => {
        const unresolved = { ...foreignWorkerTarget, targetId: 'startup-unresolved-worker' }
        adapter.registerWorker(unresolved, 'startup-unresolved-session', foreignWorkerIdentity())
        adapter.queueWorkerIdentityResults('startup-unresolved-session', new Error('foreign worker unresponsive'))
        adapter.startupTargets.push(unresolved)
      }
    ]

    for (const arrange of cases) {
      const adapter = prepareAdapter([])
      arrange(adapter)

      const result = await diagnoseChromeNativeActionLifecycle(adapter, context)

      expect(result.outcome).toBe('extension-setup-failed')
      expect(result.actionAuthorization).toBeNull()
      expect(adapter.createdUrls).toEqual([])
      expect(adapter.nativeClicks).toBe(0)
    }
  })

  it('uses canonical manifest equality rather than object key order', async () => {
    const adapter = prepareAdapter()
    adapter.workerIdentity = {
      runtimeId: extensionId,
      manifest: {
        version: packagedManifest.version,
        permissions: [...packagedManifest.permissions],
        name: packagedManifest.name,
        manifest_version: packagedManifest.manifest_version,
        background: { ...packagedManifest.background }
      }
    }

    const result = await diagnoseChromeNativeActionLifecycle(adapter, context)

    expect(result.outcome).toBe('mounted')
    expect(adapter.createdUrls).toEqual([CHROME_NATIVE_ACTION_ACCEPTED_URL])
  })

  it('rejects every manifest semantic change rather than normalizing values, fields, arrays, aliases, or paths', async () => {
    const semanticVariants: unknown[] = [
      { ...packagedManifest, permissions: [...packagedManifest.permissions].toReversed() },
      { ...packagedManifest, version: '1.0.1' },
      { ...packagedManifest, minimum_chrome_version: '150' },
      { ...packagedManifest, action: {} },
      {
        manifest_version: packagedManifest.manifest_version,
        name: packagedManifest.name,
        permissions: packagedManifest.permissions,
        version: packagedManifest.version,
        background: { scripts: ['background.js'], type: 'module' }
      },
      { ...packagedManifest, background: { ...packagedManifest.background, service_worker: './background.js' } },
      {
        manifest_version: packagedManifest.manifest_version,
        name: packagedManifest.name,
        version: packagedManifest.version,
        background: packagedManifest.background
      }
    ]

    for (const manifest of semanticVariants) {
      const adapter = prepareAdapter([])
      adapter.workerIdentity = { runtimeId: extensionId, manifest }

      const result = await diagnoseChromeNativeActionLifecycle(adapter, context)

      expect.soft(result.outcome).toBe('extension-setup-failed')
      expect.soft(result.actionAuthorization).toBeNull()
      expect.soft(adapter.createdUrls).toEqual([])
      expect.soft(result.timeline.some(({ type }) => type === 'worker-classified')).toBe(true)
    }
  })

  it('caps foreign manifest differences without exposing non-allowlisted raw values or blocking one exact worker', async () => {
    const adapter = prepareAdapter()
    const secretFields = Object.fromEntries(
      Array.from({ length: CHROME_NATIVE_ACTION_MAX_MANIFEST_DIFF_ENTRIES + 3 }, (_, index) => [
        `private_${String(index).padStart(2, '0')}`,
        `secret-value-${index}`
      ])
    )
    adapter.registerWorker(foreignWorkerTarget, foreignWorkerSession, {
      runtimeId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      manifest: { ...packagedManifest, ...secretFields }
    })
    adapter.startupTargets = [blankTarget, foreignWorkerTarget, workerTarget]

    const result = await diagnoseChromeNativeActionLifecycle(adapter, context)
    const foreignEvidence = result.timeline.find(
      ({ type, detail }) =>
        type === 'worker-classified' &&
        (detail as Record<string, unknown> | undefined)?.targetId === foreignWorkerTarget.targetId
    )
    const detail = foreignEvidence?.detail as Record<string, unknown>

    expect(result.outcome, result.reason).toBe('mounted')
    expect(detail.diffOverflow).toBe(true)
    expect(detail.diff).toHaveLength(CHROME_NATIVE_ACTION_MAX_MANIFEST_DIFF_ENTRIES)
    const paths = (detail.diff as Array<Record<string, unknown>>).map(({ path }) => path)
    expect(paths).toEqual([...paths].toSorted())
    expect(JSON.stringify(detail)).not.toContain('secret-value')
    expect(detail.exact).toBe(false)
  })

  it('fails setup before target creation when total worker evidence capacity is exceeded', async () => {
    const adapter = prepareAdapter([])
    const workers = Array.from({ length: CHROME_NATIVE_ACTION_MAX_WORKER_RECORDS + 1 }, (_, index) => {
      const target: ChromeLifecycleTarget = {
        targetId: `foreign-worker-${index}`,
        type: 'service_worker',
        url: `chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/worker-${index}.js`
      }
      adapter.registerWorker(target, `foreign-worker-session-${index}`, foreignWorkerIdentity())
      return target
    })
    adapter.startupTargets = [blankTarget, ...workers]

    const result = await diagnoseChromeNativeActionLifecycle(adapter, context)

    expect(result.outcome).toBe('extension-setup-failed')
    expect(result.reason).toContain('Worker record count exceeds')
    expect(result.actionAuthorization).toBeNull()
    expect(adapter.createdUrls).toEqual([])
  })

  it('uses one non-resetting worker discovery deadline across foreign changes and empty observation turns', async () => {
    const adapter = prepareAdapter([
      { advanceMs: 10_000 },
      { type: 'target-changed', target: foreignWorkerTarget },
      { advanceMs: 20_000 }
    ])
    adapter.startupTargets = [blankTarget, foreignWorkerTarget]

    const result = await diagnoseChromeNativeActionLifecycle(adapter, context)

    expect(result.outcome).toBe('extension-setup-failed')
    expect(new Set(adapter.waitDeadlines)).toEqual(new Set([1000 + CHROME_NATIVE_ACTION_WORKER_DISCOVERY_BUDGET_MS]))
    expect(adapter.createdUrls).toEqual([])
  })

  it('withholds target creation when any startup inventory, page, or worker probe step reaches discovery deadline', async () => {
    const phases = [
      'list-startup-targets',
      `ensure-session:${blankTarget.targetId}`,
      'observe-session:blank-target:blank-session',
      'resume-session:blank-session',
      `ensure-session:${workerTarget.targetId}`,
      `observe-session:${workerTarget.targetId}:${workerSession}`,
      `resume-session:${workerSession}`,
      `read-worker:${workerSession}`
    ]

    for (const phase of phases) {
      const adapter = prepareAdapter([])
      adapter.phaseEffects.set(phase, [{ advanceMs: CHROME_NATIVE_ACTION_WORKER_DISCOVERY_BUDGET_MS }])

      const result = await diagnoseChromeNativeActionLifecycle(adapter, context)

      expect.soft(result.outcome, phase).toBe('extension-setup-failed')
      expect.soft(result.actionAuthorization, phase).toBeNull()
      expect.soft(adapter.createdUrls, phase).toEqual([])
    }
  })

  it('fails the final worker decision when classification evidence reaches the discovery deadline', async () => {
    const adapter = prepareAdapter()
    adapter.advanceDuringWorkerClassificationMs = CHROME_NATIVE_ACTION_WORKER_DISCOVERY_BUDGET_MS

    const result = await diagnoseChromeNativeActionLifecycle(adapter, context)

    expect(result.outcome).toBe('extension-setup-failed')
    expect(result.reason).toContain('worker discovery deadline')
    expect(result.actionAuthorization).toBeNull()
    expect(adapter.createdUrls).toEqual([])
    expect(result.timeline.some(({ type }) => type === 'worker-bound')).toBe(false)
  })

  it('keeps a fully classified unrelated worker after binding as evidence only', async () => {
    const laterWorker: ChromeLifecycleTarget = {
      targetId: 'later-foreign-worker',
      type: 'service_worker',
      url: 'chrome-extension://bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb/later.js'
    }
    const adapter = prepareAdapter([
      { type: 'target-changed', target: workerTarget },
      targetCreated(laterWorker),
      ...cleanLifecycleSteps()
    ])
    adapter.registerWorker(laterWorker, 'later-foreign-session', {
      runtimeId: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      manifest: { ...packagedManifest, name: 'Later foreign extension' }
    })

    const result = await diagnoseChromeNativeActionLifecycle(adapter, context)

    expect(result.outcome).toBe('mounted')
    expect(result.actionAuthorization?.workerTargetId).toBe(workerTarget.targetId)
    expect(
      result.timeline.some(
        ({ type, detail }) =>
          type === 'worker-classified' &&
          (detail as Record<string, unknown> | undefined)?.targetId === laterWorker.targetId
      )
    ).toBe(true)
  })

  it('rejects every known foreign worker reclassification as a replacement page before clean mount', async () => {
    const pageTarget = { ...acceptedTarget, targetId: foreignWorkerTarget.targetId }
    const cases: Array<{
      readonly name: string
      readonly event: ChromeLifecycleEvent
      readonly expectedReason: string
    }> = [
      {
        name: 'target-created',
        event: targetCreated(pageTarget),
        expectedReason: 'A replacement or second page target appeared during startup continuity'
      },
      {
        name: 'target-changed',
        event: { type: 'target-changed', target: pageTarget },
        expectedReason: 'A replacement or second page target appeared during startup continuity'
      },
      {
        name: 'target-attached',
        event: targetAttached(pageTarget, 'reclassified-page-session'),
        expectedReason: 'A replacement page session attached during startup continuity'
      }
    ]

    for (const testCase of cases) {
      const adapter = prepareAdapter([...targetBoundSteps(), testCase.event, contextCreated(), { advanceMs: 1 }])
      adapter.startupTargets = [blankTarget, foreignWorkerTarget, workerTarget]

      const result = await diagnoseChromeNativeActionLifecycle(adapter, context)
      const foreignWorkerWasClassified = result.timeline.some(
        ({ type, detail }) =>
          type === 'worker-classified' &&
          (detail as Record<string, unknown> | undefined)?.targetId === foreignWorkerTarget.targetId &&
          (detail as Record<string, unknown>).exact === false
      )

      expect.soft(foreignWorkerWasClassified, testCase.name).toBe(true)
      expect.soft(result.outcome, testCase.name).toBe('target-lifecycle-failed')
      expect.soft(result.reason, testCase.name).toBe(testCase.expectedReason)
      expect.soft(result.actionAuthorization, testCase.name).toBeNull()
      expect.soft(adapter.createdUrls, testCase.name).toEqual([CHROME_NATIVE_ACTION_ACCEPTED_URL])
      expect.soft(adapter.nativeClicks, testCase.name).toBe(0)
    }
  })

  it('fails closed on a later exact duplicate or unresolved worker without rebinding', async () => {
    const duplicate: ChromeLifecycleTarget = {
      ...workerTarget,
      targetId: 'later-exact-worker'
    }
    const unresolved: ChromeLifecycleTarget = {
      ...foreignWorkerTarget,
      targetId: 'later-unresolved-worker'
    }
    const deadlineWorker: ChromeLifecycleTarget = {
      ...foreignWorkerTarget,
      targetId: 'later-deadline-worker'
    }
    const cases: Array<(adapter: FakeChromeLifecycleAdapter) => ChromeLifecycleEvent> = [
      (adapter) => {
        adapter.registerWorker(duplicate, 'later-exact-session', exactWorkerIdentity())
        return targetCreated(duplicate)
      },
      (adapter) => {
        adapter.registerWorker(unresolved, 'later-unresolved-session', foreignWorkerIdentity())
        adapter.queueWorkerIdentityResults('later-unresolved-session', new Error('later worker unresponsive'))
        return targetCreated(unresolved)
      },
      (adapter) => {
        adapter.registerWorker(deadlineWorker, 'later-deadline-session', foreignWorkerIdentity())
        adapter.phaseEffects.set('read-worker:later-deadline-session', [
          { advanceMs: CHROME_NATIVE_ACTION_LIFECYCLE_BUDGET_MS }
        ])
        return targetCreated(deadlineWorker)
      }
    ]

    for (const arrange of cases) {
      const adapter = prepareAdapter([])
      const event = arrange(adapter)
      adapter.steps = [event, ...cleanLifecycleSteps()]

      const result = await diagnoseChromeNativeActionLifecycle(adapter, context)

      expect.soft(result.outcome).toBe('extension-setup-failed')
      expect.soft(result.actionAuthorization).toBeNull()
      expect.soft(adapter.createdUrls).toEqual([CHROME_NATIVE_ACTION_ACCEPTED_URL])
    }
  })

  it('rejects every bound worker target, session, ID, entry, manifest, or lifetime drift', async () => {
    const driftCases: Array<{
      readonly name: string
      readonly arrange: (adapter: FakeChromeLifecycleAdapter) => ChromeLifecycleEvent[]
    }> = [
      {
        name: 'target replacement',
        arrange: (adapter) => {
          const replacement = { ...workerTarget, targetId: 'replacement-exact-worker' }
          adapter.registerWorker(replacement, 'replacement-exact-session', exactWorkerIdentity())
          return [{ type: 'target-destroyed', targetId: workerTarget.targetId }, targetCreated(replacement)]
        }
      },
      {
        name: 'session replacement',
        arrange: () => [targetAttached(workerTarget, 'replacement-worker-session')]
      },
      {
        name: 'entry change',
        arrange: () => [
          {
            type: 'target-changed',
            target: { ...workerTarget, url: `chrome-extension://${extensionId}/replacement.js` }
          }
        ]
      },
      {
        name: 'runtime ID change',
        arrange: (adapter) => {
          adapter.queueWorkerIdentityResults(workerSession, exactWorkerIdentity(), {
            ...exactWorkerIdentity(),
            runtimeId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
          })
          return [{ type: 'target-changed', target: workerTarget }]
        }
      },
      {
        name: 'runtime manifest change',
        arrange: (adapter) => {
          adapter.queueWorkerIdentityResults(workerSession, exactWorkerIdentity(), {
            runtimeId: extensionId,
            manifest: { ...packagedManifest, version: '2.0.0' }
          })
          return [{ type: 'target-changed', target: workerTarget }]
        }
      }
    ]

    for (const testCase of driftCases) {
      const adapter = prepareAdapter([])
      adapter.steps = [...testCase.arrange(adapter), ...cleanLifecycleSteps()]

      const result = await diagnoseChromeNativeActionLifecycle(adapter, context)

      expect.soft(result.outcome, testCase.name).toBe('extension-setup-failed')
      expect.soft(result.actionAuthorization, testCase.name).toBeNull()
      expect.soft(adapter.createdUrls, testCase.name).toEqual([CHROME_NATIVE_ACTION_ACCEPTED_URL])
    }
  })

  it('separates missing isolated content context from mount absence', async () => {
    const adapter = prepareAdapter(targetBoundSteps())
    adapter.domSamples = [mountedSample({ extensionRootCount: 0 })]

    const result = await diagnoseChromeNativeActionLifecycle(adapter, context)

    expect(result.outcome).toBe('content-context-absent')
    expect(result.actionAuthorization).toBeNull()
    expect(adapter.nativeClicks).toBe(0)
  })

  it('classifies Shared runtime unavailable before a later root can authorize action', async () => {
    const adapter = prepareAdapter([
      ...targetBoundSteps(),
      contextCreated(),
      {
        type: 'console',
        targetId: acceptedTarget.targetId,
        sessionId: acceptedSession,
        contextId: isolatedContext,
        level: 'error',
        args: ['Shared runtime unavailable', { name: 'RuntimeUnavailableError' }]
      }
    ])
    adapter.domSamples = [mountedSample()]

    const result = await diagnoseChromeNativeActionLifecycle(adapter, context)

    expect(result.outcome).toBe('shared-runtime-unavailable')
    expect(result.finalDom).toMatchObject({ extensionRootCount: 1 })
    expect(result.actionAuthorization).toBeNull()
    expect(adapter.nativeClicks).toBe(0)
  })

  it('classifies an exact isolated context without an extension shadow root as mount absence', async () => {
    const adapter = prepareAdapter([...targetBoundSteps(), contextCreated()])
    adapter.domSamples = [
      mountedSample({
        shadowHostCount: 2,
        shadowRootCount: 2,
        extensionRootCount: 0
      })
    ]

    const result = await diagnoseChromeNativeActionLifecycle(adapter, context)

    expect(result.outcome).toBe('content-mount-absent')
    expect(result.actionAuthorization).toBeNull()
  })

  it('lets a page-bound extension exception outrank later mount evidence', async () => {
    const adapter = prepareAdapter([
      ...targetBoundSteps(),
      contextCreated(),
      {
        type: 'exception',
        targetId: acceptedTarget.targetId,
        sessionId: acceptedSession,
        contextId: isolatedContext,
        message: 'content bootstrap failed',
        stack: ['content.ts:1:1']
      }
    ])
    adapter.domSamples = [mountedSample()]

    const result = await diagnoseChromeNativeActionLifecycle(adapter, context)

    expect(result.outcome).toBe('unexpected-content-failure')
    expect(result.finalDom).toMatchObject({ extensionRootCount: 1 })
    expect(result.actionAuthorization).toBeNull()
  })

  it('privacy-projects console and exception evidence without retaining sentinel payloads', async () => {
    const sentinel = 'sentinel-private-credential-value'
    const cases: Array<{
      readonly name: string
      readonly event: ChromeLifecycleEvent
      readonly classification: string
    }> = [
      {
        name: 'console',
        event: {
          type: 'console',
          targetId: acceptedTarget.targetId,
          sessionId: acceptedSession,
          contextId: isolatedContext,
          level: 'error',
          args: [sentinel, { token: sentinel }]
        },
        classification: 'unexpected-error'
      },
      {
        name: 'exception',
        event: {
          type: 'exception',
          targetId: acceptedTarget.targetId,
          sessionId: acceptedSession,
          contextId: isolatedContext,
          message: `content bootstrap failed: ${sentinel}`,
          stack: { credential: sentinel }
        },
        classification: 'unexpected-exception'
      }
    ]

    for (const testCase of cases) {
      const adapter = prepareAdapter([...targetBoundSteps(), contextCreated(), testCase.event])
      adapter.domSamples = [mountedSample()]

      const result = await diagnoseChromeNativeActionLifecycle(adapter, context)
      const evidence = result.timeline.find(({ type }) => type === `event:${testCase.event.type}`)
      const detail = evidence?.detail as Record<string, unknown> | undefined

      expect.soft(result.outcome, testCase.name).toBe('unexpected-content-failure')
      expect.soft(JSON.stringify(result), testCase.name).not.toContain(sentinel)
      expect.soft(detail, testCase.name).toMatchObject({ classification: testCase.classification })
      expect.soft(detail, testCase.name).not.toHaveProperty('args')
      expect.soft(detail, testCase.name).not.toHaveProperty('message')
      expect.soft(detail, testCase.name).not.toHaveProperty('stack')
      expect.soft(result.actionAuthorization, testCase.name).toBeNull()
    }
  })

  it('privacy-projects page and other target URLs without retaining query credentials', async () => {
    const sentinel = 'sentinel-target-url-query-credential'
    const targetCases = [
      {
        name: 'page',
        type: 'page',
        url: `https://unexpected.example/?credential=${sentinel}`,
        classification: 'unexpected-page',
        expectedOutcome: 'target-lifecycle-failed'
      },
      {
        name: 'other',
        type: 'other',
        url: `devtools://unexpected/?credential=${sentinel}`,
        classification: 'other-target',
        expectedOutcome: 'mounted'
      }
    ] as const
    const eventTypes = ['target-created', 'target-changed', 'target-attached'] as const

    for (const targetCase of targetCases) {
      for (const type of eventTypes) {
        const target: ChromeLifecycleTarget = {
          targetId: `${type}-${targetCase.name}-target`,
          type: targetCase.type,
          url: targetCase.url
        }
        const event: ChromeLifecycleEvent =
          type === 'target-attached' ? { type, target, sessionId: `${target.targetId}-session` } : { type, target }
        const name = `${type} ${targetCase.name}`
        const adapter = prepareAdapter([...targetBoundSteps(), contextCreated(), event, { advanceMs: 1 }])

        const result = await diagnoseChromeNativeActionLifecycle(adapter, context)
        const evidence = result.timeline.find(({ type: entryType, detail }) => {
          const fields = detail as Record<string, unknown> | undefined
          return entryType === `event:${type}` && fields?.targetId === target.targetId
        })
        const detail = evidence?.detail as Record<string, unknown> | undefined

        expect.soft(result.outcome, name).toBe(targetCase.expectedOutcome)
        expectPrivateSentinelAbsent(result, sentinel)
        expect.soft(detail, name).toMatchObject({ targetUrlClassification: targetCase.classification })
        expect.soft(detail, name).not.toHaveProperty('targetUrl')
        if (targetCase.expectedOutcome === 'mounted') {
          expect.soft(result.actionAuthorization, name).not.toBeNull()
        } else {
          expect.soft(result.actionAuthorization, name).toBeNull()
        }
      }
    }
  })

  it('uses a generic accepted-lifecycle observation-error reason without retaining its raw message', async () => {
    const sentinel = 'sentinel-observation-error-credential'
    const adapter = prepareAdapter([
      ...targetBoundSteps(),
      contextCreated(),
      {
        type: 'observation-error',
        targetId: acceptedTarget.targetId,
        sessionId: acceptedSession,
        message: `CDP observation exposed credential ${sentinel}`
      }
    ])

    const result = await diagnoseChromeNativeActionLifecycle(adapter, context)
    const evidence = result.timeline.find(({ type }) => type === 'event:observation-error')

    expect(result.outcome).toBe('unexpected-content-failure')
    expect(result.reason).toBe('Accepted target lifecycle observation failed')
    expectPrivateSentinelAbsent(result, sentinel)
    expect(evidence?.detail).toMatchObject({ classification: 'observation-error' })
    expect(evidence?.detail).not.toHaveProperty('message')
    expect(result.actionAuthorization).toBeNull()
  })

  it('keeps worker, options, main-world, wrong-frame, and foreign-page contexts from satisfying injection', async () => {
    const adapter = prepareAdapter([
      ...targetBoundSteps(),
      contextCreated({
        contextId: 1,
        targetId: workerTarget.targetId,
        sessionId: 'worker-session',
        frameId: 'worker-frame'
      }),
      contextCreated({ contextId: 2, world: 'main', origin: CHROME_NATIVE_ACTION_ACCEPTED_URL }),
      contextCreated({ contextId: 3, frameId: 'iframe' }),
      contextCreated({
        contextId: 4,
        targetId: 'options-target',
        sessionId: 'options-session',
        frameId: 'options-frame',
        origin: `chrome-extension://${extensionId}`
      }),
      contextCreated({
        contextId: 5,
        targetId: 'foreign-page',
        sessionId: 'foreign-session',
        frameId: 'foreign-frame',
        origin: 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
      })
    ])
    adapter.domSamples = [mountedSample({ extensionRootCount: 0 })]

    const result = await diagnoseChromeNativeActionLifecycle(adapter, context)

    expect(result.outcome).toBe('content-context-absent')
    expect(result.actionAuthorization).toBeNull()
  })

  it('fails closed on replacement targets, destroyed targets, divergent sessions, and divergent main frames', async () => {
    const cases: readonly AdapterStep[][] = [
      [targetCreated(), targetCreated({ ...acceptedTarget, targetId: 'replacement-target' })],
      [targetCreated(), targetAttached(), { type: 'target-destroyed', targetId: acceptedTarget.targetId }],
      [targetCreated(), targetAttached(), frameNavigated({ sessionId: 'wrong-session' })],
      [
        targetCreated(),
        targetAttached(),
        {
          type: 'target-changed',
          target: { ...blankTarget, url: CHROME_NATIVE_ACTION_ACCEPTED_URL }
        }
      ],
      [
        targetCreated(),
        targetAttached(),
        frameNavigated(),
        frameNavigated({ frameId: 'replacement-main-frame', navigationId: 'navigation-2' })
      ]
    ]

    for (const steps of cases) {
      const adapter = prepareAdapter(steps)
      adapter.domSamples = [mountedSample()]

      const result = await diagnoseChromeNativeActionLifecycle(adapter, context)

      expect(result.outcome).toBe('target-lifecycle-failed')
      expect(result.actionAuthorization).toBeNull()
      expect(adapter.createdUrls).toEqual([CHROME_NATIVE_ACTION_ACCEPTED_URL])
    }
  })

  it('uses one absolute budget for every phase and rejects evidence delivered after it', async () => {
    const adapter = prepareAdapter([
      targetCreated(),
      targetAttached(),
      frameNavigated(),
      { advanceMs: 5000 },
      contextCreated(),
      {
        lateEvent: {
          type: 'page-lifecycle',
          targetId: acceptedTarget.targetId,
          sessionId: acceptedSession,
          frameId: mainFrame,
          name: 'load'
        }
      }
    ])
    adapter.domSamples = [mountedSample({ extensionRootCount: 0 }), mountedSample()]

    const result = await diagnoseChromeNativeActionLifecycle(adapter, context)

    expect(new Set([...adapter.waitDeadlines, ...adapter.sampleDeadlines])).toEqual(
      new Set([1000 + CHROME_NATIVE_ACTION_LIFECYCLE_BUDGET_MS])
    )
    expect(result.outcome).toBe('unexpected-content-failure')
    expect(result.actionAuthorization).toBeNull()
  })

  it('starts the absolute lifecycle budget only after monotonic setup completes', async () => {
    const adapter = prepareAdapter()
    adapter.phaseEffects.set('enable-target-discovery', [{ advanceMs: 45_000 }])

    const result = await diagnoseChromeNativeActionLifecycle(adapter, context)

    expect(result.outcome).toBe('mounted')
    expect(result.lifecycleStartedAtMs).toBe(46_000)
    expect(result.lifecycleDeadlineMs).toBe(46_000 + CHROME_NATIVE_ACTION_LIFECYCLE_BUDGET_MS)
    expect(new Set([...adapter.waitDeadlines, ...adapter.sampleDeadlines])).toEqual(
      new Set([46_000 + CHROME_NATIVE_ACTION_LIFECYCLE_BUDGET_MS])
    )
  })

  it('withholds mounted authorization when create, accepted observation, resume, or sampling reaches the deadline', async () => {
    const cases: ReadonlyArray<{
      readonly name: string
      readonly phase: string
      readonly effects: readonly AdapterEffect[]
    }> = [
      {
        name: 'target creation',
        phase: 'create-target',
        effects: [targetCreated(), targetAttached(), frameNavigated(), contextCreated(), { advanceMs: 30_000 }]
      },
      {
        name: 'accepted session observation',
        phase: `observe-session:${acceptedTarget.targetId}:${acceptedSession}`,
        effects: [frameNavigated(), contextCreated(), { advanceMs: 30_000 }]
      },
      {
        name: 'accepted session resume',
        phase: `resume-session:${acceptedSession}`,
        effects: [frameNavigated(), contextCreated(), { advanceMs: 30_000 }]
      },
      {
        name: 'terminal DOM sampling',
        phase: 'sample-dom',
        effects: [{ advanceMs: 30_000 }]
      }
    ]

    for (const testCase of cases) {
      const adapter = prepareAdapter()
      adapter.phaseEffects.set(testCase.phase, [...testCase.effects])

      const result = await diagnoseChromeNativeActionLifecycle(adapter, context)

      expect.soft(result.outcome, testCase.name).not.toBe('mounted')
      expect.soft(result.actionAuthorization, testCase.name).toBeNull()
      expect.soft(adapter.createdUrls, testCase.name).toEqual([CHROME_NATIVE_ACTION_ACCEPTED_URL])
    }
  })

  it('withholds authorization when the monotonic clock regresses at the terminal fence', async () => {
    const adapter = prepareAdapter()
    adapter.regressClockAfterTerminalSample = true

    const result = await diagnoseChromeNativeActionLifecycle(adapter, context)

    expect(result.outcome).toBe('unexpected-content-failure')
    expect(result.reason).toContain('monotonic')
    expect(result.actionAuthorization).toBeNull()
  })

  it('preserves startup page and worker continuity across setup, create, wait, and sample phases', async () => {
    const blankRedirect: ChromeLifecycleEvent = {
      type: 'frame-navigated',
      targetId: blankTarget.targetId,
      sessionId: 'blank-session',
      frameId: 'blank-frame',
      navigationId: 'blank-navigation',
      url: CHROME_NATIVE_ACTION_ACCEPTED_URL
    }
    const cases: ReadonlyArray<{
      readonly name: string
      readonly phase: string
      readonly event: ChromeLifecycleEvent
      readonly createsAcceptedTarget: boolean
      readonly expectedOutcome: 'extension-setup-failed' | 'target-lifecycle-failed' | 'unexpected-content-failure'
    }> = [
      {
        name: 'setup redirect',
        phase: 'enable-target-discovery',
        event: blankRedirect,
        createsAcceptedTarget: false,
        expectedOutcome: 'target-lifecycle-failed'
      },
      {
        name: 'setup extra attach',
        phase: 'enable-auto-attach',
        event: targetAttached(blankTarget, 'replacement-blank-session'),
        createsAcceptedTarget: false,
        expectedOutcome: 'target-lifecycle-failed'
      },
      {
        name: 'setup replacement page creation',
        phase: 'list-startup-targets',
        event: targetCreated({ ...acceptedTarget, targetId: 'pre-target-replacement-page' }),
        createsAcceptedTarget: false,
        expectedOutcome: 'target-lifecycle-failed'
      },
      {
        name: 'setup observation failure',
        phase: `ensure-session:${blankTarget.targetId}`,
        event: { type: 'observation-error', message: 'pre-target CDP observation disconnected' },
        createsAcceptedTarget: false,
        expectedOutcome: 'extension-setup-failed'
      },
      {
        name: 'create-time worker destruction',
        phase: 'create-target',
        event: { type: 'target-destroyed', targetId: workerTarget.targetId },
        createsAcceptedTarget: true,
        expectedOutcome: 'extension-setup-failed'
      },
      {
        name: 'accepted-observation worker replacement',
        phase: `observe-session:${acceptedTarget.targetId}:${acceptedSession}`,
        event: {
          type: 'target-changed',
          target: {
            ...workerTarget,
            url: 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/background.js'
          }
        },
        createsAcceptedTarget: true,
        expectedOutcome: 'extension-setup-failed'
      },
      {
        name: 'wait-time worker detach',
        phase: 'wait-event',
        event: { type: 'target-detached', targetId: workerTarget.targetId, sessionId: 'worker-session' },
        createsAcceptedTarget: true,
        expectedOutcome: 'extension-setup-failed'
      },
      {
        name: 'wait-time divergent accepted detach',
        phase: 'wait-event',
        event: { type: 'target-detached', targetId: acceptedTarget.targetId, sessionId: 'wrong-session' },
        createsAcceptedTarget: true,
        expectedOutcome: 'target-lifecycle-failed'
      },
      {
        name: 'sample-time startup redirect',
        phase: 'sample-dom',
        event: blankRedirect,
        createsAcceptedTarget: true,
        expectedOutcome: 'target-lifecycle-failed'
      },
      {
        name: 'sample-time observation failure',
        phase: 'sample-dom',
        event: { type: 'observation-error', message: 'CDP observation disconnected' },
        createsAcceptedTarget: true,
        expectedOutcome: 'unexpected-content-failure'
      }
    ]

    for (const testCase of cases) {
      const adapter = prepareAdapter()
      adapter.phaseEffects.set(testCase.phase, [testCase.event])

      const result = await diagnoseChromeNativeActionLifecycle(adapter, context)

      expect.soft(result.outcome, testCase.name).toBe(testCase.expectedOutcome)
      expect.soft(result.actionAuthorization, testCase.name).toBeNull()
      expect
        .soft(adapter.createdUrls, testCase.name)
        .toEqual(testCase.createsAcceptedTarget ? [CHROME_NATIVE_ACTION_ACCEPTED_URL] : [])
    }
  })

  it('fails closed when bounded evidence capacity is exceeded', async () => {
    const noisyEvents: ChromeLifecycleEvent[] = Array.from(
      { length: CHROME_NATIVE_ACTION_MAX_EVIDENCE_EVENTS + 1 },
      (_, index) => ({
        type: 'page-lifecycle',
        targetId: acceptedTarget.targetId,
        sessionId: acceptedSession,
        frameId: mainFrame,
        name: `noise-${index}`
      })
    )
    const adapter = prepareAdapter([...targetBoundSteps(), contextCreated(), ...noisyEvents])
    adapter.domSamples = [mountedSample()]

    const result = await diagnoseChromeNativeActionLifecycle(adapter, context)

    expect(result.outcome).toBe('unexpected-content-failure')
    expect(result.actionAuthorization).toBeNull()
    expect(result.timeline.length).toBeLessThanOrEqual(CHROME_NATIVE_ACTION_MAX_EVIDENCE_EVENTS + 32)
  })

  it('drops a synchronous same-operation event after the pending evidence cap', async () => {
    const adapter = prepareAdapter()
    const burst: ChromeLifecycleEvent[] = [
      ...Array.from({ length: CHROME_NATIVE_ACTION_MAX_EVIDENCE_EVENTS }, (_, index) => ({
        type: 'page-lifecycle' as const,
        targetId: acceptedTarget.targetId,
        sessionId: acceptedSession,
        frameId: mainFrame,
        name: `synchronous-noise-${index}`
      })),
      { type: 'target-destroyed', targetId: acceptedTarget.targetId }
    ]
    adapter.phaseEffects.set('sample-dom', burst)

    const result = await diagnoseChromeNativeActionLifecycle(adapter, context)

    expect(result.outcome).toBe('unexpected-content-failure')
    expect(result.reason).toContain(`Event count exceeds ${CHROME_NATIVE_ACTION_MAX_EVIDENCE_EVENTS}`)
    expect(result.actionAuthorization).toBeNull()
    expect(adapter.createdUrls).toEqual([CHROME_NATIVE_ACTION_ACCEPTED_URL])
    expect(result.timeline.filter(({ type }) => type.startsWith('event:'))).toHaveLength(
      CHROME_NATIVE_ACTION_MAX_EVIDENCE_EVENTS
    )
    expect(result.timeline.filter(({ type }) => type === 'event:target-destroyed')).toHaveLength(0)
    expect(result.timeline.filter(({ type }) => type === 'evidence-overflow')).toHaveLength(1)
    expect(result.timeline.at(-1)).toMatchObject({
      type: 'terminal',
      detail: { outcome: result.outcome, reason: result.reason }
    })
  })

  it('reserves shared timeline capacity for overflow evidence and the terminal state', async () => {
    const internalSampleSteps: AdapterStep[] = Array.from(
      { length: CHROME_NATIVE_ACTION_MAX_EVIDENCE_EVENTS + 32 },
      () => ({ advanceMs: 1 })
    )
    const adapter = prepareAdapter([...targetBoundSteps(), contextCreated(), ...internalSampleSteps])
    adapter.domSamples = Array.from({ length: internalSampleSteps.length + 1 }, () =>
      mountedSample({ extensionRootCount: 0 })
    )

    const result = await diagnoseChromeNativeActionLifecycle(adapter, context)

    expect(result.outcome).toBe('unexpected-content-failure')
    expect(result.actionAuthorization).toBeNull()
    expect(result.timeline).toHaveLength(CHROME_NATIVE_ACTION_MAX_EVIDENCE_EVENTS + 32)
    expect(result.timeline.map(({ sequence }) => sequence)).toEqual(result.timeline.map((_, index) => index + 1))
    expect(result.timeline.filter(({ type }) => type === 'evidence-overflow')).toHaveLength(1)
    expect(result.timeline.filter(({ type }) => type === 'terminal')).toHaveLength(1)
    expect(result.timeline.at(-1)).toMatchObject({
      type: 'terminal',
      detail: { outcome: result.outcome, reason: result.reason }
    })
  })

  it('fails closed when a bounded adapter error makes the prefixed terminal reason exceed its limit', async () => {
    const adapter = prepareAdapter([])
    adapter.createTargetError = new Error('x'.repeat(512))

    const result = await diagnoseChromeNativeActionLifecycle(adapter, context)

    expect.soft(result.outcome).toBe('unexpected-content-failure')
    expect.soft(result.reason.length).toBeLessThanOrEqual(512)
    expect.soft(result.actionAuthorization).toBeNull()
    expect.soft(result.timeline.length).toBeLessThanOrEqual(CHROME_NATIVE_ACTION_MAX_EVIDENCE_EVENTS + 32)
    expect.soft(result.timeline.filter(({ type }) => type === 'evidence-overflow')).toHaveLength(1)
    expect.soft(result.timeline.filter(({ type }) => type === 'terminal')).toHaveLength(1)
    expect.soft(result.timeline.at(-1)).toMatchObject({
      type: 'terminal',
      detail: { outcome: result.outcome, reason: result.reason }
    })
  })

  it('fails closed when final structural DOM evidence is unavailable', async () => {
    const adapter = prepareAdapter([...targetBoundSteps(), contextCreated()])
    adapter.sampleError = new Error('bound target could not be sampled')

    const result = await diagnoseChromeNativeActionLifecycle(adapter, context)

    expect(result.outcome).toBe('unexpected-content-failure')
    expect(result.finalDom).toEqual({ unavailable: 'bound target could not be sampled' })
    expect(result.actionAuthorization).toBeNull()
  })

  it('does not retry target creation or invoke reload, repair, or native action after failure', async () => {
    const adapter = prepareAdapter([])
    adapter.createTargetError = new Error('sole target creation failed')

    const result = await diagnoseChromeNativeActionLifecycle(adapter, context)

    expect(result.outcome).toBe('target-lifecycle-failed')
    expect(adapter.createdUrls).toEqual([CHROME_NATIVE_ACTION_ACCEPTED_URL])
    expect(adapter.reloads).toBe(0)
    expect(adapter.repairs).toBe(0)
    expect(adapter.nativeClicks).toBe(0)

    adapter.domSamples = [mountedSample()]
    adapter.repair()
    expect(result.outcome).toBe('target-lifecycle-failed')
    expect(result.actionAuthorization).toBeNull()
    expect(Object.isFrozen(result)).toBe(true)
  })
})
