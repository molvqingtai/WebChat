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
  handle,
  url,
  kind: 'ordinary',
  testOwned,
  active
})

const optionsTab = (handle: string, active = false): FirefoxActionTab => ({
  handle,
  url: 'moz-extension://exact-addon/options.html',
  kind: 'options',
  testOwned: true,
  active
})

class FakeFirefoxAdapter implements FirefoxActionPreconditionAdapter {
  tabs: FirefoxActionTab[]
  readonly runtimeReady = new Set<string>()
  readonly runtimeChecks: string[] = []
  readonly createdHandles: string[] = []
  nativeClicks = 0
  allowCreate = true
  allowNavigation = true
  activateWorks = true
  runtimeReadyAfterNavigation = true

  constructor(tabs: readonly FirefoxActionTab[], readyHandles: readonly string[] = []) {
    this.tabs = tabs.map((tab) => ({ ...tab }))
    readyHandles.forEach((handle) => this.runtimeReady.add(handle))
  }

  async listTabs() {
    return this.tabs.map((tab) => ({ ...tab }))
  }

  async createTab() {
    const handle = `created-${this.createdHandles.length + 1}`
    this.createdHandles.push(handle)

    if (this.allowCreate) {
      this.tabs = this.tabs.map((tab) => ({ ...tab, active: false })).concat(ordinaryTab(handle, 'about:blank', true))
    }

    return handle
  }

  async navigateTab(handle: string, target: string) {
    if (!this.allowNavigation) {
      return
    }

    this.tabs = this.tabs.map((tab) =>
      tab.handle === handle ? ordinaryTab(handle, target, tab.active, tab.testOwned) : tab
    )

    if (this.runtimeReadyAfterNavigation) {
      this.runtimeReady.add(handle)
    }
  }

  async isContentRuntimeReady(handle: string) {
    this.runtimeChecks.push(handle)
    return this.runtimeReady.has(handle)
  }

  async activateTab(handle: string) {
    if (this.activateWorks) {
      this.tabs = this.tabs.map((tab) => ({ ...tab, active: tab.handle === handle }))
    }
  }

  async hasNativeActionStarted() {
    return this.nativeClicks > 0
  }

  clickNativeAction() {
    this.nativeClicks += 1
    this.tabs = this.tabs.map((tab) =>
      tab.active && tab.kind === 'ordinary' ? { ...optionsTab(tab.handle, true), testOwned: tab.testOwned } : tab
    )
  }

  replaceBoundContentAfterAction(handle: string) {
    this.nativeClicks += 1
    this.tabs = this.tabs
      .map((tab) => (tab.handle === handle ? optionsTab(handle, false) : tab))
      .concat(ordinaryTab('post-action-repair', context.acceptedTarget, false))
    this.runtimeReady.add('post-action-repair')
  }

  acceptedContentHandles(target = context.acceptedTarget) {
    return this.tabs.filter((tab) => tab.kind === 'ordinary' && tab.url === target).map((tab) => tab.handle)
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
      contentHandle: 'created-1',
      actionRecipientHandle: 'recipient',
      authorizedBeforeNativeAction: true
    })
    expect(adapter.createdHandles).toEqual(['created-1'])
    expect(binding.preActionTabs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ handle: 'created-1', active: false }),
        expect.objectContaining({ handle: 'recipient', active: true })
      ])
    )
  })

  it('creates only an action recipient when the sole tab is already accepted', async () => {
    const adapter = new FakeFirefoxAdapter([ordinaryTab('content', context.acceptedTarget, true)], ['content'])

    const binding = await prepareFirefoxActionPrecondition(adapter, context)

    expect(binding.contentHandle).toBe('content')
    expect(binding.actionRecipientHandle).toBe('created-1')
    expect(adapter.createdHandles).toEqual(['created-1'])
    expect(binding.preActionTabs.find((tab) => tab.handle === 'content')?.active).toBe(false)
    expect(binding.preActionTabs.find((tab) => tab.handle === 'created-1')?.active).toBe(true)
  })

  it('preserves an existing topology and excludes options handles', async () => {
    const adapter = new FakeFirefoxAdapter(
      [ordinaryTab('content', context.acceptedTarget, true), optionsTab('options'), ordinaryTab('recipient')],
      ['content', 'options']
    )

    const binding = await prepareFirefoxActionPrecondition(adapter, context)

    expect(binding.contentHandle).toBe('content')
    expect(binding.actionRecipientHandle).toBe('recipient')
    expect(adapter.createdHandles).toEqual([])
    expect([binding.contentHandle, binding.actionRecipientHandle]).not.toContain('options')
    expect(binding.preActionTabs.find((tab) => tab.handle === 'options')?.kind).toBe('options')
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
    expect(adapter.runtimeChecks).toEqual(['content', 'content'])
    const beforeOptionsCount = adapter.tabs.filter((tab) => tab.kind === 'options').length

    adapter.clickNativeAction()

    const afterOptionsCount = adapter.tabs.filter((tab) => tab.kind === 'options').length
    expect(adapter.nativeClicks).toBe(1)
    expect(afterOptionsCount - beforeOptionsCount).toBe(1)
    expect(adapter.tabs.find((tab) => tab.handle === 'recipient')?.kind).toBe('options')
    await expect(assertFirefoxActionBinding(adapter, binding, context)).resolves.toBeUndefined()
    expect(adapter.runtimeChecks.at(-1)).toBe('content')
  })

  it('rejects a replacement content tab created after the action', async () => {
    const adapter = new FakeFirefoxAdapter(
      [ordinaryTab('content', context.acceptedTarget, false), ordinaryTab('recipient', 'about:blank', true)],
      ['content']
    )
    const binding = await prepareFirefoxActionPrecondition(adapter, context)

    adapter.replaceBoundContentAfterAction(binding.contentHandle)

    expect(adapter.acceptedContentHandles()).toEqual(['post-action-repair'])
    await expectCode(assertFirefoxActionBinding(adapter, binding, context), 'invalid-binding')
  })

  it('rebinds fresh handles for initial startup and two same-profile restarts', async () => {
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
      const binding = await prepareFirefoxActionPrecondition(adapter, generationContext)
      await assertFirefoxActionBinding(adapter, binding, generationContext)
      records.push({ adapter, binding, generationContext })
    }

    expect(new Set(records.flatMap(({ binding }) => [binding.contentHandle, binding.actionRecipientHandle])).size).toBe(
      6
    )
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
