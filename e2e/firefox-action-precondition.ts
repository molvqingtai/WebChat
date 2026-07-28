export interface FirefoxActionContext {
  readonly profileId: string
  readonly generationId: string
  readonly packageId: string
  readonly addonId: string
  readonly acceptedTarget: string
}

export const FIREFOX_ACTION_ADDON_ID = 'molvqingtai@gmail.com'

export interface FirefoxActionTab {
  /** Stable for the same physical tab within one process generation. */
  readonly identity: string
  readonly url: string
  readonly kind: 'ordinary' | 'options'
  readonly testOwned: boolean
  readonly active: boolean
}

export interface FirefoxActionTabHandle {
  readonly identity: string
  readonly handle: string
}

export interface FirefoxActionPreconditionAdapter {
  /** Inventories physical chrome tabs, independent of Marionette window handles. */
  listTabs(): Promise<readonly FirefoxActionTab[]>
  /** Resolves and observationally activates only the requested existing physical tab. */
  getCurrentHandle(identity: string): Promise<FirefoxActionTabHandle>
  /** Creates a test-owned physical tab and returns its stable identity. */
  createTab(): Promise<string>
  navigateTab(handle: string, target: string): Promise<void>
  isContentRuntimeReady(handle: string): Promise<boolean>
  activateTab(handle: string): Promise<void>
  hasNativeActionStarted(): Promise<boolean>
}

export interface FirefoxActionBinding extends FirefoxActionContext {
  /** Diagnostic evidence from the final pre-action Runtime check. */
  readonly contentHandle: string
  readonly contentIdentity: string
  /** Diagnostic evidence from the final recipient activation. */
  readonly actionRecipientHandle: string
  readonly actionRecipientIdentity: string
  readonly authorizedBeforeNativeAction: true
  readonly preActionTabs: readonly FirefoxActionTab[]
}

export type FirefoxActionPreconditionErrorCode =
  | 'invalid-context'
  | 'native-action-started'
  | 'missing-independent-content-control'
  | 'accepted-content-unavailable'
  | 'content-runtime-unready'
  | 'invalid-binding'

export class FirefoxActionPreconditionError extends Error {
  constructor(
    readonly code: FirefoxActionPreconditionErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'FirefoxActionPreconditionError'
  }
}

const contextKeys = [
  'profileId',
  'generationId',
  'packageId',
  'addonId',
  'acceptedTarget'
] as const satisfies readonly (keyof FirefoxActionContext)[]

const fail = (code: FirefoxActionPreconditionErrorCode, message: string): never => {
  throw new FirefoxActionPreconditionError(code, message)
}

const assertContext = (context: FirefoxActionContext): void => {
  for (const key of contextKeys) {
    if (context[key].trim() === '') {
      fail('invalid-context', `Firefox action ${key} must not be empty`)
    }
  }

  let isHttpsTarget = false

  try {
    isHttpsTarget = new URL(context.acceptedTarget).protocol === 'https:'
  } catch {}

  if (!isHttpsTarget) {
    fail('invalid-context', 'Firefox action accepted target must be a valid HTTPS URL')
  }

  if (context.addonId !== FIREFOX_ACTION_ADDON_ID) {
    fail('invalid-context', `Firefox action add-on must be ${FIREFOX_ACTION_ADDON_ID}`)
  }
}

const assertBeforeNativeAction = async (adapter: FirefoxActionPreconditionAdapter): Promise<void> => {
  if (await adapter.hasNativeActionStarted()) {
    fail(
      'native-action-started',
      'Firefox action precondition cannot repair a generation after native action activation'
    )
  }
}

const assertUniqueTabs = (tabs: readonly FirefoxActionTab[]): void => {
  const identities = new Set<string>()

  for (const tab of tabs) {
    if (typeof tab.identity !== 'string' || tab.identity.trim() === '' || identities.has(tab.identity)) {
      fail('invalid-binding', 'Firefox action tabs require unique physical identities')
    }

    identities.add(tab.identity)
  }
}

const readTabs = async (adapter: FirefoxActionPreconditionAdapter): Promise<FirefoxActionTab[]> => {
  const tabs = (await adapter.listTabs()).map((tab) => ({ ...tab }))
  assertUniqueTabs(tabs)
  return tabs
}

const isOwnedOrdinary = (tab: FirefoxActionTab): boolean => tab.testOwned && tab.kind === 'ordinary'

const isAcceptedContent = (tab: FirefoxActionTab, context: FirefoxActionContext): boolean =>
  isOwnedOrdinary(tab) && tab.url === context.acceptedTarget

const requireIdentity = (
  tabs: readonly FirefoxActionTab[],
  identity: string,
  code: FirefoxActionPreconditionErrorCode,
  message: string
): FirefoxActionTab => {
  const tab = tabs.find((candidate) => candidate.identity === identity)
  return tab ?? fail(code, message)
}

const physicalInventory = (tabs: readonly FirefoxActionTab[]) =>
  tabs
    .map(({ identity, url, kind, testOwned }) => ({ identity, url, kind, testOwned }))
    .sort((left, right) => left.identity.localeCompare(right.identity))

const hasSamePhysicalInventory = (
  before: ReturnType<typeof physicalInventory>,
  after: ReturnType<typeof physicalInventory>
): boolean =>
  before.length === after.length &&
  before.every(
    (tab, index) =>
      tab.identity === after[index]?.identity &&
      tab.url === after[index]?.url &&
      tab.kind === after[index]?.kind &&
      tab.testOwned === after[index]?.testOwned
  )

const requireSoleActiveIdentity = (
  tabs: readonly FirefoxActionTab[],
  identity: string,
  code: FirefoxActionPreconditionErrorCode,
  message: string
): void => {
  const active = tabs.filter((tab) => tab.active)
  if (active.length !== 1 || active[0]?.identity !== identity) {
    fail(code, message)
  }
}

const requireSingleActiveTab = (
  tabs: readonly FirefoxActionTab[],
  code: FirefoxActionPreconditionErrorCode,
  message: string
): void => {
  if (tabs.filter((tab) => tab.active).length !== 1) {
    fail(code, message)
  }
}

const consumeCurrentHandle = async <Result>(
  adapter: FirefoxActionPreconditionAdapter,
  identity: string,
  code: FirefoxActionPreconditionErrorCode,
  message: string,
  operation: (handle: string) => Promise<Result>,
  expectedUrlAfterOperation?: string
): Promise<{ handle: string; result: Result; tab: FirefoxActionTab; tabs: FirefoxActionTab[] }> => {
  const beforeTabs = await readTabs(adapter)
  requireIdentity(beforeTabs, identity, code, message)
  requireSingleActiveTab(beforeTabs, code, 'Firefox action requires one active physical tab before handle lookup')
  const beforeInventory = physicalInventory(beforeTabs)
  const current = await adapter.getCurrentHandle(identity).catch(() => fail(code, message))

  if (!current || current.identity !== identity || typeof current.handle !== 'string' || current.handle.trim() === '') {
    fail(code, message)
  }

  const lookupTabs = await readTabs(adapter)
  if (!hasSamePhysicalInventory(beforeInventory, physicalInventory(lookupTabs))) {
    fail(code, 'Firefox action handle lookup changed the physical tab inventory')
  }
  requireSoleActiveIdentity(
    lookupTabs,
    identity,
    code,
    'Firefox action handle lookup produced an invalid active physical tab role'
  )

  const result = await operation(current.handle)
  const operationTabs = await readTabs(adapter)
  const expectedOperationInventory = beforeInventory.map((tab) =>
    tab.identity === identity && expectedUrlAfterOperation !== undefined
      ? { ...tab, url: expectedUrlAfterOperation }
      : tab
  )
  if (!hasSamePhysicalInventory(expectedOperationInventory, physicalInventory(operationTabs))) {
    fail(code, 'Firefox action handle operation changed the physical tab inventory')
  }
  requireSoleActiveIdentity(
    operationTabs,
    identity,
    code,
    'Firefox action handle operation did not preserve the requested active physical tab role'
  )

  return {
    handle: current.handle,
    result,
    tab: requireIdentity(operationTabs, identity, code, message),
    tabs: operationTabs
  }
}

const createOwnedOrdinaryTab = async (
  adapter: FirefoxActionPreconditionAdapter
): Promise<{ identity: string; tabs: FirefoxActionTab[] }> => {
  await assertBeforeNativeAction(adapter)
  const identity = await adapter.createTab()
  await assertBeforeNativeAction(adapter)
  const tabs = await readTabs(adapter)
  const tab = requireIdentity(
    tabs,
    identity,
    'missing-independent-content-control',
    'Firefox action requires an independent content control before native activation'
  )

  if (!isOwnedOrdinary(tab)) {
    fail(
      'missing-independent-content-control',
      'Firefox action requires an independent test-owned ordinary tab before native activation'
    )
  }
  requireSoleActiveIdentity(
    tabs,
    identity,
    'missing-independent-content-control',
    'Firefox action created tab must be the sole active physical tab'
  )

  return { identity, tabs }
}

const findReadyContent = async (
  adapter: FirefoxActionPreconditionAdapter,
  tabs: readonly FirefoxActionTab[],
  context: FirefoxActionContext
): Promise<FirefoxActionTab | undefined> => {
  const accepted = tabs.filter((tab) => isAcceptedContent(tab, context))

  for (const tab of accepted) {
    const current = await consumeCurrentHandle(
      adapter,
      tab.identity,
      'accepted-content-unavailable',
      'Firefox action accepted content identity is not addressable before native activation',
      (handle) => adapter.isContentRuntimeReady(handle)
    )

    if (current.result) {
      return current.tab
    }
  }

  if (accepted.length > 0) {
    fail('content-runtime-unready', 'Firefox action accepted content Runtime is not ready before native activation')
  }
}

export async function prepareFirefoxActionPrecondition(
  adapter: FirefoxActionPreconditionAdapter,
  context: FirefoxActionContext
): Promise<FirefoxActionBinding> {
  assertContext(context)
  await assertBeforeNativeAction(adapter)

  let tabs = await readTabs(adapter)
  requireSingleActiveTab(tabs, 'invalid-binding', 'Firefox action preparation requires exactly one active physical tab')
  const ordinaryTabs = tabs.filter(isOwnedOrdinary)

  if (ordinaryTabs.length === 0) {
    fail(
      'missing-independent-content-control',
      'Firefox action requires a test-owned ordinary tab before native activation'
    )
  }

  const firstOrdinary = ordinaryTabs[0]
  if (!firstOrdinary) {
    fail(
      'missing-independent-content-control',
      'Firefox action requires a test-owned ordinary tab before native activation'
    )
  }

  let content = await findReadyContent(adapter, tabs, context)
  let actionRecipient: FirefoxActionTab | undefined

  if (content) {
    const contentIdentity = content.identity
    actionRecipient = ordinaryTabs.find((tab) => tab.identity !== contentIdentity)
  } else {
    actionRecipient = firstOrdinary
  }

  if (!content) {
    let contentCandidate = ordinaryTabs.find((tab) => tab.identity !== actionRecipient?.identity)

    if (!contentCandidate) {
      const created = await createOwnedOrdinaryTab(adapter)
      tabs = created.tabs
      contentCandidate = requireIdentity(
        tabs,
        created.identity,
        'missing-independent-content-control',
        'Firefox action requires an independent content control before native activation'
      )
    }

    if (!contentCandidate) {
      fail(
        'missing-independent-content-control',
        'Firefox action requires an independent content control before native activation'
      )
    }

    await assertBeforeNativeAction(adapter)
    const contentIdentity = contentCandidate.identity
    const navigatedContent = await consumeCurrentHandle(
      adapter,
      contentIdentity,
      'accepted-content-unavailable',
      'Firefox action content identity is not addressable during preparation',
      (handle) => adapter.navigateTab(handle, context.acceptedTarget),
      context.acceptedTarget
    )
    await assertBeforeNativeAction(adapter)
    tabs = navigatedContent.tabs
    content = navigatedContent.tab

    if (!isAcceptedContent(content, context)) {
      fail('accepted-content-unavailable', 'Firefox action could not establish the accepted HTTPS content target')
    }

    const readyContent = await consumeCurrentHandle(
      adapter,
      content.identity,
      'accepted-content-unavailable',
      'Firefox action accepted content identity is not addressable during preparation',
      (handle) => adapter.isContentRuntimeReady(handle)
    )
    tabs = readyContent.tabs
    content = readyContent.tab

    if (!isAcceptedContent(content, context)) {
      fail('accepted-content-unavailable', 'Firefox action could not retain the accepted HTTPS content target')
    }

    if (!readyContent.result) {
      fail('content-runtime-unready', 'Firefox action accepted content Runtime is not ready before native activation')
    }

    const preparedContentIdentity = content.identity
    actionRecipient = tabs.find((tab) => isOwnedOrdinary(tab) && tab.identity !== preparedContentIdentity)
  }

  if (!content) {
    fail('invalid-binding', 'Firefox action preparation did not establish an accepted content handle')
  }

  if (!actionRecipient) {
    const created = await createOwnedOrdinaryTab(adapter)
    tabs = created.tabs
    actionRecipient = requireIdentity(
      tabs,
      created.identity,
      'missing-independent-content-control',
      'Firefox action requires an independent action recipient before native activation'
    )
  }

  if (content.identity === actionRecipient.identity) {
    fail(
      'missing-independent-content-control',
      'Firefox action content and action-recipient identities must be distinct'
    )
  }

  await assertBeforeNativeAction(adapter)
  const readyContent = await consumeCurrentHandle(
    adapter,
    content.identity,
    'invalid-binding',
    'Firefox action content identity became stale before native activation',
    (handle) => adapter.isContentRuntimeReady(handle)
  )

  if (!isAcceptedContent(readyContent.tab, context)) {
    fail('invalid-binding', 'Firefox action content identity changed roles before native activation')
  }

  if (!readyContent.result) {
    fail('content-runtime-unready', 'Firefox action accepted content Runtime is not ready before native activation')
  }

  await assertBeforeNativeAction(adapter)
  const activatedRecipient = await consumeCurrentHandle(
    adapter,
    actionRecipient.identity,
    'invalid-binding',
    'Firefox action recipient identity became stale before native activation',
    (handle) => adapter.activateTab(handle)
  )

  if (!isOwnedOrdinary(activatedRecipient.tab)) {
    fail('invalid-binding', 'Firefox action recipient identity changed roles before native activation')
  }

  await assertBeforeNativeAction(adapter)
  tabs = activatedRecipient.tabs

  const preparedContent = requireIdentity(
    tabs,
    content.identity,
    'invalid-binding',
    'Firefox action content identity became stale before native activation'
  )
  const preparedRecipient = requireIdentity(
    tabs,
    actionRecipient.identity,
    'invalid-binding',
    'Firefox action recipient identity became stale before native activation'
  )

  if (!isAcceptedContent(preparedContent, context) || preparedContent.active) {
    fail('invalid-binding', 'Firefox action content handle must remain an inactive accepted ordinary tab')
  }

  if (!isOwnedOrdinary(preparedRecipient) || !preparedRecipient.active) {
    fail('invalid-binding', 'Firefox action recipient must be the active ordinary tab before native activation')
  }

  return Object.freeze({
    ...context,
    contentHandle: readyContent.handle,
    contentIdentity: preparedContent.identity,
    actionRecipientHandle: activatedRecipient.handle,
    actionRecipientIdentity: preparedRecipient.identity,
    authorizedBeforeNativeAction: true,
    preActionTabs: Object.freeze(tabs.map((tab) => Object.freeze({ ...tab })))
  })
}

export async function assertFirefoxActionBinding(
  adapter: FirefoxActionPreconditionAdapter,
  binding: FirefoxActionBinding,
  context: FirefoxActionContext
): Promise<void> {
  for (const key of contextKeys) {
    if (binding[key] !== context[key]) {
      fail('invalid-binding', `Firefox action binding has a mismatched ${key}`)
    }
  }

  assertContext(context)

  if (binding.authorizedBeforeNativeAction !== true || binding.contentIdentity === binding.actionRecipientIdentity) {
    fail('invalid-binding', 'Firefox action binding does not authorize distinct tab roles')
  }

  assertUniqueTabs(binding.preActionTabs)

  const preActionContent = requireIdentity(
    binding.preActionTabs,
    binding.contentIdentity,
    'invalid-binding',
    'Firefox action binding has no pre-action content classification'
  )
  const preActionRecipient = requireIdentity(
    binding.preActionTabs,
    binding.actionRecipientIdentity,
    'invalid-binding',
    'Firefox action binding has no pre-action recipient classification'
  )

  if (!isAcceptedContent(preActionContent, context) || preActionContent.active) {
    fail('invalid-binding', 'Firefox action binding has an invalid pre-action content role')
  }

  if (!isOwnedOrdinary(preActionRecipient) || !preActionRecipient.active) {
    fail('invalid-binding', 'Firefox action binding has an invalid pre-action recipient role')
  }
  requireSoleActiveIdentity(
    binding.preActionTabs,
    binding.actionRecipientIdentity,
    'invalid-binding',
    'Firefox action binding has an invalid pre-action active presentation'
  )

  const tabs = await readTabs(adapter)
  const currentContent = requireIdentity(
    tabs,
    binding.contentIdentity,
    'invalid-binding',
    'Firefox action binding refers to a stale content identity'
  )

  if (!isAcceptedContent(currentContent, context)) {
    fail('invalid-binding', 'Firefox action binding no longer refers to the accepted non-options content handle')
  }

  const readyContent = await consumeCurrentHandle(
    adapter,
    binding.contentIdentity,
    'invalid-binding',
    'Firefox action binding cannot resolve the original content identity to a current handle',
    (handle) => adapter.isContentRuntimeReady(handle)
  )

  if (!isAcceptedContent(readyContent.tab, context)) {
    fail('invalid-binding', 'Firefox action binding no longer refers to the accepted non-options content handle')
  }

  if (!readyContent.result) {
    fail('content-runtime-unready', 'Firefox action bound content Runtime is not ready')
  }
}
