export interface ChangelogState {
  observedVersion: string
  pendingVersion?: string
  shownVersions: string[]
}

export interface ChangelogStateStore {
  read(): Promise<unknown>
  write(state: ChangelogState): Promise<void>
}

export interface ChangelogTab {
  id: number
  windowId?: number
}

export interface ChangelogTabs {
  find(): Promise<ChangelogTab | undefined>
  focus(tab: ChangelogTab): Promise<void>
  create(): Promise<void>
}

export interface ChangelogInstallDetails {
  reason: string
  previousVersion?: string
}

export interface ChangelogInstallRuntime {
  onInstalled: {
    addListener(listener: (details: ChangelogInstallDetails) => void): void
  }
}

export interface ChangelogCoordinatorOptions {
  currentVersion: () => string
  store: ChangelogStateStore
  tabs: ChangelogTabs
  log?: (message: string) => void
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export const isExtensionVersion = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.trim() === value

export const parseChangelogState = (value: unknown): ChangelogState | null => {
  if (!isRecord(value) || !isExtensionVersion(value.observedVersion) || !Array.isArray(value.shownVersions)) {
    return null
  }
  if (value.pendingVersion !== undefined && !isExtensionVersion(value.pendingVersion)) return null
  if (!value.shownVersions.every(isExtensionVersion)) return null

  const shownVersions = [...value.shownVersions]
  if (new Set(shownVersions).size !== shownVersions.length) return null

  return {
    observedVersion: value.observedVersion,
    ...(value.pendingVersion === undefined ? {} : { pendingVersion: value.pendingVersion }),
    shownVersions
  }
}

const statesEqual = (left: ChangelogState, right: ChangelogState) =>
  left.observedVersion === right.observedVersion &&
  left.pendingVersion === right.pendingVersion &&
  left.shownVersions.length === right.shownVersions.length &&
  left.shownVersions.every((version, index) => version === right.shownVersions[index])

const isTrustedUpdate = (details: ChangelogInstallDetails | undefined, currentVersion: string) =>
  details?.reason === 'update' &&
  isExtensionVersion(details.previousVersion) &&
  details.previousVersion !== currentVersion

const baseline = (currentVersion: string, pending: boolean): ChangelogState => ({
  observedVersion: currentVersion,
  ...(pending ? { pendingVersion: currentVersion } : {}),
  shownVersions: []
})

export const acknowledgeChangelogVersion = async (
  store: ChangelogStateStore,
  version: string,
  log: (message: string) => void = console.error
) => {
  try {
    if (!isExtensionVersion(version)) return

    const parsed = parseChangelogState(await store.read())
    if (!parsed) {
      await store.write({ observedVersion: version, shownVersions: [version] })
      return
    }
    if (parsed.observedVersion !== version) return

    const shownVersions = parsed.shownVersions.includes(version)
      ? parsed.shownVersions
      : [...parsed.shownVersions, version]
    const next: ChangelogState = {
      observedVersion: parsed.observedVersion,
      ...(parsed.pendingVersion !== version && parsed.pendingVersion !== undefined
        ? { pendingVersion: parsed.pendingVersion }
        : {}),
      shownVersions
    }

    if (!statesEqual(parsed, next)) await store.write(next)
  } catch {
    log('Changelog acknowledgement failed')
  }
}

export class ChangelogCoordinator {
  readonly #currentVersion: () => string
  readonly #store: ChangelogStateStore
  readonly #tabs: ChangelogTabs
  readonly #log: (message: string) => void
  #operation = Promise.resolve()
  #reconciliation?: Promise<void>
  #trustedUpdate = false

  constructor({ currentVersion, store, tabs, log = console.error }: ChangelogCoordinatorOptions) {
    this.#currentVersion = currentVersion
    this.#store = store
    this.#tabs = tabs
    this.#log = log
  }

  start(runtime: ChangelogInstallRuntime) {
    runtime.onInstalled.addListener((details) => void this.reconcile(details))
    return this.reconcile()
  }

  reconcile(details?: ChangelogInstallDetails) {
    if (details && isTrustedUpdate(details, this.#currentVersion())) this.#trustedUpdate = true
    if (this.#reconciliation) return this.#reconciliation

    const reconciliation = this.#enqueue(async () => {
      try {
        await this.#reconcileCurrentVersion()
      } catch {
        this.#log('Changelog reconciliation failed')
      } finally {
        this.#reconciliation = undefined
      }
    })
    this.#reconciliation = reconciliation
    return reconciliation
  }

  acknowledge(version: string) {
    return this.#enqueue(() => acknowledgeChangelogVersion(this.#store, version, this.#log))
  }

  #enqueue(operation: () => Promise<void>) {
    const result = this.#operation.then(operation, operation)
    this.#operation = result.catch(() => undefined)
    return result
  }

  async #reconcileCurrentVersion() {
    const currentVersion = this.#currentVersion()
    if (!isExtensionVersion(currentVersion)) throw new Error('Invalid extension version')

    let shouldOpen = false
    do {
      const trustedUpdate = this.#trustedUpdate
      this.#trustedUpdate = false
      const currentShouldOpen = await this.#reconcileState(currentVersion, trustedUpdate)
      shouldOpen ||= currentShouldOpen
    } while (this.#trustedUpdate)

    if (shouldOpen) {
      await this.#openOrFocus()
      this.#trustedUpdate = false
    }
  }

  async #reconcileState(currentVersion: string, trustedUpdate: boolean) {
    const parsed = parseChangelogState(await this.#store.read())
    if (!parsed) {
      await this.#store.write(baseline(currentVersion, trustedUpdate))
      return trustedUpdate
    }

    const currentWasShown = parsed.shownVersions.includes(currentVersion)
    let next = parsed
    let shouldOpen = false

    if (trustedUpdate || parsed.observedVersion !== currentVersion) {
      next = {
        observedVersion: currentVersion,
        ...(currentWasShown ? {} : { pendingVersion: currentVersion }),
        shownVersions: parsed.shownVersions
      }
      shouldOpen = !currentWasShown
    } else if (parsed.pendingVersion !== undefined) {
      if (currentWasShown) {
        next = { observedVersion: currentVersion, shownVersions: parsed.shownVersions }
      } else {
        next = { observedVersion: currentVersion, pendingVersion: currentVersion, shownVersions: parsed.shownVersions }
        shouldOpen = true
      }
    }

    if (!statesEqual(parsed, next)) await this.#store.write(next)
    return shouldOpen
  }

  async #openOrFocus() {
    const existing = await this.#tabs.find()
    if (existing) {
      await this.#tabs.focus(existing)
      return
    }
    await this.#tabs.create()
  }
}
