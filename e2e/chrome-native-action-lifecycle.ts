import { createHash } from 'node:crypto'

export const CHROME_NATIVE_ACTION_ACCEPTED_URL = 'https://example.com/'
export const CHROME_NATIVE_ACTION_LIFECYCLE_BUDGET_MS = 30000
export const CHROME_NATIVE_ACTION_WORKER_DISCOVERY_BUDGET_MS = 30000
export const CHROME_NATIVE_ACTION_MAX_EVIDENCE_EVENTS = 96
export const CHROME_NATIVE_ACTION_MAX_WORKER_RECORDS = 16
export const CHROME_NATIVE_ACTION_MAX_MANIFEST_DIFF_ENTRIES = 4

const MAX_TIMELINE_ENTRIES = CHROME_NATIVE_ACTION_MAX_EVIDENCE_EVENTS + 32
const MAX_NONTERMINAL_ENTRIES = MAX_TIMELINE_ENTRIES - 2
const MAX_EVENT_BYTES = 2048
const MAX_VALUE_DEPTH = 4
const MAX_VALUE_ITEMS = 16
const MAX_VALUE_STRING_LENGTH = 512

type JsonPrimitive = null | boolean | number | string
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue }
type JsonObject = { [key: string]: JsonValue }

export interface ChromeLifecycleContext {
  readonly candidateExact: string
  readonly packageDigest: string
  readonly profileId: string
  readonly processGeneration: string
  readonly browserVersion: string
  readonly browserExecutable: string
  readonly packagedManifest: unknown
}

export type ChromeLifecycleTargetType = 'page' | 'service_worker' | 'other'

export interface ChromeLifecycleTarget {
  readonly targetId: string
  readonly type: ChromeLifecycleTargetType
  readonly url: string
}

export interface ChromeLifecycleSession {
  readonly targetId: string
  readonly sessionId: string
  readonly targetType: ChromeLifecycleTargetType
}

export interface ChromeLifecycleWorkerIdentity {
  readonly runtimeId: string
  readonly manifest: unknown
}

export type ChromeLifecycleEvent =
  | { readonly type: 'target-created'; readonly target: ChromeLifecycleTarget }
  | { readonly type: 'target-changed'; readonly target: ChromeLifecycleTarget }
  | { readonly type: 'target-destroyed'; readonly targetId: string }
  | { readonly type: 'target-attached'; readonly target: ChromeLifecycleTarget; readonly sessionId: string }
  | { readonly type: 'target-detached'; readonly targetId: string; readonly sessionId: string }
  | {
      readonly type: 'frame-navigated'
      readonly targetId: string
      readonly sessionId: string
      readonly frameId: string
      readonly parentFrameId?: string
      readonly navigationId: string
      readonly url: string
    }
  | {
      readonly type: 'page-lifecycle'
      readonly targetId: string
      readonly sessionId: string
      readonly frameId: string
      readonly name: string
    }
  | {
      readonly type: 'execution-context-created'
      readonly targetId: string
      readonly sessionId: string
      readonly contextId: number
      readonly frameId: string
      readonly origin: string
      readonly world: 'isolated' | 'main' | 'other'
      readonly name?: string
    }
  | {
      readonly type: 'execution-context-destroyed'
      readonly targetId: string
      readonly sessionId: string
      readonly contextId: number
    }
  | {
      readonly type: 'console'
      readonly targetId: string
      readonly sessionId: string
      readonly contextId: number
      readonly level: string
      readonly args: readonly unknown[]
    }
  | {
      readonly type: 'exception'
      readonly targetId: string
      readonly sessionId: string
      readonly contextId?: number
      readonly message: string
      readonly stack?: unknown
    }
  | {
      readonly type: 'observation-error'
      readonly targetId?: string
      readonly sessionId?: string
      readonly message: string
    }

export type ChromeLifecycleEventSink = (event: ChromeLifecycleEvent) => void

export interface ChromeLifecycleDomBinding {
  readonly targetId: string
  readonly sessionId: string
  readonly mainFrameId: string
}

export interface ChromeLifecycleDomSample extends ChromeLifecycleDomBinding {
  readonly url: string
  readonly readyState: 'loading' | 'interactive' | 'complete'
  readonly bodyPresent: boolean
  readonly shadowHostCount: number
  readonly shadowRootCount: number
  readonly extensionRootCount: number
  readonly runtimeUnavailable: boolean
}

export interface ChromeNativeActionLifecycleAdapter {
  /** Monotonic milliseconds for the owned process generation. */
  now(): number
  /** Installs the complete CDP event sink before discovery or auto-attach is enabled. */
  installEventSink(sink: ChromeLifecycleEventSink): Promise<void>
  enableTargetDiscovery(): Promise<void>
  enableAutoAttach(options: {
    readonly autoAttach: true
    readonly flatten: true
    readonly waitForDebuggerOnStart: true
  }): Promise<void>
  /** Returns the owned browser targets present before the planned accepted target. */
  listStartupTargets(deadlineMs: number): Promise<readonly ChromeLifecycleTarget[]>
  ensureTargetSession(targetId: string, deadlineMs: number): Promise<ChromeLifecycleSession>
  /** Enables Runtime + Log and, for pages, Page observation on an attached session. */
  enableSessionObservation(
    session: ChromeLifecycleSession,
    domains: { readonly runtime: true; readonly log: true; readonly page: boolean },
    deadlineMs: number
  ): Promise<void>
  /** Resumes a target only after its required observation domains are enabled. */
  resumeSession(sessionId: string, deadlineMs: number): Promise<void>
  readWorkerIdentity(sessionId: string, deadlineMs: number): Promise<ChromeLifecycleWorkerIdentity>
  /** The helper calls this exactly once and only with CHROME_NATIVE_ACTION_ACCEPTED_URL. */
  createTarget(url: string, deadlineMs: number): Promise<{ readonly targetId: string }>
  /** Delivers at most one event to the installed sink without advancing beyond deadlineMs. */
  waitForEvent(deadlineMs: number): Promise<boolean>
  sampleDom(binding: ChromeLifecycleDomBinding, deadlineMs: number): Promise<ChromeLifecycleDomSample>
}

export type ChromeNativeActionLifecycleOutcome =
  | 'extension-setup-failed'
  | 'target-lifecycle-failed'
  | 'content-context-absent'
  | 'shared-runtime-unavailable'
  | 'content-mount-absent'
  | 'unexpected-content-failure'
  | 'mounted'

type ChromeLifecycleTerminal = {
  readonly outcome: ChromeNativeActionLifecycleOutcome
  readonly reason: string
}

export interface ChromeLifecycleTimelineEntry {
  readonly sequence: number
  readonly atMs: number
  readonly type: string
  readonly detail?: JsonValue
}

export interface ChromeNativeActionAuthorization {
  readonly candidateExact: string
  readonly packageDigest: string
  readonly profileId: string
  readonly processGeneration: string
  readonly browserVersion: string
  readonly browserExecutable: string
  readonly extensionId: string
  readonly packagedWorkerEntry: string
  readonly packagedManifestDigest: string
  readonly workerTargetId: string
  readonly workerSessionId: string
  readonly workerEntry: string
  readonly runtimeManifestDigest: string
  readonly workerDiscoveryStartedAtMs: number
  readonly workerDiscoveryCompletedAtMs: number
  readonly workerDiscoveryDeadlineMs: number
  readonly acceptedUrl: typeof CHROME_NATIVE_ACTION_ACCEPTED_URL
  readonly pageTargetId: string
  readonly pageSessionId: string
  readonly mainFrameId: string
  readonly navigationId: string
  readonly isolatedContextId: number
  readonly lifecycleStartedAtMs: number
  readonly lifecycleDeadlineMs: number
  readonly authorizedBeforeNativeAction: true
  readonly evidenceDigest: string
}

export interface ChromeNativeActionLifecycleResult {
  readonly outcome: ChromeNativeActionLifecycleOutcome
  readonly reason: string
  readonly lifecycleStartedAtMs: number | null
  readonly lifecycleDeadlineMs: number | null
  readonly evidenceDigest: string
  readonly timeline: readonly ChromeLifecycleTimelineEntry[]
  readonly finalDom: ChromeLifecycleDomSample | { readonly unavailable: string }
  readonly actionAuthorization: ChromeNativeActionAuthorization | null
}

class EvidenceLimitError extends Error {}

const errorMessage = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error)
  return message.length <= MAX_VALUE_STRING_LENGTH ? message : 'Error message exceeded the evidence limit'
}

const nonEmpty = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0

const assertJson = (value: unknown, seen = new Set<object>()): JsonValue => {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number' && Number.isFinite(value)) return value

  if (Array.isArray(value)) {
    if (seen.has(value)) throw new Error('JSON value must not contain cycles')
    seen.add(value)
    // The fresh accumulator owns both the result array and the cycle set: the callback only
    // mutates state created for this invocation, and sparse holes are skipped by map semantics.
    const result = value.reduce(
      (acc, entry) => {
        acc.result.push(assertJson(entry, acc.seen))
        return acc
      },
      { result: [] as JsonValue[], seen }
    ).result
    seen.delete(value)
    return result
  }

  if (typeof value === 'object') {
    if (seen.has(value)) throw new Error('JSON value must not contain cycles')
    seen.add(value)
    const result = Object.keys(value)
      .toSorted()
      .reduce(
        (acc, key) => {
          acc.result[key] = assertJson((value as Record<string, unknown>)[key], acc.seen)
          return acc
        },
        { result: {} as Record<string, JsonValue>, seen }
      ).result
    seen.delete(value)
    return result
  }

  throw new Error(`Unsupported JSON value: ${typeof value}`)
}

const canonicalJson = (value: unknown): string => JSON.stringify(assertJson(value))

const digest = (value: string): string => createHash('sha256').update(value).digest('hex')

type PackagedManifest = {
  readonly value: JsonObject
  readonly canonical: string
  readonly digest: string
  readonly workerEntry: string
}

type ManifestDiffValue =
  | JsonValue
  | {
      readonly type: string
      readonly length: number
      readonly digest: string
    }

type ManifestDiffEntry = {
  readonly path: string
  readonly packaged: ManifestDiffValue
  readonly runtime: ManifestDiffValue
}

const MISSING_MANIFEST_VALUE = Symbol('missing-manifest-value')
type ComparableManifestValue = JsonValue | typeof MISSING_MANIFEST_VALUE

const asPackagedManifest = (value: unknown): PackagedManifest => {
  const parsed = assertJson(value)
  if (parsed === null || Array.isArray(parsed) || typeof parsed !== 'object') {
    throw new Error('Packaged manifest must be a JSON object')
  }
  if (parsed.manifest_version !== 3) throw new Error('Packaged manifest must use manifest_version 3')
  const background = parsed.background
  if (background === null || Array.isArray(background) || typeof background !== 'object') {
    throw new Error('Packaged manifest background must be a JSON object')
  }
  if (
    typeof background.service_worker !== 'string' ||
    !nonEmpty(background.service_worker) ||
    background.service_worker.length > MAX_VALUE_STRING_LENGTH
  ) {
    throw new Error('Packaged manifest background.service_worker must be a non-empty bounded string')
  }
  const canonical = JSON.stringify(parsed)
  return {
    value: parsed,
    canonical,
    digest: digest(canonical),
    workerEntry: background.service_worker
  }
}

const manifestProjection = (manifest: JsonObject): JsonObject =>
  Object.fromEntries(
    (['manifest_version', 'name', 'version', 'background'] as const)
      .filter((key) => Object.hasOwn(manifest, key))
      .map((key) => [key, manifest[key]!])
  )

const pointerSegment = (value: string): string => value.replaceAll('~', '~0').replaceAll('/', '~1')

const manifestValueDescriptor = (value: ComparableManifestValue): ManifestDiffValue => {
  if (value === MISSING_MANIFEST_VALUE) {
    return { type: 'missing', length: 0, digest: digest('missing') }
  }
  const canonical = JSON.stringify(value)
  const type = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value
  const length =
    typeof value === 'string'
      ? value.length
      : Array.isArray(value)
        ? value.length
        : value !== null && typeof value === 'object'
          ? Object.keys(value).length
          : canonical.length
  return { type, length, digest: digest(canonical) }
}

const allowlistedManifestPath = (path: string): boolean =>
  /^\/(?:manifest_version|name|version|background)(?:\/|$)/.test(path)

const manifestDiffValue = (path: string, value: ComparableManifestValue): ManifestDiffValue => {
  if (value === MISSING_MANIFEST_VALUE || !allowlistedManifestPath(path)) {
    return manifestValueDescriptor(value)
  }
  return value
}

const manifestDiff = (
  packaged: JsonValue,
  runtime: JsonValue
): { readonly entries: readonly ManifestDiffEntry[]; readonly overflow: boolean } => {
  const differences: ManifestDiffEntry[] = []

  const visit = (path: string, left: ComparableManifestValue, right: ComparableManifestValue): void => {
    if (differences.length > CHROME_NATIVE_ACTION_MAX_MANIFEST_DIFF_ENTRIES) return
    if (left !== MISSING_MANIFEST_VALUE && right !== MISSING_MANIFEST_VALUE) {
      if (canonicalJson(left) === canonicalJson(right)) return
      const bothArrays = Array.isArray(left) && Array.isArray(right)
      const bothObjects =
        left !== null &&
        right !== null &&
        typeof left === 'object' &&
        typeof right === 'object' &&
        !Array.isArray(left) &&
        !Array.isArray(right)
      if (bothArrays) {
        const indexes = Array.from({ length: Math.max(left.length, right.length) }, (_, index) =>
          String(index)
        ).toSorted()
        for (const index of indexes) {
          const numericIndex = Number(index)
          visit(
            `${path}/${index}`,
            numericIndex < left.length ? left[numericIndex]! : MISSING_MANIFEST_VALUE,
            numericIndex < right.length ? right[numericIndex]! : MISSING_MANIFEST_VALUE
          )
          if (differences.length > CHROME_NATIVE_ACTION_MAX_MANIFEST_DIFF_ENTRIES) return
        }
        return
      }
      if (bothObjects) {
        const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].toSorted()
        for (const key of keys) {
          visit(
            `${path}/${pointerSegment(key)}`,
            Object.hasOwn(left, key) ? left[key]! : MISSING_MANIFEST_VALUE,
            Object.hasOwn(right, key) ? right[key]! : MISSING_MANIFEST_VALUE
          )
          if (differences.length > CHROME_NATIVE_ACTION_MAX_MANIFEST_DIFF_ENTRIES) return
        }
        return
      }
    }

    differences.push({
      path,
      packaged: manifestDiffValue(path, left),
      runtime: manifestDiffValue(path, right)
    })
  }

  visit('', packaged, runtime)
  const overflow = differences.length > CHROME_NATIVE_ACTION_MAX_MANIFEST_DIFF_ENTRIES
  return {
    entries: differences.slice(0, CHROME_NATIVE_ACTION_MAX_MANIFEST_DIFF_ENTRIES),
    overflow
  }
}

const boundedString = (value: string): string => {
  if (value.length > MAX_VALUE_STRING_LENGTH) {
    throw new EvidenceLimitError(`Evidence string exceeds ${MAX_VALUE_STRING_LENGTH} characters`)
  }
  return value
}

const normalizeEvidence = (value: unknown, depth = 0, seen = new Set<object>()): JsonValue => {
  if (depth > MAX_VALUE_DEPTH) throw new EvidenceLimitError(`Evidence exceeds depth ${MAX_VALUE_DEPTH}`)
  if (value === null) return null
  if (typeof value === 'string') return boundedString(value)
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : boundedString(String(value))
  if (typeof value === 'bigint') return boundedString(`${value}n`)
  if (typeof value === 'undefined') return '[undefined]'
  if (typeof value === 'symbol') return boundedString(String(value))
  if (typeof value === 'function') return boundedString(`[function ${value.name || 'anonymous'}]`)

  if (seen.has(value)) throw new EvidenceLimitError('Evidence contains a cycle')
  seen.add(value)

  try {
    if (Array.isArray(value)) {
      if (value.length > MAX_VALUE_ITEMS) {
        throw new EvidenceLimitError(`Evidence array exceeds ${MAX_VALUE_ITEMS} items`)
      }
      return value.map((entry) => normalizeEvidence(entry, depth + 1, seen))
    }

    const keys = Object.keys(value).toSorted()
    if (keys.length > MAX_VALUE_ITEMS) {
      throw new EvidenceLimitError(`Evidence object exceeds ${MAX_VALUE_ITEMS} keys`)
    }
    return keys.reduce(
      (acc, key) => {
        acc.result[boundedString(key)] = normalizeEvidence((value as Record<string, unknown>)[key], depth + 1, acc.seen)
        return acc
      },
      { result: {} as Record<string, JsonValue>, seen }
    ).result
  } finally {
    seen.delete(value)
  }
}

const assertBoundedEvidence = (value: unknown): void => {
  const normalized = normalizeEvidence(value)
  if (canonicalJson(normalized).length > MAX_EVENT_BYTES) {
    throw new EvidenceLimitError(`Timeline entry exceeds ${MAX_EVENT_BYTES} bytes`)
  }
}

const normalizeTerminal = (outcome: ChromeNativeActionLifecycleOutcome, reason: string): ChromeLifecycleTerminal => {
  const terminal = { outcome, reason: boundedString(reason) }
  if (canonicalJson(terminal).length > MAX_EVENT_BYTES) {
    throw new EvidenceLimitError(`Timeline entry exceeds ${MAX_EVENT_BYTES} bytes`)
  }
  return terminal
}

const TERMINAL_EVIDENCE_FAILURE = normalizeTerminal(
  'unexpected-content-failure',
  'Terminal evidence could not be normalized within the evidence limit'
)

const deepFreeze = <Value>(value: Value): Value => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach((child) => deepFreeze(child))
    Object.freeze(value)
  }
  return value
}

class Timeline {
  readonly entries: ChromeLifecycleTimelineEntry[] = []
  externalEvents = 0
  overflow: string | undefined
  clockFailure: string | undefined
  private lastAtMs = Number.NEGATIVE_INFINITY

  constructor(private readonly adapter: ChromeNativeActionLifecycleAdapter) {}

  now(): number {
    const current = this.adapter.now()
    if (!Number.isFinite(current) || current < this.lastAtMs) {
      this.clockFailure ??= 'Lifecycle clock must be finite and monotonic'
      return Number.isFinite(this.lastAtMs) ? this.lastAtMs : 0
    }
    this.lastAtMs = current
    return current
  }

  record(type: string, detail?: unknown, atMs?: number): void {
    if (this.entries.length >= MAX_NONTERMINAL_ENTRIES) {
      this.markOverflow(`Timeline exceeds ${MAX_TIMELINE_ENTRIES} entries`)
      return
    }

    this.append(type, detail, atMs)
  }

  recordTerminal(outcome: ChromeNativeActionLifecycleOutcome, reason: string, atMs: number): ChromeLifecycleTerminal {
    let terminal: ChromeLifecycleTerminal
    try {
      terminal = normalizeTerminal(outcome, reason)
    } catch (error) {
      this.markOverflow(errorMessage(error))
      terminal = TERMINAL_EVIDENCE_FAILURE
    }

    this.entries.push({
      sequence: this.entries.length + 1,
      atMs: Math.max(atMs, this.entries.at(-1)?.atMs ?? atMs),
      type: 'terminal',
      detail: { outcome: terminal.outcome, reason: terminal.reason }
    })
    return terminal
  }

  private append(type: string, detail?: unknown, atMs?: number): void {
    let normalized: JsonValue | undefined
    try {
      normalized = detail === undefined ? undefined : normalizeEvidence(detail)
      if (normalized !== undefined && canonicalJson(normalized).length > MAX_EVENT_BYTES) {
        throw new EvidenceLimitError(`Timeline entry exceeds ${MAX_EVENT_BYTES} bytes`)
      }
    } catch (error) {
      this.markOverflow(errorMessage(error))
      return
    }

    this.entries.push({
      sequence: this.entries.length + 1,
      atMs: atMs ?? this.now(),
      type,
      ...(normalized === undefined ? {} : { detail: normalized })
    })
  }

  admitExternalEvent(): boolean {
    this.externalEvents += 1
    if (this.externalEvents > CHROME_NATIVE_ACTION_MAX_EVIDENCE_EVENTS) {
      this.markOverflow(`Event count exceeds ${CHROME_NATIVE_ACTION_MAX_EVIDENCE_EVENTS}`)
      return false
    }
    return this.overflow === undefined && this.clockFailure === undefined
  }

  captureEventEvidence(type: ChromeLifecycleEvent['type'], detail: JsonObject, atMs: number): boolean {
    this.record(`event:${type}`, detail, atMs)
    return this.overflow === undefined
  }

  private markOverflow(reason: string): void {
    if (this.overflow) return
    this.overflow = reason
    if (this.entries.length < MAX_TIMELINE_ENTRIES - 1) {
      this.entries.push({
        sequence: this.entries.length + 1,
        atMs: this.now(),
        type: 'evidence-overflow',
        detail: { reason: reason.slice(0, MAX_VALUE_STRING_LENGTH) }
      })
    }
  }
}

type BoundState = {
  readonly targetId: string
  pageSessionId?: string
  pageObservationReady?: boolean
  mainFrameId?: string
  navigationId?: string
  isolatedContextId?: number
  targetFailure?: string
  deadlineFailure?: string
  extensionFailure?: string
  sharedRuntimeUnavailable?: string
  unexpectedFailure?: string
  targetDestroyed: boolean
}

type WorkerClassification = {
  readonly runtimeId: string
  readonly workerEntry: string
  readonly runtimeManifestDigest: string
  readonly exact: boolean
}

type WorkerRecord = {
  readonly appearanceOrder: number
  readonly appearedAtMs: number
  target: ChromeLifecycleTarget
  active: boolean
  sessionId?: string
  observationReady?: boolean
  needsProbe: boolean
  classification?: WorkerClassification
  unresolvedReason?: string
  createEvents: number
  attachEvents: number
}

type BoundWorker = {
  readonly targetId: string
  readonly sessionId: string
  readonly targetUrl: string
  readonly runtimeId: string
  readonly workerEntry: string
  readonly packagedWorkerEntry: string
  readonly packagedManifestDigest: string
  readonly runtimeManifestDigest: string
  readonly discoveryStartedAtMs: number
  readonly discoveryCompletedAtMs: number
  readonly discoveryDeadlineMs: number
}

type StartupContinuityFailure = {
  readonly outcome: 'extension-setup-failed' | 'target-lifecycle-failed'
  readonly reason: string
}

type StartupContinuity = {
  readonly pageTarget: ChromeLifecycleTarget
  readonly pageSession: ChromeLifecycleSession
  pageCreateObserved: boolean
  pageAttachObserved: boolean
  pageFrameId?: string
  pageNavigationId?: string
  failure?: StartupContinuityFailure
}

const sessionDomains = (targetType: ChromeLifecycleTargetType) => ({
  runtime: true as const,
  log: true as const,
  page: targetType === 'page'
})

const validSession = (session: ChromeLifecycleSession, target: ChromeLifecycleTarget): boolean =>
  nonEmpty(session.targetId) &&
  session.targetId === target.targetId &&
  nonEmpty(session.sessionId) &&
  session.targetType === target.type

const extensionOrigin = (extensionId: string): string => `chrome-extension://${extensionId}`

const workerUrlIdentity = (
  target: ChromeLifecycleTarget
): { readonly host: string; readonly entry: string; readonly exactShape: boolean } | null => {
  try {
    const url = new URL(target.url)
    if (target.type !== 'service_worker' || url.protocol !== 'chrome-extension:') return null
    return {
      host: url.host,
      entry: url.pathname.startsWith('/') ? url.pathname.slice(1) : url.pathname,
      exactShape: nonEmpty(url.host) && url.search === '' && url.hash === ''
    }
  } catch {
    return null
  }
}

const observeStartupContinuity = (
  continuity: StartupContinuity,
  event: ChromeLifecycleEvent,
  acceptedTargetId?: string
): void => {
  if (continuity.failure) return

  const fail = (reason: string, setupFailure = false): void => {
    continuity.failure = {
      outcome: acceptedTargetId === undefined && setupFailure ? 'extension-setup-failed' : 'target-lifecycle-failed',
      reason
    }
  }

  if (event.type === 'target-created' || event.type === 'target-changed') {
    if (event.target.targetId === acceptedTargetId) return
    if (event.target.targetId === continuity.pageTarget.targetId) {
      if (event.target.type !== 'page' || event.target.url !== 'about:blank') {
        fail('The startup about:blank page changed identity or URL')
      } else if (event.type === 'target-created') {
        if (continuity.pageCreateObserved) fail('The startup about:blank page was created more than once')
        continuity.pageCreateObserved = true
      }
      return
    }
    if (event.target.type === 'page') {
      fail('A replacement or second page target appeared during startup continuity')
    }
    return
  }

  if (event.type === 'target-attached') {
    if (event.target.targetId === acceptedTargetId) return
    if (event.target.targetId === continuity.pageTarget.targetId) {
      if (
        event.target.type !== 'page' ||
        event.target.url !== 'about:blank' ||
        event.sessionId !== continuity.pageSession.sessionId ||
        continuity.pageAttachObserved
      ) {
        fail('The startup about:blank page attached with an extra or divergent session')
      }
      continuity.pageAttachObserved = true
      return
    }
    if (event.target.type === 'page') {
      fail('A replacement page session attached during startup continuity')
    }
    return
  }

  if (event.type === 'target-destroyed') {
    if (event.targetId === acceptedTargetId) return
    if (event.targetId === continuity.pageTarget.targetId) {
      fail('The startup about:blank page was destroyed')
    }
    return
  }

  if (event.type === 'target-detached') {
    if (event.targetId === acceptedTargetId) return
    if (event.targetId === continuity.pageTarget.targetId) {
      fail('The startup about:blank page session detached')
    }
    return
  }

  if (event.type === 'frame-navigated') {
    if (event.targetId === acceptedTargetId) return
    if (event.targetId !== continuity.pageTarget.targetId) return
    if (
      event.sessionId !== continuity.pageSession.sessionId ||
      event.parentFrameId !== undefined ||
      event.url !== 'about:blank' ||
      !nonEmpty(event.frameId) ||
      !nonEmpty(event.navigationId)
    ) {
      fail('The startup about:blank main frame redirected or changed session')
      return
    }
    if (
      (continuity.pageFrameId !== undefined && continuity.pageFrameId !== event.frameId) ||
      (continuity.pageNavigationId !== undefined && continuity.pageNavigationId !== event.navigationId)
    ) {
      fail('The startup about:blank main-frame identity was replaced')
      return
    }
    continuity.pageFrameId = event.frameId
    continuity.pageNavigationId = event.navigationId
    return
  }

  if (event.type === 'observation-error') {
    if (acceptedTargetId === undefined) {
      fail('Pre-target lifecycle observation failed', true)
    } else if (
      event.targetId === continuity.pageTarget.targetId ||
      event.sessionId === continuity.pageSession.sessionId
    ) {
      fail('Startup page observation failed')
    }
  }
}

const contextValues = (context: ChromeLifecycleContext): readonly string[] => [
  context.candidateExact,
  context.packageDigest,
  context.profileId,
  context.processGeneration,
  context.browserVersion,
  context.browserExecutable
]

const validateTarget = (target: ChromeLifecycleTarget): boolean =>
  nonEmpty(target.targetId) &&
  target.targetId.length <= MAX_VALUE_STRING_LENGTH &&
  nonEmpty(target.url) &&
  target.url.length <= MAX_VALUE_STRING_LENGTH &&
  ['page', 'service_worker', 'other'].includes(target.type)

const validateDomSample = (sample: ChromeLifecycleDomSample, binding: ChromeLifecycleDomBinding): string | null => {
  if (
    sample.targetId !== binding.targetId ||
    sample.sessionId !== binding.sessionId ||
    sample.mainFrameId !== binding.mainFrameId ||
    sample.url !== CHROME_NATIVE_ACTION_ACCEPTED_URL
  ) {
    return 'DOM sample diverged from the bound target, session, frame, or URL'
  }
  if (!['loading', 'interactive', 'complete'].includes(sample.readyState)) {
    return 'DOM sample has an invalid readiness state'
  }
  if (typeof sample.bodyPresent !== 'boolean' || typeof sample.runtimeUnavailable !== 'boolean') {
    return 'DOM sample has invalid structural flags'
  }
  const counts = [sample.shadowHostCount, sample.shadowRootCount, sample.extensionRootCount]
  if (counts.some((count) => !Number.isSafeInteger(count) || count < 0)) {
    return 'DOM sample counts must be non-negative safe integers'
  }
  if (sample.shadowRootCount > sample.shadowHostCount || sample.extensionRootCount > sample.shadowRootCount) {
    return 'DOM sample contains contradictory shadow structure'
  }
  if (sample.extensionRootCount > 0 && !sample.bodyPresent) {
    return 'DOM sample contains an extension root without a document body'
  }
  if (sample.extensionRootCount > 1) return 'DOM sample contains multiple extension shadow roots'
  return null
}

const containsSharedRuntimeUnavailable = (value: unknown): boolean => {
  try {
    return canonicalJson(normalizeEvidence(value)).includes('Shared runtime unavailable')
  } catch {
    return false
  }
}

const privacySafeTargetUrlEvidence = (target: ChromeLifecycleTarget): JsonObject => {
  if (target.type === 'service_worker') return { targetUrl: target.url }
  if (target.type === 'other') return { targetUrlClassification: 'other-target' }
  if (target.url === 'about:blank') return { targetUrlClassification: 'startup-page' }
  if (target.url === CHROME_NATIVE_ACTION_ACCEPTED_URL) return { targetUrlClassification: 'accepted-page' }
  return { targetUrlClassification: 'unexpected-page' }
}

const privacySafeEventEvidence = (event: ChromeLifecycleEvent): JsonObject => {
  switch (event.type) {
    case 'target-created':
    case 'target-changed':
      return {
        type: event.type,
        targetId: event.target.targetId,
        targetType: event.target.type,
        ...privacySafeTargetUrlEvidence(event.target)
      }
    case 'target-destroyed':
      return { type: event.type, targetId: event.targetId }
    case 'target-attached':
      return {
        type: event.type,
        sessionId: event.sessionId,
        targetId: event.target.targetId,
        targetType: event.target.type,
        ...privacySafeTargetUrlEvidence(event.target)
      }
    case 'target-detached':
      return { type: event.type, sessionId: event.sessionId, targetId: event.targetId }
    case 'frame-navigated':
      return {
        frameId: event.frameId,
        type: event.type,
        navigationId: event.navigationId,
        parentFrameId: event.parentFrameId ?? null,
        sessionId: event.sessionId,
        targetId: event.targetId,
        urlMatchesAccepted: event.url === CHROME_NATIVE_ACTION_ACCEPTED_URL
      }
    case 'page-lifecycle':
      return {
        frameId: event.frameId,
        type: event.type,
        name: event.name,
        sessionId: event.sessionId,
        targetId: event.targetId
      }
    case 'execution-context-created':
      return {
        contextId: event.contextId,
        frameId: event.frameId,
        type: event.type,
        originType: event.origin.startsWith('chrome-extension://') ? 'extension' : 'other',
        sessionId: event.sessionId,
        targetId: event.targetId,
        world: event.world
      }
    case 'execution-context-destroyed':
      return {
        contextId: event.contextId,
        type: event.type,
        sessionId: event.sessionId,
        targetId: event.targetId
      }
    case 'console':
      return {
        classification: containsSharedRuntimeUnavailable(event.args)
          ? 'shared-runtime-unavailable'
          : event.level.toLowerCase() === 'error'
            ? 'unexpected-error'
            : 'diagnostic',
        contextId: event.contextId,
        type: event.type,
        sessionId: event.sessionId,
        targetId: event.targetId
      }
    case 'exception':
      return {
        classification: containsSharedRuntimeUnavailable([event.message, event.stack])
          ? 'shared-runtime-unavailable'
          : 'unexpected-exception',
        contextId: event.contextId ?? null,
        type: event.type,
        sessionId: event.sessionId,
        targetId: event.targetId
      }
    case 'observation-error':
      return {
        classification: 'observation-error',
        type: event.type,
        sessionId: event.sessionId ?? null,
        targetId: event.targetId ?? null
      }
  }
}

const bindingSnapshot = (
  context: ChromeLifecycleContext,
  worker: BoundWorker | undefined,
  state: BoundState | undefined,
  startedAtMs: number | null,
  deadlineMs: number | null
) => ({
  candidateExact: context.candidateExact,
  packageDigest: context.packageDigest,
  profileId: context.profileId,
  processGeneration: context.processGeneration,
  browserVersion: context.browserVersion,
  browserExecutable: context.browserExecutable,
  extensionId: worker?.runtimeId ?? null,
  packagedWorkerEntry: worker?.packagedWorkerEntry ?? null,
  packagedManifestDigest: worker?.packagedManifestDigest ?? null,
  workerTargetId: worker?.targetId ?? null,
  workerSessionId: worker?.sessionId ?? null,
  workerEntry: worker?.workerEntry ?? null,
  runtimeManifestDigest: worker?.runtimeManifestDigest ?? null,
  workerDiscoveryStartedAtMs: worker?.discoveryStartedAtMs ?? null,
  workerDiscoveryCompletedAtMs: worker?.discoveryCompletedAtMs ?? null,
  workerDiscoveryDeadlineMs: worker?.discoveryDeadlineMs ?? null,
  acceptedUrl: CHROME_NATIVE_ACTION_ACCEPTED_URL,
  pageTargetId: state?.targetId ?? null,
  pageSessionId: state?.pageSessionId ?? null,
  mainFrameId: state?.mainFrameId ?? null,
  navigationId: state?.navigationId ?? null,
  isolatedContextId: state?.isolatedContextId ?? null,
  lifecycleStartedAtMs: startedAtMs,
  lifecycleDeadlineMs: deadlineMs
})

const finish = (
  context: ChromeLifecycleContext,
  timeline: Timeline,
  outcome: ChromeNativeActionLifecycleOutcome,
  reason: string,
  finalDom: ChromeLifecycleDomSample | { readonly unavailable: string },
  worker?: BoundWorker,
  state?: BoundState,
  lifecycleStartedAtMs: number | null = null,
  lifecycleDeadlineMs: number | null = null
): ChromeNativeActionLifecycleResult => {
  const terminalAtMs = timeline.now()
  let terminalOutcome = outcome
  let terminalReason = reason
  if (outcome === 'mounted') {
    if (timeline.clockFailure) {
      terminalOutcome = 'unexpected-content-failure'
      terminalReason = timeline.clockFailure
    } else if (timeline.overflow || timeline.entries.length >= MAX_TIMELINE_ENTRIES) {
      terminalOutcome = 'unexpected-content-failure'
      terminalReason =
        timeline.overflow ?? `Timeline cannot record its terminal entry within ${MAX_TIMELINE_ENTRIES} entries`
    } else if (lifecycleDeadlineMs !== null && terminalAtMs >= lifecycleDeadlineMs) {
      terminalOutcome = 'unexpected-content-failure'
      terminalReason = 'The terminal lifecycle fence reached or exceeded the absolute deadline'
    }
  }
  const terminal = timeline.recordTerminal(terminalOutcome, terminalReason, terminalAtMs)
  terminalOutcome = terminal.outcome
  terminalReason = terminal.reason
  const binding = bindingSnapshot(context, worker, state, lifecycleStartedAtMs, lifecycleDeadlineMs)
  const evidenceDigest = digest(
    canonicalJson({
      outcome: terminalOutcome,
      reason: terminalReason,
      binding,
      timeline: timeline.entries,
      finalDom
    })
  )
  const actionAuthorization: ChromeNativeActionAuthorization | null =
    terminalOutcome === 'mounted' &&
    worker &&
    state?.pageSessionId &&
    state.mainFrameId &&
    state.navigationId &&
    state.isolatedContextId !== undefined &&
    lifecycleStartedAtMs !== null &&
    lifecycleDeadlineMs !== null
      ? {
          candidateExact: context.candidateExact,
          packageDigest: context.packageDigest,
          profileId: context.profileId,
          processGeneration: context.processGeneration,
          browserVersion: context.browserVersion,
          browserExecutable: context.browserExecutable,
          extensionId: worker.runtimeId,
          packagedWorkerEntry: worker.packagedWorkerEntry,
          packagedManifestDigest: worker.packagedManifestDigest,
          workerTargetId: worker.targetId,
          workerSessionId: worker.sessionId,
          workerEntry: worker.workerEntry,
          runtimeManifestDigest: worker.runtimeManifestDigest,
          workerDiscoveryStartedAtMs: worker.discoveryStartedAtMs,
          workerDiscoveryCompletedAtMs: worker.discoveryCompletedAtMs,
          workerDiscoveryDeadlineMs: worker.discoveryDeadlineMs,
          acceptedUrl: CHROME_NATIVE_ACTION_ACCEPTED_URL,
          pageTargetId: state.targetId,
          pageSessionId: state.pageSessionId,
          mainFrameId: state.mainFrameId,
          navigationId: state.navigationId,
          isolatedContextId: state.isolatedContextId,
          lifecycleStartedAtMs,
          lifecycleDeadlineMs,
          authorizedBeforeNativeAction: true as const,
          evidenceDigest
        }
      : null

  return deepFreeze({
    outcome: terminalOutcome,
    reason: terminalReason,
    lifecycleStartedAtMs,
    lifecycleDeadlineMs,
    evidenceDigest,
    timeline: [...timeline.entries],
    finalDom,
    actionAuthorization
  })
}

const unavailableDom = (reason: string): { readonly unavailable: string } => ({ unavailable: reason })

export const diagnoseChromeNativeActionLifecycle = async (
  adapter: ChromeNativeActionLifecycleAdapter,
  context: ChromeLifecycleContext
): Promise<ChromeNativeActionLifecycleResult> => {
  const timeline = new Timeline(adapter)
  const pendingEvents: Array<{ readonly event: ChromeLifecycleEvent; readonly atMs: number }> = []
  let packagedManifest: PackagedManifest

  try {
    if (contextValues(context).some((value) => !nonEmpty(value) || value.length > MAX_VALUE_STRING_LENGTH)) {
      throw new Error('Chrome lifecycle context identities must not be empty')
    }
    if (!/^[a-f0-9]{40}$/.test(context.candidateExact)) {
      throw new Error('Chrome lifecycle candidate exact must be a full Git object ID')
    }
    packagedManifest = asPackagedManifest(context.packagedManifest)
    timeline.record('packaged-manifest-authority', {
      manifestDigest: packagedManifest.digest,
      workerEntry: packagedManifest.workerEntry
    })
  } catch (error) {
    return finish(
      context,
      timeline,
      'extension-setup-failed',
      errorMessage(error),
      unavailableDom('accepted target was not created')
    )
  }

  try {
    await adapter.installEventSink((event) => {
      const atMs = timeline.now()
      if (!timeline.admitExternalEvent()) return
      let snapshot: ChromeLifecycleEvent
      try {
        snapshot = structuredClone(event)
      } catch {
        snapshot = { type: 'observation-error', message: 'Lifecycle event could not be snapshotted' }
      }
      if (timeline.captureEventEvidence(snapshot.type, privacySafeEventEvidence(snapshot), atMs)) {
        pendingEvents.push({ event: snapshot, atMs })
      }
    })
    timeline.record('event-sink-ready')
    await adapter.enableTargetDiscovery()
    timeline.record('target-discovery-ready')
    await adapter.enableAutoAttach({ autoAttach: true, flatten: true, waitForDebuggerOnStart: true })
    timeline.record('auto-attach-ready', { flatten: true, waitForDebuggerOnStart: true })
  } catch (error) {
    return finish(
      context,
      timeline,
      'extension-setup-failed',
      `Chrome observation setup failed: ${errorMessage(error)}`,
      unavailableDom('accepted target was not created')
    )
  }

  const workerDiscoveryStartedAtMs = timeline.now()
  const workerDiscoveryDeadlineMs = workerDiscoveryStartedAtMs + CHROME_NATIVE_ACTION_WORKER_DISCOVERY_BUDGET_MS
  if (timeline.clockFailure || !Number.isFinite(workerDiscoveryDeadlineMs)) {
    return finish(
      context,
      timeline,
      'extension-setup-failed',
      timeline.clockFailure ?? 'The worker discovery deadline is not finite',
      unavailableDom('accepted target was not created')
    )
  }
  timeline.record('worker-discovery-started', {
    workerDiscoveryStartedAtMs,
    workerDiscoveryDeadlineMs
  })

  const discoveryFence = (operation: string): void => {
    const atMs = timeline.now()
    if (timeline.clockFailure) throw new Error(timeline.clockFailure)
    if (atMs >= workerDiscoveryDeadlineMs) {
      throw new Error(`${operation} reached or exceeded the worker discovery deadline`)
    }
  }

  let startupTargets: readonly ChromeLifecycleTarget[]
  let startupInventoryAtMs: number
  try {
    startupTargets = await adapter.listStartupTargets(workerDiscoveryDeadlineMs)
    discoveryFence('Chrome startup inventory')
    startupInventoryAtMs = timeline.now()
    if (startupTargets.some((target) => !validateTarget(target))) {
      throw new Error('Chrome startup target inventory is invalid')
    }
    const targetIds = startupTargets.map(({ targetId }) => targetId)
    if (new Set(targetIds).size !== targetIds.length) {
      throw new Error('Chrome startup target identities must be unique')
    }
    timeline.record('startup-inventory', {
      pageCount: startupTargets.filter(({ type }) => type === 'page').length,
      targetCount: startupTargets.length,
      workerCount: startupTargets.filter(({ type }) => type === 'service_worker').length
    })
  } catch (error) {
    return finish(
      context,
      timeline,
      'extension-setup-failed',
      `Chrome startup inventory failed: ${errorMessage(error)}`,
      unavailableDom('accepted target was not created')
    )
  }

  const startupPages = startupTargets.filter(({ type }) => type === 'page')
  if (startupPages.length !== 1 || startupPages[0]?.url !== 'about:blank') {
    return finish(
      context,
      timeline,
      'target-lifecycle-failed',
      'Chrome must start with about:blank as its only page',
      unavailableDom('planned accepted target was not created')
    )
  }

  const startupPage = startupPages[0]!
  let startupPageSession: ChromeLifecycleSession
  try {
    startupPageSession = await adapter.ensureTargetSession(startupPage.targetId, workerDiscoveryDeadlineMs)
    discoveryFence('Startup page session binding')
    if (!validSession(startupPageSession, startupPage)) {
      throw new Error(`Session binding failed for target ${startupPage.targetId}`)
    }
    await adapter.enableSessionObservation(startupPageSession, sessionDomains('page'), workerDiscoveryDeadlineMs)
    discoveryFence('Startup page session observation')
    await adapter.resumeSession(startupPageSession.sessionId, workerDiscoveryDeadlineMs)
    discoveryFence('Startup page session resume')
    timeline.record('session-observation-ready', {
      targetId: startupPage.targetId,
      sessionId: startupPageSession.sessionId,
      targetType: 'page',
      domains: sessionDomains('page')
    })
  } catch (error) {
    return finish(
      context,
      timeline,
      'extension-setup-failed',
      `Startup page observation failed: ${errorMessage(error)}`,
      unavailableDom('accepted target was not created')
    )
  }

  const startupContinuity: StartupContinuity = {
    pageTarget: startupPage,
    pageSession: startupPageSession,
    pageCreateObserved: false,
    pageAttachObserved: false
  }

  const workerRecords = new Map<string, WorkerRecord>()
  let workerFailure: string | undefined
  let worker: BoundWorker | undefined
  let appearanceOrder = 0

  const failWorker = (reason: string): void => {
    workerFailure ??= reason
  }

  const addWorker = (target: ChromeLifecycleTarget, appearedAtMs = timeline.now()): WorkerRecord | undefined => {
    const existing = workerRecords.get(target.targetId)
    if (existing) return existing
    if (workerRecords.size >= CHROME_NATIVE_ACTION_MAX_WORKER_RECORDS) {
      failWorker(`Worker record count exceeds ${CHROME_NATIVE_ACTION_MAX_WORKER_RECORDS}`)
      return undefined
    }
    const record: WorkerRecord = {
      appearanceOrder: ++appearanceOrder,
      appearedAtMs,
      target,
      active: true,
      needsProbe: true,
      createEvents: 0,
      attachEvents: 0
    }
    workerRecords.set(target.targetId, record)
    timeline.record('worker-observed', {
      appearanceOrder: record.appearanceOrder,
      appearedAfterMs: Math.max(0, appearedAtMs - workerDiscoveryStartedAtMs),
      appearedAtMs,
      targetId: target.targetId,
      targetUrl: target.url
    })
    return record
  }

  const initialWorkerSightings = [
    ...pendingEvents.flatMap(({ event, atMs }, index) =>
      (event.type === 'target-created' || event.type === 'target-changed' || event.type === 'target-attached') &&
      event.target.type === 'service_worker'
        ? [{ target: event.target, atMs, order: index }]
        : []
    ),
    ...startupTargets
      .filter(({ type }) => type === 'service_worker')
      .map((target, index) => ({ target, atMs: startupInventoryAtMs, order: pendingEvents.length + index }))
  ].toSorted((left, right) => left.atMs - right.atMs || left.order - right.order)
  initialWorkerSightings.forEach(({ target, atMs }) => addWorker(target, atMs))

  const observeWorkerEvent = (event: ChromeLifecycleEvent, eventAtMs: number): boolean => {
    if (event.type === 'target-created' || event.type === 'target-changed' || event.type === 'target-attached') {
      const known = workerRecords.get(event.target.targetId)
      if (event.target.type !== 'service_worker' && !known) return false
      if (event.target.type !== 'service_worker') {
        known!.active = false
        known!.needsProbe = false
        known!.classification = undefined
        if (worker?.targetId === event.target.targetId) failWorker('The bound worker changed target type')
        return true
      }
      if (!validateTarget(event.target)) {
        failWorker('Observed Service Worker target identity is invalid')
        return true
      }
      const record = known ?? addWorker(event.target, eventAtMs)
      if (!record) return true

      if (event.type === 'target-created') {
        record.createEvents += 1
        if (record.createEvents > 1) {
          failWorker('A Service Worker target was created more than once')
          return true
        }
        if (worker?.targetId === record.target.targetId) {
          failWorker('The bound exact worker was created more than once')
          return true
        }
      }
      if (event.type === 'target-attached') {
        record.attachEvents += 1
        if (record.attachEvents > 1) {
          failWorker('A Service Worker target attached more than once')
          return true
        }
        if (!nonEmpty(event.sessionId) || event.sessionId.length > MAX_VALUE_STRING_LENGTH) {
          failWorker('Observed Service Worker session identity is invalid')
          return true
        }
        if (record.sessionId !== undefined && record.sessionId !== event.sessionId) {
          failWorker('A Service Worker attached with a divergent session identity')
          return true
        }
        if (worker?.targetId === record.target.targetId) {
          failWorker('The bound exact worker attached again after binding')
          return true
        }
        record.sessionId = event.sessionId
      }
      if (worker?.targetId === record.target.targetId && event.target.url !== worker.targetUrl) {
        failWorker('The bound exact worker changed URL or entry')
        return true
      }
      record.target = event.target
      record.active = true
      record.classification = undefined
      record.unresolvedReason = undefined
      record.needsProbe = true
      return true
    }

    if (event.type === 'target-destroyed' || event.type === 'target-detached') {
      const record = workerRecords.get(event.targetId)
      if (!record) return false
      if (event.type === 'target-detached' && record.sessionId !== undefined && event.sessionId !== record.sessionId) {
        failWorker('A Service Worker detached with a divergent session identity')
        return true
      }
      record.active = false
      record.needsProbe = false
      record.classification = undefined
      if (worker?.targetId === event.targetId) failWorker('The bound exact worker disappeared')
      timeline.record('worker-inactive', {
        appearanceOrder: record.appearanceOrder,
        targetId: record.target.targetId,
        reason: event.type
      })
      return true
    }

    if (event.type === 'observation-error') {
      const record = [...workerRecords.values()].find(
        ({ target, sessionId }) => event.targetId === target.targetId || event.sessionId === sessionId
      )
      if (!record) return false
      record.classification = undefined
      record.needsProbe = false
      record.unresolvedReason = event.message
      if (worker?.targetId === record.target.targetId) failWorker('Bound worker observation failed')
      return true
    }

    return false
  }

  const workerFence = (deadlineMs: number, operation: string): string | undefined => {
    const atMs = timeline.now()
    if (timeline.clockFailure) return timeline.clockFailure
    return atMs >= deadlineMs ? `${operation} reached or exceeded its absolute deadline` : undefined
  }

  const probeWorker = async (record: WorkerRecord, deadlineMs: number): Promise<void> => {
    if (!record.active || !record.needsProbe || workerFailure) return
    const beforeProbe = workerFence(deadlineMs, 'Worker classification')
    if (beforeProbe) {
      record.needsProbe = false
      record.unresolvedReason = beforeProbe
      return
    }

    try {
      const session = await adapter.ensureTargetSession(record.target.targetId, deadlineMs)
      if (!validSession(session, record.target)) {
        throw new EvidenceLimitError(`Session binding failed for worker ${record.target.targetId}`)
      }
      if (record.sessionId !== undefined && record.sessionId !== session.sessionId) {
        throw new EvidenceLimitError('Service Worker event and adapter session identities diverged')
      }
      if (workerFence(deadlineMs, 'Worker session binding')) {
        record.needsProbe = false
        record.unresolvedReason = 'Worker session binding reached or exceeded its absolute deadline'
        return
      }
      record.sessionId = session.sessionId

      if (!record.observationReady) {
        await adapter.enableSessionObservation(session, sessionDomains('service_worker'), deadlineMs)
        if (workerFence(deadlineMs, 'Worker session observation')) {
          record.needsProbe = false
          record.unresolvedReason = 'Worker session observation reached or exceeded its absolute deadline'
          return
        }
        await adapter.resumeSession(session.sessionId, deadlineMs)
        if (workerFence(deadlineMs, 'Worker session resume')) {
          record.needsProbe = false
          record.unresolvedReason = 'Worker session resume reached or exceeded its absolute deadline'
          return
        }
        record.observationReady = true
        timeline.record('session-observation-ready', {
          targetId: record.target.targetId,
          sessionId: session.sessionId,
          targetType: 'service_worker',
          domains: sessionDomains('service_worker')
        })
      }

      const identity = await adapter.readWorkerIdentity(session.sessionId, deadlineMs)
      if (workerFence(deadlineMs, 'Worker identity evaluation')) {
        record.needsProbe = false
        record.unresolvedReason = 'Worker identity evaluation reached or exceeded its absolute deadline'
        return
      }
      if (typeof identity.runtimeId !== 'string' || identity.runtimeId.length > MAX_VALUE_STRING_LENGTH) {
        throw new EvidenceLimitError('Evaluated chrome.runtime.id is not a bounded string')
      }
      const runtimeManifest = assertJson(identity.manifest)
      if (runtimeManifest === null || Array.isArray(runtimeManifest) || typeof runtimeManifest !== 'object') {
        throw new EvidenceLimitError('Evaluated worker manifest is not a JSON object')
      }
      const runtimeCanonical = JSON.stringify(runtimeManifest)
      const runtimeManifestDigest = digest(runtimeCanonical)
      const difference = manifestDiff(packagedManifest.value, runtimeManifest)
      const urlIdentity = workerUrlIdentity(record.target)
      const workerEntry = urlIdentity?.entry ?? ''
      const exact =
        urlIdentity !== null &&
        urlIdentity.exactShape &&
        nonEmpty(identity.runtimeId) &&
        urlIdentity.host === identity.runtimeId &&
        workerEntry === packagedManifest.workerEntry &&
        runtimeManifestDigest === packagedManifest.digest
      const evidence = {
        appearanceOrder: record.appearanceOrder,
        diff: difference.entries,
        diffOverflow: difference.overflow,
        entryMatches: workerEntry === packagedManifest.workerEntry,
        exact,
        manifestProjection: manifestProjection(runtimeManifest),
        packagedManifestDigest: packagedManifest.digest,
        runtimeId: identity.runtimeId,
        runtimeIdMatchesHost: urlIdentity !== null && urlIdentity.host === identity.runtimeId,
        runtimeManifestDigest,
        sessionId: session.sessionId,
        targetId: record.target.targetId,
        targetUrl: record.target.url,
        workerEntry
      }
      assertBoundedEvidence(evidence)
      record.classification = { runtimeId: identity.runtimeId, workerEntry, runtimeManifestDigest, exact }
      record.needsProbe = false
      record.unresolvedReason = undefined
      timeline.record('worker-classified', evidence)
    } catch (error) {
      record.classification = undefined
      record.needsProbe = false
      record.unresolvedReason = errorMessage(error)
      if (error instanceof EvidenceLimitError) {
        failWorker(`Worker evidence is unclassifiable: ${record.unresolvedReason}`)
      } else {
        timeline.record('worker-probe-unresolved', {
          appearanceOrder: record.appearanceOrder,
          reason: record.unresolvedReason,
          targetId: record.target.targetId
        })
      }
    }
  }

  const probePendingWorkers = async (deadlineMs: number): Promise<void> => {
    for (const record of workerRecords.values()) {
      await probeWorker(record, deadlineMs)
      if (workerFailure) return
    }
  }

  const activeExactWorkers = (): WorkerRecord[] =>
    [...workerRecords.values()].filter(({ active, classification }) => active && classification?.exact)

  const unresolvedWorkers = (): WorkerRecord[] =>
    [...workerRecords.values()].filter(({ active, classification }) => active && classification === undefined)

  const processPreTargetEvent = (event: ChromeLifecycleEvent, eventAtMs: number): void => {
    observeWorkerEvent(event, eventAtMs)
    observeStartupContinuity(startupContinuity, event)
  }

  while (!worker && !workerFailure && !startupContinuity.failure) {
    while (pendingEvents.length > 0 && !workerFailure && !startupContinuity.failure) {
      const pending = pendingEvents.shift()!
      processPreTargetEvent(pending.event, pending.atMs)
    }
    await probePendingWorkers(workerDiscoveryDeadlineMs)
    if (pendingEvents.length > 0) continue
    if (timeline.overflow || timeline.clockFailure) {
      failWorker(timeline.overflow ?? timeline.clockFailure!)
      break
    }

    const exactWorkers = activeExactWorkers()
    if (exactWorkers.length > 1) {
      failWorker('More than one exact packaged Service Worker exists at the decision fence')
      break
    }
    if (exactWorkers.length === 1 && unresolvedWorkers().length === 0) {
      const discoveryCompletedAtMs = timeline.now()
      if (timeline.clockFailure || discoveryCompletedAtMs >= workerDiscoveryDeadlineMs) {
        failWorker(
          timeline.clockFailure ??
            'The final worker discovery decision reached or exceeded the worker discovery deadline'
        )
        break
      }
      const record = exactWorkers[0]!
      const classification = record.classification!
      if (!record.sessionId) {
        failWorker('The exact packaged Service Worker has no attached session')
        break
      }
      worker = {
        targetId: record.target.targetId,
        sessionId: record.sessionId,
        targetUrl: record.target.url,
        runtimeId: classification.runtimeId,
        workerEntry: classification.workerEntry,
        packagedWorkerEntry: packagedManifest.workerEntry,
        packagedManifestDigest: packagedManifest.digest,
        runtimeManifestDigest: classification.runtimeManifestDigest,
        discoveryStartedAtMs: workerDiscoveryStartedAtMs,
        discoveryCompletedAtMs,
        discoveryDeadlineMs: workerDiscoveryDeadlineMs
      }
      timeline.record('worker-bound', worker, discoveryCompletedAtMs)
      break
    }

    const beforeWait = timeline.now()
    if (timeline.clockFailure || beforeWait >= workerDiscoveryDeadlineMs) break
    let delivered: boolean
    try {
      delivered = await adapter.waitForEvent(workerDiscoveryDeadlineMs)
    } catch (error) {
      failWorker(`Worker discovery observation failed: ${errorMessage(error)}`)
      break
    }
    const afterWait = timeline.now()
    if (delivered && pendingEvents.length === 0) {
      failWorker('Worker discovery adapter reported an event without delivering it to the sink')
      break
    }
    if (timeline.clockFailure || afterWait > workerDiscoveryDeadlineMs) {
      failWorker(timeline.clockFailure ?? 'Worker discovery evidence arrived after the absolute deadline')
      break
    }
    if (!delivered && afterWait === beforeWait) {
      failWorker('Worker discovery adapter made no monotonic progress')
      break
    }
  }

  if (!worker && !workerFailure && !startupContinuity.failure) {
    const unresolved = unresolvedWorkers()
    workerFailure =
      unresolved.length > 0
        ? `Worker discovery ended with ${unresolved.length} unresolved candidate(s)`
        : 'No exact packaged Service Worker appeared before the discovery deadline'
  }
  if (startupContinuity.failure) {
    return finish(
      context,
      timeline,
      startupContinuity.failure.outcome,
      startupContinuity.failure.reason,
      unavailableDom('planned accepted target was not created'),
      worker
    )
  }
  if (!worker || workerFailure) {
    return finish(
      context,
      timeline,
      'extension-setup-failed',
      workerFailure ?? 'Exact packaged Service Worker binding is unavailable',
      unavailableDom('planned accepted target was not created'),
      worker
    )
  }

  const lifecycleStartedAtMs = timeline.now()
  const lifecycleDeadlineMs = lifecycleStartedAtMs + CHROME_NATIVE_ACTION_LIFECYCLE_BUDGET_MS
  if (timeline.clockFailure || !Number.isFinite(lifecycleDeadlineMs)) {
    return finish(
      context,
      timeline,
      'unexpected-content-failure',
      timeline.clockFailure ?? 'The absolute lifecycle deadline is not finite',
      unavailableDom('planned accepted target was not created'),
      worker,
      undefined,
      lifecycleStartedAtMs,
      lifecycleDeadlineMs
    )
  }
  timeline.record('target-create-requested', {
    url: CHROME_NATIVE_ACTION_ACCEPTED_URL,
    lifecycleDeadlineMs
  })

  const deadlineFenceAfter = (operation: string): { readonly atMs: number; readonly failure?: string } => {
    const atMs = timeline.now()
    if (timeline.clockFailure) return { atMs, failure: timeline.clockFailure }
    if (atMs >= lifecycleDeadlineMs) {
      return { atMs, failure: `${operation} reached or exceeded the absolute lifecycle deadline` }
    }
    return { atMs }
  }

  let state: BoundState
  try {
    const created = await adapter.createTarget(CHROME_NATIVE_ACTION_ACCEPTED_URL, lifecycleDeadlineMs)
    if (
      !nonEmpty(created.targetId) ||
      created.targetId.length > MAX_VALUE_STRING_LENGTH ||
      startupTargets.some(({ targetId }) => targetId === created.targetId) ||
      workerRecords.has(created.targetId)
    ) {
      throw new Error('Target.createTarget returned an invalid or pre-existing target identity')
    }
    state = { targetId: created.targetId, targetDestroyed: false }
    const createFence = deadlineFenceAfter('Target.createTarget')
    if (createFence.failure) state.deadlineFailure = createFence.failure
    timeline.record('target-create-returned', { targetId: state.targetId }, createFence.atMs)
  } catch (error) {
    return finish(
      context,
      timeline,
      'target-lifecycle-failed',
      `Sole accepted target creation failed: ${errorMessage(error)}`,
      unavailableDom('accepted target was not addressable'),
      worker,
      undefined,
      lifecycleStartedAtMs,
      lifecycleDeadlineMs
    )
  }

  const validateBoundWorker = (): void => {
    const record = workerRecords.get(worker.targetId)
    const classification = record?.classification
    if (!record?.active) {
      state.extensionFailure = 'The bound exact worker is no longer active'
      return
    }
    if (!classification) return
    if (
      record.sessionId !== worker.sessionId ||
      record.target.url !== worker.targetUrl ||
      classification.runtimeId !== worker.runtimeId ||
      classification.workerEntry !== worker.workerEntry ||
      classification.runtimeManifestDigest !== worker.runtimeManifestDigest ||
      !classification.exact
    ) {
      state.extensionFailure = 'The bound exact worker target/session/ID/entry/manifest tuple changed'
      return
    }
    if (activeExactWorkers().some(({ target }) => target.targetId !== worker.targetId)) {
      state.extensionFailure = 'A second exact packaged Service Worker appeared after binding'
    }
  }

  const processEvent = async (event: ChromeLifecycleEvent, eventAtMs: number): Promise<void> => {
    if (observeWorkerEvent(event, eventAtMs)) {
      await probePendingWorkers(lifecycleDeadlineMs)
      if (workerFailure) state.extensionFailure ??= workerFailure
      validateBoundWorker()
      const workerWasReclassifiedAsPage =
        (event.type === 'target-created' || event.type === 'target-changed' || event.type === 'target-attached') &&
        event.target.type === 'page'
      if (!workerWasReclassifiedAsPage) return
    }

    observeStartupContinuity(startupContinuity, event, state.targetId)
    if (startupContinuity.failure) {
      state.targetFailure = startupContinuity.failure.reason
      return
    }
    if (state.extensionFailure || state.targetFailure || state.unexpectedFailure || state.sharedRuntimeUnavailable)
      return

    if (event.type === 'target-created' || event.type === 'target-changed') {
      if (event.target.targetId === state.targetId) {
        if (event.target.type !== 'page' || event.target.url !== CHROME_NATIVE_ACTION_ACCEPTED_URL) {
          state.targetFailure = 'The bound target changed type or URL'
        }
        return
      }
      if (event.target.type === 'page') {
        if (event.target.targetId === startupPages[0]!.targetId) {
          if (event.target.url !== 'about:blank') {
            state.targetFailure = 'The startup about:blank page was navigated or reused during the bound lifecycle'
          }
        } else {
          state.targetFailure = 'A replacement or second page target appeared during the bound lifecycle'
        }
      }
      return
    }

    if (event.type === 'target-destroyed') {
      if (event.targetId === state.targetId) {
        state.targetDestroyed = true
        state.targetFailure = 'The sole accepted target was destroyed'
      }
      return
    }

    if (event.type === 'target-attached') {
      if (event.target.targetId !== state.targetId) {
        if (event.target.type === 'page' && event.target.targetId !== startupPages[0]!.targetId) {
          state.targetFailure = 'A replacement page session attached during the bound lifecycle'
        }
        return
      }
      if (
        event.target.type !== 'page' ||
        event.target.url !== CHROME_NATIVE_ACTION_ACCEPTED_URL ||
        !nonEmpty(event.sessionId) ||
        state.pageSessionId !== undefined
      ) {
        state.targetFailure = 'The accepted target attached with a divergent session binding'
        return
      }
      state.pageSessionId = event.sessionId
      const session: ChromeLifecycleSession = {
        targetId: state.targetId,
        sessionId: event.sessionId,
        targetType: 'page'
      }
      try {
        const beforeObservationFailure =
          state.deadlineFailure ?? deadlineFenceAfter('Accepted session observation').failure
        if (beforeObservationFailure) {
          state.deadlineFailure = beforeObservationFailure
          return
        }
        await adapter.enableSessionObservation(session, sessionDomains('page'), lifecycleDeadlineMs)
        const observationFence = deadlineFenceAfter('Accepted session observation')
        if (observationFence.failure) {
          state.deadlineFailure = observationFence.failure
          return
        }
        await adapter.resumeSession(session.sessionId, lifecycleDeadlineMs)
        const resumeFence = deadlineFenceAfter('Accepted session resume')
        if (resumeFence.failure) {
          state.deadlineFailure = resumeFence.failure
          return
        }
        state.pageObservationReady = true
        timeline.record(
          'session-observation-ready',
          {
            targetId: state.targetId,
            sessionId: event.sessionId,
            targetType: 'page',
            domains: sessionDomains('page')
          },
          resumeFence.atMs
        )
      } catch (error) {
        state.targetFailure = `Accepted target observation failed: ${errorMessage(error)}`
      }
      return
    }

    if (event.type === 'target-detached') {
      if (event.targetId === state.targetId) {
        state.targetFailure =
          event.sessionId === state.pageSessionId
            ? 'The accepted target session detached'
            : 'The accepted target emitted a divergent detached session'
      }
      return
    }

    if (event.type === 'observation-error') {
      state.unexpectedFailure = 'Accepted target lifecycle observation failed'
      return
    }

    if (event.targetId !== state.targetId) return

    if ('sessionId' in event && state.pageSessionId !== undefined && event.sessionId !== state.pageSessionId) {
      state.targetFailure = 'Lifecycle evidence used a divergent page session'
      return
    }

    if (event.type === 'frame-navigated') {
      if (event.parentFrameId !== undefined) return
      if (!state.pageSessionId || event.url !== CHROME_NATIVE_ACTION_ACCEPTED_URL || !nonEmpty(event.navigationId)) {
        state.targetFailure = 'The accepted target did not bind its planned main-frame navigation'
        return
      }
      if (
        (state.mainFrameId !== undefined && state.mainFrameId !== event.frameId) ||
        (state.navigationId !== undefined && state.navigationId !== event.navigationId)
      ) {
        state.targetFailure = 'The bound main frame or navigation was replaced'
        return
      }
      state.mainFrameId = event.frameId
      state.navigationId = event.navigationId
      return
    }

    if (event.type === 'execution-context-created') {
      const exactContext =
        state.mainFrameId !== undefined &&
        event.frameId === state.mainFrameId &&
        event.world === 'isolated' &&
        event.origin === extensionOrigin(worker.runtimeId)
      if (!exactContext) return
      if (state.isolatedContextId !== undefined && state.isolatedContextId !== event.contextId) {
        state.unexpectedFailure = 'Multiple exact page-bound isolated contexts appeared'
        return
      }
      state.isolatedContextId = event.contextId
      return
    }

    if (event.type === 'execution-context-destroyed') {
      if (event.contextId === state.isolatedContextId) {
        state.unexpectedFailure = 'The exact page-bound isolated context was destroyed'
      }
      return
    }

    if (event.type === 'console') {
      if (event.contextId !== state.isolatedContextId) return
      if (containsSharedRuntimeUnavailable(event.args)) {
        state.sharedRuntimeUnavailable = 'The exact isolated context reported Shared runtime unavailable'
      } else if (event.level.toLowerCase() === 'error') {
        state.unexpectedFailure = 'The exact isolated context reported an unexpected console error'
      }
      return
    }

    if (event.type === 'exception') {
      if (event.contextId !== state.isolatedContextId) return
      if (containsSharedRuntimeUnavailable([event.message, event.stack])) {
        state.sharedRuntimeUnavailable = 'The exact isolated context reported Shared runtime unavailable'
      } else {
        state.unexpectedFailure = 'The exact isolated context reported an unexpected exception'
      }
      return
    }
  }

  let finalDom: ChromeLifecycleDomSample | { readonly unavailable: string } | undefined
  let finalDomMissing = false

  const sampleDom = async (): Promise<ChromeLifecycleDomSample | undefined> => {
    if (!state.pageSessionId || !state.pageObservationReady || !state.mainFrameId || state.targetDestroyed)
      return undefined
    const binding: ChromeLifecycleDomBinding = {
      targetId: state.targetId,
      sessionId: state.pageSessionId,
      mainFrameId: state.mainFrameId
    }
    try {
      const adapterSample = await adapter.sampleDom(binding, lifecycleDeadlineMs)
      const sampleFence = deadlineFenceAfter('DOM sampling')
      if (sampleFence.failure) state.deadlineFailure ??= sampleFence.failure
      const sample: ChromeLifecycleDomSample = {
        targetId: adapterSample.targetId,
        sessionId: adapterSample.sessionId,
        mainFrameId: adapterSample.mainFrameId,
        url: adapterSample.url,
        readyState: adapterSample.readyState,
        bodyPresent: adapterSample.bodyPresent,
        shadowHostCount: adapterSample.shadowHostCount,
        shadowRootCount: adapterSample.shadowRootCount,
        extensionRootCount: adapterSample.extensionRootCount,
        runtimeUnavailable: adapterSample.runtimeUnavailable
      }
      const problem = validateDomSample(sample, binding)
      if (problem) {
        state.unexpectedFailure = problem
        return undefined
      }
      timeline.record('dom-sample', sample, sampleFence.atMs)
      if (sample.runtimeUnavailable && state.isolatedContextId !== undefined) {
        state.sharedRuntimeUnavailable = 'The exact isolated context exposed the Runtime-unavailable marker'
      }
      if (sample.extensionRootCount === 1 && state.isolatedContextId !== undefined) {
        finalDom = sample
      }
      return sample
    } catch (error) {
      const sampleFence = deadlineFenceAfter('DOM sampling')
      if (sampleFence.failure) state.deadlineFailure ??= sampleFence.failure
      finalDomMissing = true
      finalDom = unavailableDom(errorMessage(error))
      timeline.record('dom-sample-unavailable', { reason: errorMessage(error) }, sampleFence.atMs)
      return undefined
    }
  }

  while (true) {
    while (pendingEvents.length > 0) {
      const pending = pendingEvents.shift()!
      await processEvent(pending.event, pending.atMs)
      if (state.extensionFailure || state.targetFailure || state.unexpectedFailure || state.sharedRuntimeUnavailable)
        break
    }

    if (
      unresolvedWorkers().length > 0 &&
      (state.targetFailure ||
        state.unexpectedFailure ||
        state.sharedRuntimeUnavailable ||
        timeline.overflow ||
        timeline.clockFailure)
    ) {
      state.extensionFailure ??= 'A later Service Worker remained unresolved before the terminal decision'
    }

    if (
      state.extensionFailure ||
      state.targetFailure ||
      state.unexpectedFailure ||
      state.sharedRuntimeUnavailable ||
      timeline.overflow ||
      timeline.clockFailure
    ) {
      break
    }

    const beforeWait = timeline.now()
    if (timeline.clockFailure) break
    if (beforeWait >= lifecycleDeadlineMs) {
      if (unresolvedWorkers().length > 0) {
        state.extensionFailure = 'A later Service Worker remained unresolved at the lifecycle deadline'
      }
      break
    }

    let delivered: boolean
    try {
      delivered = await adapter.waitForEvent(lifecycleDeadlineMs)
    } catch (error) {
      state.unexpectedFailure = `Lifecycle event observation failed: ${errorMessage(error)}`
      break
    }

    const afterWait = timeline.now()
    if (delivered && pendingEvents.length === 0) {
      state.unexpectedFailure = 'Lifecycle adapter reported an event without delivering it to the sink'
      break
    }
    if (timeline.clockFailure || afterWait >= lifecycleDeadlineMs) {
      state.deadlineFailure ??= timeline.clockFailure ?? 'Lifecycle observation reached the absolute deadline'
      if (delivered) {
        state.unexpectedFailure = 'Lifecycle evidence arrived at or after the absolute deadline'
        break
      }
    }
    if (!delivered) {
      if (unresolvedWorkers().length > 0) {
        if (afterWait >= lifecycleDeadlineMs) {
          state.extensionFailure = 'A later Service Worker remained unresolved at the lifecycle deadline'
          break
        }
        if (afterWait === beforeWait) {
          state.unexpectedFailure = 'Lifecycle adapter made no monotonic progress'
          break
        }
        continue
      }
      const sample = await sampleDom()
      if (finalDom || state.unexpectedFailure || state.sharedRuntimeUnavailable || finalDomMissing) break
      if (afterWait >= lifecycleDeadlineMs) break
      if (afterWait === beforeWait && sample?.extensionRootCount !== 1) {
        state.unexpectedFailure = 'Lifecycle adapter made no monotonic progress'
        break
      }
    }
  }

  while (
    pendingEvents.length > 0 &&
    !state.extensionFailure &&
    !state.targetFailure &&
    !state.unexpectedFailure &&
    !state.sharedRuntimeUnavailable
  ) {
    const pending = pendingEvents.shift()!
    await processEvent(pending.event, pending.atMs)
  }

  if (!finalDom) {
    const addressable = state.pageSessionId && state.pageObservationReady && state.mainFrameId && !state.targetDestroyed
    if (addressable) {
      const sample = await sampleDom()
      if (sample) finalDom = sample
    } else {
      const reason = state.targetDestroyed
        ? 'bound target was destroyed before final sampling'
        : 'bound target session and main frame were unavailable for final sampling'
      finalDom = unavailableDom(reason)
      timeline.record('dom-sample-unavailable', { reason })
    }
  }

  if (!finalDom) {
    finalDomMissing = true
    finalDom = unavailableDom('Final DOM evidence is unavailable')
  }

  let outcome: ChromeNativeActionLifecycleOutcome
  let reason: string
  if (state.extensionFailure) {
    outcome = 'extension-setup-failed'
    reason = state.extensionFailure
  } else if (state.targetFailure) {
    outcome = 'target-lifecycle-failed'
    reason = state.targetFailure
  } else if (!state.pageSessionId || !state.mainFrameId || !state.navigationId) {
    outcome = 'target-lifecycle-failed'
    reason = 'The sole accepted target did not complete its bound attach and navigation lifecycle'
  } else if (timeline.overflow || timeline.clockFailure || finalDomMissing || state.unexpectedFailure) {
    outcome = 'unexpected-content-failure'
    reason =
      timeline.overflow ?? timeline.clockFailure ?? state.unexpectedFailure ?? 'Final DOM evidence is unavailable'
  } else if (state.sharedRuntimeUnavailable) {
    outcome = 'shared-runtime-unavailable'
    reason = state.sharedRuntimeUnavailable
  } else if (state.isolatedContextId === undefined) {
    outcome = 'content-context-absent'
    reason = 'No exact page-bound extension isolated context appeared within the lifecycle budget'
  } else if ('unavailable' in finalDom) {
    outcome = 'unexpected-content-failure'
    reason = finalDom.unavailable
  } else if (finalDom.extensionRootCount !== 1) {
    outcome = 'content-mount-absent'
    reason = 'The exact isolated context appeared without an extension shadow root'
  } else if (state.deadlineFailure) {
    outcome = 'unexpected-content-failure'
    reason = state.deadlineFailure
  } else {
    outcome = 'mounted'
    reason = 'The exact page-bound isolated context mounted one clean extension shadow root'
  }

  return finish(context, timeline, outcome, reason, finalDom, worker, state, lifecycleStartedAtMs, lifecycleDeadlineMs)
}
