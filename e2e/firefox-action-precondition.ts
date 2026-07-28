export interface FirefoxActionContext {
  readonly profileId: string
  readonly generationId: string
  readonly packageId: string
  readonly addonId: string
  readonly acceptedTarget: string
}

export const FIREFOX_ACTION_ADDON_ID = 'molvqingtai@gmail.com'

export interface FirefoxActionTab {
  readonly handle: string
  /** Stable for the same physical tab within one process generation. */
  readonly identity: string
  readonly url: string
  readonly kind: 'ordinary' | 'options'
  readonly testOwned: boolean
  readonly active: boolean
}

export interface FirefoxActionPreconditionAdapter {
  listTabs(): Promise<readonly FirefoxActionTab[]>
  createTab(): Promise<string>
  navigateTab(handle: string, target: string): Promise<void>
  isContentRuntimeReady(handle: string): Promise<boolean>
  activateTab(handle: string): Promise<void>
  hasNativeActionStarted(): Promise<boolean>
}

export interface FirefoxActionBinding extends FirefoxActionContext {
  readonly contentHandle: string
  readonly contentIdentity: string
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
  const handles = new Set<string>()
  const identities = new Set<string>()

  for (const tab of tabs) {
    if (
      typeof tab.handle !== 'string' ||
      tab.handle.trim() === '' ||
      handles.has(tab.handle) ||
      typeof tab.identity !== 'string' ||
      tab.identity.trim() === '' ||
      identities.has(tab.identity)
    ) {
      fail('invalid-binding', 'Firefox action tabs require unique handles and physical identities')
    }

    handles.add(tab.handle)
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

const requireTab = (
  tabs: readonly FirefoxActionTab[],
  handle: string,
  code: FirefoxActionPreconditionErrorCode,
  message: string
): FirefoxActionTab => {
  const tab = tabs.find((candidate) => candidate.handle === handle)
  return tab ?? fail(code, message)
}

const requireIdentity = (
  tabs: readonly FirefoxActionTab[],
  identity: string,
  code: FirefoxActionPreconditionErrorCode,
  message: string
): FirefoxActionTab => {
  const tab = tabs.find((candidate) => candidate.identity === identity)
  return tab ?? fail(code, message)
}

const createOwnedOrdinaryTab = async (
  adapter: FirefoxActionPreconditionAdapter
): Promise<{ handle: string; tabs: FirefoxActionTab[] }> => {
  await assertBeforeNativeAction(adapter)
  const handle = await adapter.createTab()
  await assertBeforeNativeAction(adapter)
  const tabs = await readTabs(adapter)
  const tab = requireTab(
    tabs,
    handle,
    'missing-independent-content-control',
    'Firefox action requires an independent content control before native activation'
  )

  if (!isOwnedOrdinary(tab)) {
    fail(
      'missing-independent-content-control',
      'Firefox action requires an independent test-owned ordinary tab before native activation'
    )
  }

  return { handle, tabs }
}

const findReadyContent = async (
  adapter: FirefoxActionPreconditionAdapter,
  tabs: readonly FirefoxActionTab[],
  context: FirefoxActionContext
): Promise<FirefoxActionTab | undefined> => {
  const accepted = tabs.filter((tab) => isAcceptedContent(tab, context))

  for (const tab of accepted) {
    if (await adapter.isContentRuntimeReady(tab.handle)) {
      return tab
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
  let ordinaryTabs = tabs.filter(isOwnedOrdinary)

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

  let content = await findReadyContent(adapter, ordinaryTabs, context)
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
      contentCandidate = requireTab(
        tabs,
        created.handle,
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
    await adapter.navigateTab(contentCandidate.handle, context.acceptedTarget)
    await assertBeforeNativeAction(adapter)
    tabs = await readTabs(adapter)
    content = requireIdentity(
      tabs,
      contentIdentity,
      'accepted-content-unavailable',
      'Firefox action accepted content identity was lost during preparation'
    )

    if (!isAcceptedContent(content, context)) {
      fail('accepted-content-unavailable', 'Firefox action could not establish the accepted HTTPS content target')
    }

    if (!(await adapter.isContentRuntimeReady(content.handle))) {
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
    actionRecipient = requireTab(
      tabs,
      created.handle,
      'missing-independent-content-control',
      'Firefox action requires an independent action recipient before native activation'
    )
  }

  if (content.handle === actionRecipient.handle || content.identity === actionRecipient.identity) {
    fail('missing-independent-content-control', 'Firefox action content and action-recipient handles must be distinct')
  }

  await assertBeforeNativeAction(adapter)
  await adapter.activateTab(actionRecipient.handle)
  await assertBeforeNativeAction(adapter)
  tabs = await readTabs(adapter)

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

  if (!(await adapter.isContentRuntimeReady(preparedContent.handle))) {
    fail('content-runtime-unready', 'Firefox action accepted content Runtime is not ready before native activation')
  }

  await assertBeforeNativeAction(adapter)

  return Object.freeze({
    ...context,
    contentHandle: preparedContent.handle,
    contentIdentity: preparedContent.identity,
    actionRecipientHandle: preparedRecipient.handle,
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

  if (
    binding.authorizedBeforeNativeAction !== true ||
    binding.contentHandle === binding.actionRecipientHandle ||
    binding.contentIdentity === binding.actionRecipientIdentity
  ) {
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

  if (
    preActionContent.handle !== binding.contentHandle ||
    preActionRecipient.handle !== binding.actionRecipientHandle
  ) {
    fail('invalid-binding', 'Firefox action binding has mismatched pre-action handles')
  }

  if (!isAcceptedContent(preActionContent, context) || preActionContent.active) {
    fail('invalid-binding', 'Firefox action binding has an invalid pre-action content role')
  }

  if (!isOwnedOrdinary(preActionRecipient) || !preActionRecipient.active) {
    fail('invalid-binding', 'Firefox action binding has an invalid pre-action recipient role')
  }

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

  if (!(await adapter.isContentRuntimeReady(currentContent.handle))) {
    fail('content-runtime-unready', 'Firefox action bound content Runtime is not ready')
  }
}
