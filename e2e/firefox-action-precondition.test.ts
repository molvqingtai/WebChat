import { describe, expect, it } from 'vitest'

import {
  assertFirefoxActionBinding,
  FIREFOX_ACTION_ADDON_ID,
  prepareFirefoxActionPrecondition,
  type FirefoxActionPreconditionError,
  type FirefoxActionContext,
  type FirefoxActionPreconditionAdapter,
  type FirefoxActionPreconditionErrorCode,
  type FirefoxActionTab
} from './firefox-action-precondition'

const context: FirefoxActionContext = {
  profileId: 'owned-profile',
  generationId: 'generation-1',
  packageId: 'exact-package',
  addonId: FIREFOX_ACTION_ADDON_ID,
  acceptedTarget: 'https://example.com/room'
}

const ordinaryTab = (handle: string, url = 'about:blank', active = false, testOwned = true): FirefoxActionTab => ({
  identity: `physical:${handle}`,
  url,
  kind: 'ordinary',
  testOwned,
  active
})

const optionsTab = (handle: string, active = false): FirefoxActionTab => ({
  identity: `physical:${handle}`,
  url: 'moz-extension://exact-addon/options.html',
  kind: 'options',
  testOwned: true,
  active
})

type HandleOperation = 'navigate' | 'runtime' | 'activate'

type OperationSideEffect =
  | { readonly operation: HandleOperation; readonly kind: 'create' }
  | { readonly operation: HandleOperation; readonly kind: 'replace'; readonly identity: string }
  | { readonly operation: HandleOperation; readonly kind: 'change-classification'; readonly identity: string }

class FakeFirefoxAdapter implements FirefoxActionPreconditionAdapter {
  tabs: FirefoxActionTab[]
  readonly baseHandles = new Map<string, string>()
  readonly redirectedHandleIdentities = new Map<string, string>()
  readonly runtimeReadyIdentities = new Set<string>()
  readonly runtimeChecks: string[] = []
  readonly handleRequests: string[] = []
  readonly operationTrace: string[] = []
  readonly createdHandles: string[] = []
  readonly nonActivatingLookups = new Set<string>()
  currentHandleToken: string | undefined
  lookupActiveIdentities: readonly string[] | undefined
  private currentCapability: { identity: string; handle: string } | undefined
  private capabilitySequence = 0
  nativeClicks = 0
  allowCreate = true
  allowNavigation = true
  activateWorks = true
  runtimeReadyAfterNavigation = true
  lookupCreatesPhysicalTab = false
  lookupChangesClassification = false
  operationSideEffect: OperationSideEffect | undefined
  readonly appliedOperationSideEffects: OperationSideEffect[] = []

  constructor(tabs: readonly FirefoxActionTab[], readyHandles: readonly string[] = []) {
    this.tabs = tabs.map((tab) => ({ ...tab }))
    this.tabs.forEach((tab) => this.baseHandles.set(tab.identity, tab.identity.replace(/^physical:/, '')))
    readyHandles.forEach((handle) => this.runtimeReadyIdentities.add(`physical:${handle}`))
  }

  async listTabs() {
    return this.tabs.map((tab) => ({ ...tab }))
  }

  async getCurrentHandle(identity: string) {
    const requestedTab = this.tabs.find((tab) => tab.identity === identity)
    const currentIdentity = this.redirectedHandleIdentities.get(identity) ?? identity
    const baseHandle = this.baseHandles.get(currentIdentity)
    if (!requestedTab || !baseHandle) {
      throw new Error(`Unknown physical tab identity: ${identity}`)
    }

    this.handleRequests.push(identity)
    this.operationTrace.push(`lookup:${currentIdentity}`)

    if (this.lookupCreatesPhysicalTab) {
      this.lookupCreatesPhysicalTab = false
      const sideEffect = ordinaryTab('lookup-side-effect')
      this.tabs.push(sideEffect)
      this.baseHandles.set(sideEffect.identity, 'lookup-side-effect')
    }

    if (this.lookupChangesClassification) {
      this.lookupChangesClassification = false
      this.tabs = this.tabs.map((tab) =>
        tab.identity === identity
          ? {
              ...tab,
              url: 'moz-extension://exact-addon/options.html',
              kind: 'options'
            }
          : tab
      )
    }

    const handle = this.currentHandleToken ?? `${baseHandle}@${++this.capabilitySequence}`
    this.currentCapability = { identity: currentIdentity, handle }

    if (this.lookupActiveIdentities !== undefined) {
      this.tabs = this.tabs.map((candidate) => ({
        ...candidate,
        active: this.lookupActiveIdentities?.includes(candidate.identity) ?? false
      }))
    } else if (!this.nonActivatingLookups.has(identity)) {
      this.tabs = this.tabs.map((tab) => ({ ...tab, active: tab.identity === currentIdentity }))
    }

    return { identity: currentIdentity, handle }
  }

  async createTab() {
    const handle = `created-${this.createdHandles.length + 1}`
    this.createdHandles.push(handle)

    if (this.allowCreate) {
      const tab = ordinaryTab(handle, 'about:blank', true)
      this.baseHandles.set(tab.identity, handle)
      this.tabs = this.tabs.map((tab) => ({ ...tab, active: false })).concat(tab)
    }

    this.currentCapability = undefined
    return `physical:${handle}`
  }

  async navigateTab(handle: string, target: string) {
    const identity = this.consumeCapability(handle, 'navigate')
    if (!identity || !this.allowNavigation) {
      return
    }

    this.tabs = this.tabs.map((tab) => (tab.identity === identity ? { ...tab, url: target, kind: 'ordinary' } : tab))

    if (this.runtimeReadyAfterNavigation) {
      this.runtimeReadyIdentities.add(identity)
    }

    this.applyOperationSideEffect('navigate')
  }

  async isContentRuntimeReady(handle: string) {
    this.runtimeChecks.push(handle)
    const identity = this.consumeCapability(handle, 'runtime')
    const ready = identity ? this.runtimeReadyIdentities.has(identity) : false
    if (identity) {
      this.applyOperationSideEffect('runtime')
    }
    return ready
  }

  async activateTab(handle: string) {
    const identity = this.consumeCapability(handle, 'activate')
    if (identity && this.activateWorks) {
      this.tabs = this.tabs.map((tab) => ({ ...tab, active: tab.identity === identity }))
    }
    if (identity) {
      this.applyOperationSideEffect('activate')
    }
  }

  async hasNativeActionStarted() {
    return this.nativeClicks > 0
  }

  clickNativeAction() {
    this.nativeClicks += 1
    this.currentCapability = undefined
    this.tabs = this.tabs.map((tab) =>
      tab.active && tab.kind === 'ordinary'
        ? {
            ...tab,
            url: 'moz-extension://exact-addon/options.html',
            kind: 'options'
          }
        : tab
    )
  }

  replaceBoundContentAfterAction(identity: string) {
    this.nativeClicks += 1
    const replacement = ordinaryTab('post-action-repair', context.acceptedTarget, false)
    this.baseHandles.set(replacement.identity, 'post-action-repair')
    this.tabs = this.tabs
      .map((tab) =>
        tab.identity === identity
          ? {
              ...tab,
              url: 'moz-extension://exact-addon/options.html',
              kind: 'options' as const,
              active: false
            }
          : tab
      )
      .concat(replacement)
    this.runtimeReadyIdentities.add(replacement.identity)
    this.currentCapability = undefined
  }

  remapMarionetteHandle(identity: string, remappedHandle: string) {
    this.baseHandles.set(identity, remappedHandle)
    this.currentCapability = undefined
  }

  invalidateHandleWithoutChangingPhysicalInventory(identity: string, currentHandle: string) {
    this.baseHandles.set(identity, currentHandle)
    this.currentCapability = undefined
  }

  redirectCurrentHandle(identity: string, currentIdentity: string) {
    this.redirectedHandleIdentities.set(identity, currentIdentity)
  }

  dropCurrentHandle(identity: string) {
    this.baseHandles.delete(identity)
  }

  acceptedContentHandles(target = context.acceptedTarget) {
    return this.tabs
      .filter((tab) => tab.kind === 'ordinary' && tab.url === target)
      .map((tab) => this.requireBaseHandle(tab.identity))
  }

  private applyOperationSideEffect(operation: HandleOperation) {
    const sideEffect = this.operationSideEffect
    if (!sideEffect || sideEffect.operation !== operation) {
      return
    }

    this.operationSideEffect = undefined
    this.appliedOperationSideEffects.push(sideEffect)

    if (sideEffect.kind === 'create') {
      const created = ordinaryTab(`${operation}-side-effect`)
      this.tabs.push(created)
      this.baseHandles.set(created.identity, `${operation}-side-effect`)
      return
    }

    if (sideEffect.kind === 'replace') {
      const replacement = ordinaryTab(`${operation}-replacement`)
      this.tabs = this.tabs.filter((tab) => tab.identity !== sideEffect.identity).concat(replacement)
      this.baseHandles.delete(sideEffect.identity)
      this.baseHandles.set(replacement.identity, `${operation}-replacement`)
      this.runtimeReadyIdentities.delete(sideEffect.identity)
      return
    }

    this.tabs = this.tabs.map((tab) =>
      tab.identity === sideEffect.identity
        ? {
            ...tab,
            url: 'moz-extension://unrelated-addon/options.html',
            kind: 'options',
            testOwned: false
          }
        : tab
    )
  }

  private consumeCapability(handle: string, operation: string) {
    if (!this.currentCapability || this.currentCapability.handle !== handle) {
      return undefined
    }

    const { identity } = this.currentCapability
    this.currentCapability = undefined
    this.operationTrace.push(`${operation}:${identity}`)
    return identity
  }

  private requireBaseHandle(identity: string) {
    const handle = this.baseHandles.get(identity)
    if (!handle) {
      throw new Error(`No Marionette handle for physical tab identity: ${identity}`)
    }

    return handle
  }
}

const expectCode = async (promise: Promise<unknown>, code: FirefoxActionPreconditionErrorCode) => {
  await expect(promise).rejects.toEqual(expect.objectContaining<Partial<FirefoxActionPreconditionError>>({ code }))
}

describe('Firefox action precondition', () => {
  it('withholds action authorization when a sole tab would leave no content control', async () => {
    const unsafeControl = new FakeFirefoxAdapter([ordinaryTab('sole-tab', context.acceptedTarget, true)], ['sole-tab'])
    unsafeControl.clickNativeAction()
    expect(unsafeControl.acceptedContentHandles()).toEqual([])

    const adapter = new FakeFirefoxAdapter([ordinaryTab('sole-tab', context.acceptedTarget, true)], ['sole-tab'])
    adapter.allowCreate = false

    await expectCode(
      prepareFirefoxActionPrecondition(adapter, context).then(() => adapter.clickNativeAction()),
      'missing-independent-content-control'
    )
    expect(adapter.nativeClicks).toBe(0)
    expect(adapter.acceptedContentHandles()).toEqual(['sole-tab'])
  })

  it('creates an accepted content tab for a sole action recipient', async () => {
    const adapter = new FakeFirefoxAdapter([ordinaryTab('recipient', 'about:blank', true)])

    const binding = await prepareFirefoxActionPrecondition(adapter, context)

    expect(binding).toMatchObject({
      ...context,
      contentHandle: expect.stringMatching(/^created-1@/),
      contentIdentity: 'physical:created-1',
      actionRecipientHandle: expect.stringMatching(/^recipient@/),
      actionRecipientIdentity: 'physical:recipient',
      authorizedBeforeNativeAction: true
    })
    expect(adapter.createdHandles).toEqual(['created-1'])
    expect(binding.preActionTabs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ identity: 'physical:created-1', active: false }),
        expect.objectContaining({ identity: 'physical:recipient', active: true })
      ])
    )
  })

  it('creates only an action recipient when the sole tab is already accepted', async () => {
    const adapter = new FakeFirefoxAdapter([ordinaryTab('content', context.acceptedTarget, true)], ['content'])

    const binding = await prepareFirefoxActionPrecondition(adapter, context)

    expect(binding.contentHandle).toMatch(/^content@/)
    expect(binding.actionRecipientHandle).toMatch(/^created-1@/)
    expect(adapter.createdHandles).toEqual(['created-1'])
    expect(binding.preActionTabs.find((tab) => tab.identity === 'physical:content')?.active).toBe(false)
    expect(binding.preActionTabs.find((tab) => tab.identity === 'physical:created-1')?.active).toBe(true)
  })

  it('preserves an existing topology and excludes options handles', async () => {
    const adapter = new FakeFirefoxAdapter(
      [ordinaryTab('content', context.acceptedTarget, true), optionsTab('options'), ordinaryTab('recipient')],
      ['content', 'options']
    )

    const binding = await prepareFirefoxActionPrecondition(adapter, context)

    expect(binding.contentHandle).toMatch(/^content@/)
    expect(binding.actionRecipientHandle).toMatch(/^recipient@/)
    expect(adapter.createdHandles).toEqual([])
    expect([binding.contentIdentity, binding.actionRecipientIdentity]).not.toContain('physical:options')
    expect(binding.preActionTabs.find((tab) => tab.identity === 'physical:options')?.kind).toBe('options')
  })

  it('rejects ambiguous physical tab identities before action', async () => {
    const adapter = new FakeFirefoxAdapter(
      [
        { ...ordinaryTab('content', context.acceptedTarget, false), identity: 'physical:duplicate' },
        { ...ordinaryTab('recipient', 'about:blank', true), identity: 'physical:duplicate' }
      ],
      ['content']
    )

    await expectCode(prepareFirefoxActionPrecondition(adapter, context), 'invalid-binding')
    expect(adapter.nativeClicks).toBe(0)
  })

  it('rejects an extension target and unavailable accepted target', async () => {
    const invalidTargetAdapter = new FakeFirefoxAdapter([ordinaryTab('recipient', undefined, true)])
    await expectCode(
      prepareFirefoxActionPrecondition(invalidTargetAdapter, {
        ...context,
        acceptedTarget: 'moz-extension://exact-addon/options.html'
      }),
      'invalid-context'
    )
    expect(invalidTargetAdapter.createdHandles).toEqual([])

    await expectCode(
      prepareFirefoxActionPrecondition(invalidTargetAdapter, {
        ...context,
        addonId: 'other-addon@example.com'
      }),
      'invalid-context'
    )
    expect(invalidTargetAdapter.createdHandles).toEqual([])

    const unavailableTargetAdapter = new FakeFirefoxAdapter([
      ordinaryTab('recipient', undefined, true),
      ordinaryTab('content-candidate')
    ])
    unavailableTargetAdapter.allowNavigation = false
    await expectCode(
      prepareFirefoxActionPrecondition(unavailableTargetAdapter, context),
      'accepted-content-unavailable'
    )
  })

  it('rejects missing content Runtime readiness', async () => {
    const adapter = new FakeFirefoxAdapter([
      ordinaryTab('content', context.acceptedTarget, false),
      ordinaryTab('recipient', 'about:blank', true)
    ])

    await expectCode(prepareFirefoxActionPrecondition(adapter, context), 'content-runtime-unready')
    expect(adapter.createdHandles).toEqual([])
  })

  it('rejects a successful preparation Runtime check that creates an unrelated physical tab', async () => {
    const adapter = new FakeFirefoxAdapter(
      [ordinaryTab('content', context.acceptedTarget, false), ordinaryTab('recipient', 'about:blank', true)],
      ['content']
    )
    adapter.operationSideEffect = { operation: 'runtime', kind: 'create' }

    await expectCode(prepareFirefoxActionPrecondition(adapter, context), 'accepted-content-unavailable')
    expect(adapter.appliedOperationSideEffects).toEqual([{ operation: 'runtime', kind: 'create' }])
    expect(adapter.operationTrace.slice(-2)).toEqual(['lookup:physical:content', 'runtime:physical:content'])
    expect(adapter.tabs.some((tab) => tab.identity === 'physical:runtime-side-effect')).toBe(true)
  })

  it('rejects a successful recipient activation that replaces an unrelated physical tab', async () => {
    const adapter = new FakeFirefoxAdapter(
      [
        ordinaryTab('content', context.acceptedTarget, false),
        ordinaryTab('recipient', 'about:blank', true),
        ordinaryTab('unrelated')
      ],
      ['content']
    )
    adapter.operationSideEffect = {
      operation: 'activate',
      kind: 'replace',
      identity: 'physical:unrelated'
    }

    await expectCode(prepareFirefoxActionPrecondition(adapter, context), 'invalid-binding')
    expect(adapter.appliedOperationSideEffects).toHaveLength(1)
    expect(adapter.operationTrace.slice(-2)).toEqual(['lookup:physical:recipient', 'activate:physical:recipient'])
    expect(adapter.tabs.some((tab) => tab.identity === 'physical:unrelated')).toBe(false)
    expect(adapter.tabs.some((tab) => tab.identity === 'physical:activate-replacement')).toBe(true)
  })

  it('rejects a correct navigation that changes unrelated security classification', async () => {
    const adapter = new FakeFirefoxAdapter([
      ordinaryTab('recipient', 'about:blank', true),
      ordinaryTab('content-candidate'),
      ordinaryTab('unrelated')
    ])
    adapter.operationSideEffect = {
      operation: 'navigate',
      kind: 'change-classification',
      identity: 'physical:unrelated'
    }

    await expectCode(prepareFirefoxActionPrecondition(adapter, context), 'accepted-content-unavailable')
    expect(adapter.appliedOperationSideEffects).toHaveLength(1)
    expect(adapter.operationTrace.slice(-2)).toEqual([
      'lookup:physical:content-candidate',
      'navigate:physical:content-candidate'
    ])
    expect(adapter.tabs.find((tab) => tab.identity === 'physical:content-candidate')?.url).toBe(context.acceptedTarget)
    expect(adapter.tabs.find((tab) => tab.identity === 'physical:unrelated')).toMatchObject({
      url: 'moz-extension://unrelated-addon/options.html',
      kind: 'options',
      testOwned: false
    })
  })

  it('rejects a successful post-action Runtime check that creates an unrelated physical tab', async () => {
    const adapter = new FakeFirefoxAdapter(
      [ordinaryTab('content', context.acceptedTarget, false), ordinaryTab('recipient', 'about:blank', true)],
      ['content']
    )
    const binding = await prepareFirefoxActionPrecondition(adapter, context)
    adapter.clickNativeAction()
    adapter.operationSideEffect = { operation: 'runtime', kind: 'create' }

    await expectCode(assertFirefoxActionBinding(adapter, binding, context), 'invalid-binding')
    expect(adapter.appliedOperationSideEffects).toEqual([{ operation: 'runtime', kind: 'create' }])
    expect(adapter.operationTrace.slice(-2)).toEqual(['lookup:physical:content', 'runtime:physical:content'])
    expect(adapter.tabs.some((tab) => tab.identity === 'physical:runtime-side-effect')).toBe(true)
  })

  it('rejects post-action preparation and an unverified active recipient', async () => {
    const postActionAdapter = new FakeFirefoxAdapter([
      ordinaryTab('content', context.acceptedTarget, false),
      ordinaryTab('recipient', 'about:blank', true)
    ])
    postActionAdapter.nativeClicks = 1
    await expectCode(prepareFirefoxActionPrecondition(postActionAdapter, context), 'native-action-started')

    const inactiveRecipientAdapter = new FakeFirefoxAdapter(
      [ordinaryTab('content', context.acceptedTarget, true), ordinaryTab('recipient', 'about:blank', false)],
      ['content']
    )
    inactiveRecipientAdapter.activateWorks = false
    inactiveRecipientAdapter.nonActivatingLookups.add('physical:recipient')
    await expectCode(prepareFirefoxActionPrecondition(inactiveRecipientAdapter, context), 'invalid-binding')
  })

  it('rejects every cross-identity binding', async () => {
    const adapter = new FakeFirefoxAdapter(
      [ordinaryTab('content', context.acceptedTarget, false), ordinaryTab('recipient', 'about:blank', true)],
      ['content']
    )
    const binding = await prepareFirefoxActionPrecondition(adapter, context)
    const mismatches: readonly Partial<FirefoxActionContext>[] = [
      { profileId: 'other-profile' },
      { generationId: 'other-generation' },
      { packageId: 'other-package' },
      { addonId: 'other-addon@example.com' },
      { acceptedTarget: 'https://example.com/other' }
    ]

    for (const mismatch of mismatches) {
      await expectCode(assertFirefoxActionBinding(adapter, binding, { ...context, ...mismatch }), 'invalid-binding')
    }
  })

  it('keeps the original content binding valid when the recipient becomes options', async () => {
    const adapter = new FakeFirefoxAdapter(
      [ordinaryTab('content', context.acceptedTarget, false), ordinaryTab('recipient', 'about:blank', true)],
      ['content']
    )
    const binding = await prepareFirefoxActionPrecondition(adapter, context)
    expect(adapter.nativeClicks).toBe(0)
    expect(adapter.runtimeChecks).toHaveLength(2)
    expect(adapter.runtimeChecks.every((handle) => handle.startsWith('content@'))).toBe(true)
    expect(adapter.operationTrace.slice(-4)).toEqual([
      'lookup:physical:content',
      'runtime:physical:content',
      'lookup:physical:recipient',
      'activate:physical:recipient'
    ])
    const beforeOptionsCount = adapter.tabs.filter((tab) => tab.kind === 'options').length

    adapter.clickNativeAction()

    const afterOptionsCount = adapter.tabs.filter((tab) => tab.kind === 'options').length
    expect(adapter.nativeClicks).toBe(1)
    expect(afterOptionsCount - beforeOptionsCount).toBe(1)
    expect(adapter.tabs.find((tab) => tab.identity === 'physical:recipient')?.kind).toBe('options')
    await expect(assertFirefoxActionBinding(adapter, binding, context)).resolves.toBeUndefined()
    expect(adapter.runtimeChecks.at(-1)).toMatch(/^content@/)
    expect(adapter.operationTrace.slice(-2)).toEqual(['lookup:physical:content', 'runtime:physical:content'])
  })

  it('keeps the same physical content when Marionette remaps its handle after action', async () => {
    const adapter = new FakeFirefoxAdapter(
      [ordinaryTab('content-before', context.acceptedTarget, false), ordinaryTab('recipient', 'about:blank', true)],
      ['content-before']
    )
    const binding = await prepareFirefoxActionPrecondition(adapter, context)
    const physicalIdentity = binding.contentIdentity

    adapter.clickNativeAction()
    adapter.remapMarionetteHandle(physicalIdentity, 'content-after')

    expect(adapter.createdHandles).toEqual([])
    expect(adapter.acceptedContentHandles()).toEqual(['content-after'])
    expect(adapter.tabs.find((tab) => tab.identity === physicalIdentity)?.kind).toBe('ordinary')
    await expect(assertFirefoxActionBinding(adapter, binding, context)).resolves.toBeUndefined()
    expect(adapter.runtimeChecks.at(-1)).toMatch(/^content-after@/)
  })

  it('rejects current-handle lookup that leaves wrong or multiple active roles', async () => {
    const invalidActiveSets = [
      ['physical:unrelated-options'],
      ['physical:content', 'physical:unrelated-options']
    ] as const

    for (const activeIdentities of invalidActiveSets) {
      const adapter = new FakeFirefoxAdapter(
        [
          ordinaryTab('content', context.acceptedTarget, false),
          ordinaryTab('recipient', 'about:blank', true),
          optionsTab('unrelated-options')
        ],
        ['content']
      )
      const binding = await prepareFirefoxActionPrecondition(adapter, context)

      adapter.clickNativeAction()
      adapter.lookupActiveIdentities = activeIdentities

      await expectCode(assertFirefoxActionBinding(adapter, binding, context), 'invalid-binding')
    }
  })

  it('rejects a handle lookup that creates another physical tab', async () => {
    const adapter = new FakeFirefoxAdapter(
      [ordinaryTab('content', context.acceptedTarget, false), ordinaryTab('recipient', 'about:blank', true)],
      ['content']
    )
    const binding = await prepareFirefoxActionPrecondition(adapter, context)

    adapter.clickNativeAction()
    adapter.lookupCreatesPhysicalTab = true

    await expectCode(assertFirefoxActionBinding(adapter, binding, context), 'invalid-binding')
  })

  it('rejects a handle lookup that changes physical tab classification', async () => {
    const adapter = new FakeFirefoxAdapter(
      [ordinaryTab('content', context.acceptedTarget, false), ordinaryTab('recipient', 'about:blank', true)],
      ['content']
    )
    const binding = await prepareFirefoxActionPrecondition(adapter, context)

    adapter.clickNativeAction()
    adapter.lookupChangesClassification = true

    await expectCode(assertFirefoxActionBinding(adapter, binding, context), 'invalid-binding')
  })

  it('re-resolves a content handle invalidated by another tab operation', async () => {
    const adapter = new FakeFirefoxAdapter(
      [ordinaryTab('content', context.acceptedTarget, false), ordinaryTab('recipient', 'about:blank', true)],
      ['content']
    )
    const binding = await prepareFirefoxActionPrecondition(adapter, context)

    adapter.clickNativeAction()
    adapter.invalidateHandleWithoutChangingPhysicalInventory(binding.contentIdentity, 'content-current')

    await expect(assertFirefoxActionBinding(adapter, binding, context)).resolves.toBeUndefined()
    expect(adapter.runtimeChecks.at(-1)).toMatch(/^content-current@/)
    expect(adapter.operationTrace.slice(-2)).toEqual(['lookup:physical:content', 'runtime:physical:content'])
  })

  it('rejects a current handle that resolves to the options identity', async () => {
    const adapter = new FakeFirefoxAdapter(
      [ordinaryTab('content', context.acceptedTarget, false), ordinaryTab('recipient', 'about:blank', true)],
      ['content', 'recipient']
    )
    const binding = await prepareFirefoxActionPrecondition(adapter, context)
    const runtimeChecksBeforeAction = adapter.runtimeChecks.length

    adapter.clickNativeAction()
    adapter.redirectCurrentHandle(binding.contentIdentity, binding.actionRecipientIdentity)

    await expectCode(assertFirefoxActionBinding(adapter, binding, context), 'invalid-binding')
    expect(adapter.runtimeChecks).toHaveLength(runtimeChecksBeforeAction)
  })

  it('rejects an original physical identity without a current handle', async () => {
    const adapter = new FakeFirefoxAdapter(
      [ordinaryTab('content', context.acceptedTarget, false), ordinaryTab('recipient', 'about:blank', true)],
      ['content']
    )
    const binding = await prepareFirefoxActionPrecondition(adapter, context)

    adapter.clickNativeAction()
    adapter.dropCurrentHandle(binding.contentIdentity)

    await expectCode(assertFirefoxActionBinding(adapter, binding, context), 'invalid-binding')
    expect(adapter.tabs.find((tab) => tab.identity === binding.contentIdentity)?.kind).toBe('ordinary')
  })

  it('rejects a replacement content tab created after the action', async () => {
    const adapter = new FakeFirefoxAdapter(
      [ordinaryTab('content', context.acceptedTarget, false), ordinaryTab('recipient', 'about:blank', true)],
      ['content']
    )
    const binding = await prepareFirefoxActionPrecondition(adapter, context)

    adapter.replaceBoundContentAfterAction(binding.contentIdentity)

    expect(adapter.acceptedContentHandles()).toEqual(['post-action-repair'])
    expect(adapter.tabs.find((tab) => tab.identity === 'physical:post-action-repair')?.identity).not.toBe(
      binding.contentIdentity
    )
    await expectCode(assertFirefoxActionBinding(adapter, binding, context), 'invalid-binding')
  })

  it('keeps physical identities fresh while diagnostic tokens repeat across restarts', async () => {
    const generations = ['initial', 'restart-1', 'restart-2'] as const
    const records = []

    for (const generationId of generations) {
      const generationContext = { ...context, generationId }
      const adapter = new FakeFirefoxAdapter(
        [
          ordinaryTab(`${generationId}-content`, context.acceptedTarget, false),
          ordinaryTab(`${generationId}-recipient`, 'about:blank', true)
        ],
        [`${generationId}-content`]
      )
      adapter.currentHandleToken = 'shared-diagnostic-handle'
      const binding = await prepareFirefoxActionPrecondition(adapter, generationContext)
      await assertFirefoxActionBinding(adapter, binding, generationContext)
      records.push({ adapter, binding, generationContext })
    }

    expect(new Set(records.flatMap(({ binding }) => [binding.contentHandle, binding.actionRecipientHandle]))).toEqual(
      new Set(['shared-diagnostic-handle'])
    )
    expect(records.every(({ binding }) => binding.contentHandle === binding.actionRecipientHandle)).toBe(true)
    expect(
      new Set(records.flatMap(({ binding }) => [binding.contentIdentity, binding.actionRecipientIdentity])).size
    ).toBe(6)
    expect(records.map(({ binding }) => binding.profileId)).toEqual([
      context.profileId,
      context.profileId,
      context.profileId
    ])
    expect(records.map(({ binding }) => binding.packageId)).toEqual([
      context.packageId,
      context.packageId,
      context.packageId
    ])
    await expectCode(
      assertFirefoxActionBinding(records[1]!.adapter, records[0]!.binding, records[1]!.generationContext),
      'invalid-binding'
    )
  })
})
