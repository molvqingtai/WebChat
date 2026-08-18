import { access, readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = path.resolve(import.meta.dirname, '../..')
const projectPath = (file: string) => path.join(ROOT, file)
const source = (file: string) => readFile(path.isAbsolute(file) ? file : projectPath(file), 'utf8')

const codeFiles = async (directory: string): Promise<string[]> => {
  const entries = await readdir(directory, { withFileTypes: true })
  return (
    await Promise.all(
      entries.map((entry) => {
        const entryPath = path.join(directory, entry.name)
        return entry.isDirectory() ? codeFiles(entryPath) : [entryPath]
      })
    )
  )
    .flat()
    .filter((file) => /\.[cm]?[jt]sx?$/.test(file))
}

const balancedCallArgument = (value: string, start: number): string | null => {
  let depth = 1
  let quote = ''
  let escaped = false
  let comment = ''
  for (let index = start; index < value.length; index += 1) {
    const current = value[index]
    const next = value[index + 1]
    if (comment === 'line') {
      if (current === '\n') comment = ''
      continue
    }
    if (comment === 'block') {
      if (current === '*' && next === '/') {
        comment = ''
        index += 1
      }
      continue
    }
    if (quote) {
      if (escaped) escaped = false
      else if (current === '\\') escaped = true
      else if (current === quote) quote = ''
      continue
    }
    if (current === '/' && next === '/') {
      comment = 'line'
      index += 1
    } else if (current === '/' && next === '*') {
      comment = 'block'
      index += 1
    } else if (current === '"' || current === "'" || current === '`') quote = current
    else if (current === '(') depth += 1
    else if (current === ')' && --depth === 0) return value.slice(start, index)
  }
  return null
}

const hasTopLevelTargetPeerIds = (argument: string): boolean => {
  const objectStart = argument.search(/\S/)
  if (objectStart < 0 || argument[objectStart] !== '{') return false
  let depth = 0
  for (let index = objectStart; index < argument.length; index += 1) {
    if (argument[index] === '{') depth += 1
    else if (argument[index] === '}') depth -= 1
    else if (depth === 1 && argument.startsWith('targetPeerIds', index)) {
      const suffix = argument.slice(index + 'targetPeerIds'.length).match(/^\s*([:,])/)
      if (suffix) return true
    }
  }
  return false
}

const productionSendCalls = async () => {
  const calls: { file: string; line: number; targetPeerIds: boolean }[] = []
  for (const file of await codeFiles(projectPath('src'))) {
    if (/\.test\.[cm]?[jt]sx?$/.test(file)) continue
    const value = await source(file)
    for (const match of value.matchAll(/\.SendMessageCommand\s*\(/g)) {
      const argument = balancedCallArgument(value, (match.index ?? 0) + match[0].length)
      calls.push({
        file: path.relative(ROOT, file),
        line: value.slice(0, match.index).split('\n').length,
        targetPeerIds: argument !== null && hasTopLevelTargetPeerIds(argument)
      })
    }
  }
  return calls
}

describe('replaceable application boundaries', () => {
  it('keeps room-wide sends as native broadcasts and targeted sends explicitly targeted', async () => {
    const [calls, runtimeSources] = await Promise.all([
      productionSendCalls(),
      Promise.all(
        (await codeFiles(projectPath('src/domain/runtime')))
          .filter((file) => !/\.test\.[cm]?[jt]sx?$/.test(file))
          .map(source)
      )
    ])

    // The five room-wide producers — initial Session, Text/Reaction, World full snapshot, and the
    // eligible zero-call World retry — all broadcast with an omitted target.
    const broadcasts = calls.filter((call) => !call.targetPeerIds)
    expect(broadcasts.map((call) => `${call.file}:${call.line}`)).toEqual([
      'src/domain/runtime/Session.ts:545',
      'src/domain/runtime/Session.ts:1136',
      'src/domain/runtime/World.ts:268',
      'src/domain/runtime/World.ts:378'
    ])
    // History inventory/response and Session/World catch-up remain explicitly targeted.
    expect(calls.filter((call) => call.targetPeerIds)).toHaveLength(7)
    expect(runtimeSources.join('\n')).not.toMatch(/\bUserList\b|\breadyPeers\b/)
    expect(runtimeSources.join('\n')).not.toMatch(/matallui\/artico|Connection is not established yet/)
  })

  it('exposes only the Owner-final ChatRoom, Database, session path, and clock capabilities', async () => {
    const [chatRoom, database, messageStore, runtimeContract, pagePort, clock, implementation] = await Promise.all([
      source('src/domain/externs/ChatRoom.ts'),
      source('src/domain/externs/Database.ts'),
      source('src/domain/MessageStore.ts'),
      source('src/runtime/Contract.ts'),
      source('src/runtime/PagePort.ts'),
      source('src/domain/runtime/externs/Clock.ts'),
      source('src/domain/impls/runtime/ChatRoom.ts')
    ])

    expect(chatRoom).toContain('joinRoom(command: JoinRoomCommand): Promise<void>')
    expect(chatRoom).toContain('sendMessage(command: SendTextCommand): Promise<TextMessage>')
    expect(chatRoom).toContain('sendMessage(command: SendReactionCommand): Promise<ReactionMessage>')
    expect(chatRoom).toContain('sendMessage(command: SendMessageCommand): Promise<ChatMessage>')
    expect(chatRoom).toContain('onSessions(listener: (sessions: readonly ChatSession[]) => void): Unsubscribe')
    expect(chatRoom).not.toMatch(/\bjoin:|sendText|sendReaction|onRecord|onMembership|reconnect/)
    expect(database).toMatch(/interface Database<Schema extends DatabaseSchema<Schema>>/)
    expect(database).toContain('readonly key: Key')
    expect(database).toContain('readonly value: Value')
    expect(messageStore).toMatch(/interface MessageStore[\s\S]*insert\(record: MessageRecord\)/)
    expect(messageStore).toMatch(
      /type MessageQuery = Readonly<[\s\S]*type\?: MessageRecord\['type'\][\s\S]*signal\?: AbortSignal/
    )
    expect(messageStore).toMatch(/query\(query\?: MessageQuery\): Promise<readonly MessageRecord\[\]>/)
    expect(messageStore).not.toMatch(/\blist\s*\(|findAll|fetchHistory|HistoryCursor|syncId|mark|status|outbox/)
    expect(implementation).toContain('.query({ type: MESSAGE_RECORD_TYPE.CHAT_MESSAGE, signal: controller.signal })')
    expect(runtimeContract).toContain('onSessionEvent')
    expect(`${runtimeContract}\n${pagePort}`).not.toMatch(/onLocalSession|onSessionLeave/)
    expect(clock).not.toMatch(/setTimeout|clearTimeout/)
    expect(implementation).not.toMatch(/setTimeout:|clearTimeout:/)
  })

  it('keeps production lease timers global instead of injectable', async () => {
    const [clientLease, coordinator, background] = await Promise.all([
      source('src/runtime/ClientLease.ts'),
      source('src/runtime/Coordinator.ts'),
      source('src/runtime/Background.ts')
    ])

    expect(clientLease).not.toMatch(/\bsetInterval\??:|\bclearInterval\??:/)
    expect(coordinator).not.toMatch(/\bsetInterval:|\bclearInterval:/)
    expect(background).not.toMatch(/\bsetInterval:|\bclearInterval:/)
    expect(`${clientLease}\n${coordinator}`).toContain('globalThis.setInterval')
    expect(`${clientLease}\n${coordinator}`).toContain('globalThis.clearInterval')
  })

  it('never clears the canonical message database from startup or setup state', async () => {
    const [app, setup] = await Promise.all([
      source('src/app/content/App.tsx'),
      source('src/app/content/views/setup/index.tsx')
    ])

    expect(app).not.toContain('ClearListCommand')
    expect(setup).not.toContain('ClearListCommand')
    expect(setup).not.toContain('PersistRecordCommand')
    expect(setup).toContain('ApplyRecordCommand')
    expect(setup).toContain('ReloadCommand')
  })

  it('registers page cleanup before Runtime initialization can suspend', async () => {
    const content = await source('src/app/content/index.tsx')

    expect(content.indexOf('createDocumentLifecycleOwner()')).toBeGreaterThan(-1)
    expect(content.indexOf('createDocumentLifecycleOwner()')).toBeLessThan(content.indexOf('createShadowRootUi(ctx'))
    expect(content).toContain('initializeRuntime: initClient')
    expect(content).toContain('detachRuntime: detachClient')
  })

  it('keeps the UI projection free of the obsolete local record alias', async () => {
    const projectionSources = await Promise.all(
      ['src/domain/Message.ts', 'src/domain/MessageList.ts', 'src/domain/MessageProjection.ts'].map(source)
    )

    expect(projectionSources.join('\n')).not.toMatch(/\bLocalMessage\b/)
  })

  it('keeps Chat and World ports and Domains free of Runtime projection details', async () => {
    const [chatPort, chatDomain, worldPort, worldDomain] = await Promise.all([
      source('src/domain/externs/ChatRoom.ts'),
      source('src/domain/ChatRoom.ts'),
      source('src/domain/externs/WorldRoom.ts'),
      source('src/domain/WorldRoom.ts')
    ])

    expect(chatPort).not.toMatch(/@\/runtime|Runtime|peerId|retryPending|onLocalSession|onSession\b|onSnapshot/)
    expect(chatPort).toContain('joinRoom(command: JoinRoomCommand): Promise<void>')
    expect(chatPort).toContain('sendMessage(command: SendTextCommand): Promise<TextMessage>')
    expect(chatPort).toContain('sendMessage(command: SendReactionCommand): Promise<ReactionMessage>')
    expect(chatDomain).not.toMatch(
      /Runtime|PeerIdQuery|SelfUserQuery|PeerListQuery|OnReactionMessageEvent|OnHistoryRecordEvent|OnJoinRoomEvent|OnLeaveRoomEvent/
    )

    expect(worldPort).not.toMatch(/@\/runtime|Runtime|peerId|sourcePeerId|Presence|Snapshot/)
    expect(worldPort).toContain('getState: () => Promise<WorldState>')
    expect(worldPort).toContain('onState: (callback: (state: WorldState) => void) => () => void')
    expect(worldDomain).not.toMatch(/Runtime|PeerIdQuery|PresenceChangedEvent|SelfJoinRoomEvent/)
  })

  it('limits concrete implementation and Runtime imports to composition roots', async () => {
    const roots = new Set([
      projectPath('src/app/content/index.tsx'),
      projectPath('src/app/options/main.tsx'),
      projectPath('src/app/background/index.ts'),
      projectPath('src/app/offscreen/main.ts')
    ])
    const violations: string[] = []

    for (const file of await codeFiles(projectPath('src/app'))) {
      if (/\.test\.[cm]?[jt]sx?$/.test(file)) continue
      if (roots.has(file)) continue
      const value = await source(file)
      if (/from ['"]@\/(?:domain\/impls|runtime)\//.test(value) || /(?:AppActionImpl|ToastImpl)\.value/.test(value)) {
        violations.push(file)
      }
    }

    expect(violations).toEqual([])
    expect(await source('src/domain/impls/ChatRoom.ts')).not.toContain('MessageDatabaseImpl')
  })

  it('removes every obsolete Store extern and auxiliary member', async () => {
    const storage = await source('src/domain/externs/Storage.ts')

    await expect(access(projectPath('src/domain/externs/ChatRecordStore.ts'))).rejects.toThrow()
    await expect(access(projectPath('src/domain/externs/MessageStore.ts'))).rejects.toThrow()
    await expect(access(projectPath('src/domain/impls/ChatRecordStore.ts'))).rejects.toThrow()
    await expect(access(projectPath('src/domain/impls/MessageStore.ts'))).rejects.toThrow()
    expect(storage).not.toMatch(/\bname:|\bremove:|\bclear:|\bunwatch:/)
    await expect(access(projectPath('src/domain/externs/Clock.ts'))).rejects.toThrow()
    await expect(access(projectPath('src/domain/runtime/externs/Clock.ts'))).resolves.toBeUndefined()
    await expect(access(projectPath('src/domain/externs/RoomTransport.ts'))).rejects.toThrow()
    expect(await source('src/runtime/RoomTransport.ts')).not.toContain('Remesh.extern')
  })

  it('gates both persistence families on independent private version authorities', async () => {
    const [
      background,
      content,
      initialization,
      options,
      config,
      storageConstants,
      indexedDB,
      storage,
      storagePreparation
    ] = await Promise.all([
      source('src/app/background/index.ts'),
      source('src/app/content/index.tsx'),
      source('src/app/content/Initialization.ts'),
      source('src/app/options/main.tsx'),
      source('src/constants/config.ts'),
      source('src/constants/storage.ts'),
      source('src/domain/impls/database/IndexedDB.ts'),
      source('src/domain/impls/Storage.ts'),
      source('src/service/StoragePreparation.ts')
    ])

    expect(content).not.toMatch(/VERSION_STORAGE_KEY|indexDBStorage|package\.json|storedVersion/)
    expect(config).not.toContain('VERSION_STORAGE_KEY')
    expect(storage).not.toMatch(/indexedDbDriver|indexDBStorage/)
    expect(storageConstants).toContain('export const MESSAGE_STORE_VERSION = 2')
    expect(storageConstants).toContain('export const CONFIG_STORE_VERSION = 1')
    expect(storageConstants).toContain("export const CONFIG_STORE_VERSION_KEY = 'WEB_CHAT_CONFIG_STORE_VERSION'")
    expect(indexedDB).toContain("from '@/constants/storage'")
    expect(indexedDB).not.toContain('const MESSAGE_STORE_VERSION =')
    expect(storage).toContain('CONFIG_STORE_VERSION')
    expect(storage).toMatch(
      /import \{[^}]*CONFIG_STORE_VERSION_KEY[^}]*STORAGE_NAME[^}]*\} from '@\/constants\/storage'/
    )
    expect(storagePreparation).toMatch(
      /import \{[^}]*\bCONFIG_STORE_VERSION\b[^}]*\bCONFIG_STORE_VERSION_KEY\b[^}]*\} from '@\/constants\/storage'/
    )
    expect(storageConstants).toContain("export const STORAGE_NAME = 'WEB_CHAT_STORAGE'")
    expect(storageConstants).toContain("export const APP_OPEN_STORAGE_KEY = 'WEB_CHAT_APP_STATUS:OPEN' as const")
    expect(storageConstants).toContain(
      "export const APP_POSITION_STORAGE_KEY = 'WEB_CHAT_APP_STATUS:POSITION' as const"
    )
    expect(storageConstants).toContain("export const APP_UNREAD_STORAGE_KEY = 'WEB_CHAT_APP_STATUS:UNREAD' as const")
    expect(storageConstants).toContain(
      "export const APP_MESSAGE_AUTHOR_STORAGE_KEY = 'WEB_CHAT_APP_STATUS:MESSAGE_AUTHOR' as const"
    )
    expect(storageConstants).toContain("export const USER_INFO_STORAGE_KEY = 'WEB_CHAT_USER_INFO'")
    expect(indexedDB.match(/createMessageDatabaseDefinition\(STORAGE_NAME, MESSAGE_STORE_VERSION\)/g)).toHaveLength(2)
    expect(indexedDB).toMatch(/withPreparationLock\(\s*`message:\$\{STORAGE_NAME\}`/)
    expect(indexedDB).toContain('MESSAGE_STORE_DELETION_BLOCKED_TIMEOUT_MS')
    expect(indexedDB).toContain("reject(new Error('Message store deletion blocked'))")
    expect(indexedDB).toContain('database.name === STORAGE_NAME')
    expect(indexedDB).toContain('const deleteMessageDatabase = (): Promise<void> =>')
    expect(indexedDB).toContain('indexedDB.deleteDatabase(STORAGE_NAME)')
    expect(indexedDB).toContain('await deleteMessageDatabase()')

    const storageConstantNames = [
      'STORAGE_NAME',
      'MESSAGE_STORE_VERSION',
      'APP_OPEN_STORAGE_KEY',
      'APP_POSITION_STORAGE_KEY',
      'APP_UNREAD_STORAGE_KEY',
      'APP_MESSAGE_AUTHOR_STORAGE_KEY',
      'USER_INFO_STORAGE_KEY',
      'CONFIG_STORE_VERSION',
      'CONFIG_STORE_VERSION_KEY'
    ]
    const sourceEntries = await Promise.all(
      (await codeFiles(projectPath('src'))).map(async (file) => [file, await source(file)] as const)
    )
    storageConstantNames.forEach((name) =>
      expect(
        sourceEntries
          .filter(([, value]) => new RegExp(`^export const ${name}(?:\\s|=)`, 'm').test(value))
          .map(([file]) => path.relative(ROOT, file))
      ).toEqual(['src/constants/storage.ts'])
    )

    expect(content).toContain('prepareBrowserSyncStorage: requestBrowserSyncStoragePreparation')
    expect(content).toContain(
      'const preparationLockCoordinator = import.meta.env.FIREFOX\n  ? createDirectPreparationCoordinator()\n  : createWebLocksPreparationCoordinator()'
    )
    expect(content).toContain('prepareLocalStorage: () => prepareLocalConfigurationStorage(preparationLockCoordinator)')
    expect(content).toContain(
      'prepareMessageDatabase: () => prepareIndexedDBMessageDatabase(preparationLockCoordinator)'
    )
    expect(content).toContain('initializeRuntime: initClient')
    expect(content).toContain('startInitializationLifecycle({')
    expect(content).toContain('dependencies: initializationDependencies')
    expect(content).toContain('activateApplicationDependencies')
    expect(content).not.toMatch(/<App\s+[^>]*(?:dependenc|activat|timeout)/)
    expect(background).toContain('registerBrowserSyncStoragePreparation()')
    ;[
      'run(dependencies.prepareBrowserSyncStorage)',
      'run(dependencies.prepareLocalStorage)',
      'run(dependencies.prepareMessageDatabase)'
    ].forEach((preparation) => {
      expect(initialization.indexOf(preparation)).toBeLessThan(
        initialization.indexOf('return dependencies.initializeRuntime()')
      )
      expect(initialization.indexOf(preparation)).toBeLessThan(
        initialization.lastIndexOf('activateApplicationDependencies()')
      )
    })
    expect(options.indexOf('await requestBrowserSyncStoragePreparation()')).toBeLessThan(
      options.indexOf('Remesh.store(')
    )
    expect(options.indexOf('await requestBrowserSyncStoragePreparation()')).toBeLessThan(options.indexOf('createRoot('))
    expect(
      `${background}\n${content}\n${initialization}\n${options}\n${indexedDB}\n${storage}\n${storagePreparation}`
    ).not.toMatch(/package\.json|WEB_CHAT_VERSION|VERSION_STORAGE_KEY/)
    expect(`${indexedDB}\n${storage}\n${storagePreparation}`).not.toMatch(
      /AppFeedback|ToastDomain|SystemNotice|alert\(/
    )
  })

  it('does not leak Database primitives or adapters into Chat/UI or public protocol exports', async () => {
    const files = [
      ...(await codeFiles(projectPath('src/app'))),
      projectPath('src/domain/ChatRoom.ts'),
      projectPath('src/domain/externs/ChatRoom.ts')
    ]
    const violations: string[] = []
    for (const file of files) {
      if (/\.test\.[cm]?[jt]sx?$/.test(file)) continue
      const value = await source(file)
      if (/domain\/(?:externs\/Database|impls\/database)/.test(value)) violations.push(file)
    }
    expect(violations).toEqual([projectPath('src/app/content/index.tsx')])
    expect(await source('src/protocol/index.ts')).not.toMatch(/Database|MessageStore|MessageRecord/)
  })
})
