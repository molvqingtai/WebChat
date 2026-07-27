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

describe('replaceable application boundaries', () => {
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

    expect(content.indexOf("window.addEventListener('beforeunload', detachClient")).toBeGreaterThan(-1)
    expect(content.indexOf("window.addEventListener('beforeunload', detachClient")).toBeLessThan(
      content.indexOf('await initClient()')
    )
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
    expect(chatPort).toContain('sendMessage(command: SendMessageCommand): Promise<ChatMessage>')
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

  it('keeps the canonical IndexedDB identity on its private version authority', async () => {
    const [content, config, indexedDB, storage] = await Promise.all([
      source('src/app/content/index.tsx'),
      source('src/constants/config.ts'),
      source('src/domain/impls/database/IndexedDB.ts'),
      source('src/domain/impls/Storage.ts')
    ])

    expect(content).not.toMatch(/VERSION_STORAGE_KEY|indexDBStorage|package\.json|storedVersion/)
    expect(config).not.toContain('VERSION_STORAGE_KEY')
    expect(storage).not.toMatch(/indexedDbDriver|indexDBStorage/)
    expect(indexedDB).toContain('const MESSAGE_STORE_VERSION = 2')
    expect(indexedDB).toContain('EVENTS_V2_CANONICAL_RECORDS')
  })

  it('does not leak Database primitives or adapters into Chat/UI or public protocol exports', async () => {
    const files = [
      ...(await codeFiles(projectPath('src/app'))),
      projectPath('src/domain/ChatRoom.ts'),
      projectPath('src/domain/externs/ChatRoom.ts')
    ]
    const violations: string[] = []
    for (const file of files) {
      const value = await source(file)
      if (/domain\/(?:externs\/Database|impls\/database)/.test(value)) violations.push(file)
    }
    expect(violations).toEqual([projectPath('src/app/content/index.tsx')])
    expect(await source('src/protocol/index.ts')).not.toMatch(/Database|MessageStore|MessageRecord/)
  })
})
