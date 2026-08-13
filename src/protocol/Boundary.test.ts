import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const PROTOCOL_ROOT = path.resolve(import.meta.dirname)
const CONFIG_PATH = path.resolve(PROTOCOL_ROOT, '../constants/config.ts')
const PUBLIC_FILES = ['ChatRoom.ts', 'Limits.ts', 'Session.ts', 'WireCodec.ts', 'WorldRoom.ts', 'index.ts']
const FORBIDDEN_VALIDATORS = [
  'parseChatRoomMessage',
  'parseWorldRoomMessage',
  'checkChatRoomMessage',
  'checkWorldRoomMessage',
  'isUserWithinLimit',
  'isMessageWithinLimit',
  'isHLCInRange',
  'isChatRoomMessageSemanticallyValid'
]
const FORBIDDEN_SYMBOLS = [
  'LocalRecord',
  'DurableEventRecord',
  'RecordStatus',
  'SystemNoticeRecord',
  'ProjectedTextMessage',
  'LocalMessage',
  'MessageProjection',
  'compareHLC',
  'compareEventPosition',
  'WirePipeline',
  'RuntimeServer',
  'RuntimeCoordinator',
  'RuntimeSnapshot',
  'HostPhase'
]
const ALLOWED_DEPENDENCIES = new Set([
  'valibot',
  'core-js/actual/typed-array/from-base64',
  'core-js/actual/typed-array/to-base64'
])
const PUBLIC_LIMITS = [
  'MAX_WIRE_BYTES',
  'MAX_DECODED_JSON_BYTES',
  'MAX_CHAT_BODY_CODE_UNITS',
  'MAX_USER_BYTES',
  'MAX_HISTORY_RESPONSE_MESSAGES'
]

describe('public protocol source boundary', () => {
  it('contains only the third-party peer contract modules', async () => {
    const files = (await readdir(PROTOCOL_ROOT))
      .filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts'))
      .sort()
    expect(files).toEqual(PUBLIC_FILES)
  })

  it('has no application, Runtime orchestration, host, or hidden-clock dependencies', async () => {
    const sources = await Promise.all(
      PUBLIC_FILES.map(async (file) => [file, await readFile(path.join(PROTOCOL_ROOT, file), 'utf8')] as const)
    )

    for (const [file, source] of sources) {
      expect(source, `${file} has an internal absolute import`).not.toMatch(/from ['"]@\//)
      expect(source, `${file} has a host dependency`).not.toMatch(
        /(?:from ['"](?:comctx|remesh)|\b(?:chrome|browser)\.|\b(?:window|document)\b)/
      )
      expect(source, `${file} reads a hidden wall clock`).not.toContain('Date.now')
      const dependencies = [...source.matchAll(/(?:from\s+|import\s+)['"]([^'"]+)['"]/g)].map((match) => match[1]!)
      for (const dependency of dependencies) {
        expect(
          dependency.startsWith('.') || ALLOWED_DEPENDENCIES.has(dependency),
          `${file} imports unsupported dependency ${dependency}`
        ).toBe(true)
      }
      for (const symbol of FORBIDDEN_SYMBOLS) {
        expect(source, `${file} contains private symbol ${symbol}`).not.toContain(symbol)
      }
    }
  })

  it('owns every public resource limit instead of importing app configuration', async () => {
    const limits = await readFile(path.join(PROTOCOL_ROOT, 'Limits.ts'), 'utf8')
    const config = await readFile(CONFIG_PATH, 'utf8')

    for (const name of PUBLIC_LIMITS) {
      expect(limits).toMatch(new RegExp(`export const ${name} =`))
      expect(config).not.toContain(name)
    }
  })

  it('derives every public type from its owning schema with no handwritten duplicate', async () => {
    const sources = await Promise.all(
      PUBLIC_FILES.map(async (file) => [file, await readFile(path.join(PROTOCOL_ROOT, file), 'utf8')] as const)
    )
    for (const [file, source] of sources) {
      // No handwritten interface or standalone structural type may describe a protocol value
      // (WireCodec is an ordinary non-message API declaration, not a protocol data type).
      if (file !== 'WireCodec.ts') {
        expect(source, `${file} declares a handwritten interface`).not.toMatch(/export interface/)
      }
      // Every exported type is inferred from its owning schema output.
      expect(source, `${file} has a non-inferred export type`).not.toMatch(
        /export type [A-Za-z0-9_]+ = (?!v\.InferOutput)/
      )
      // No post-parse validator, output cast, schema factory, or executable callback may finish
      // validation after schema parsing (declarative Valibot primitives only).
      for (const validator of FORBIDDEN_VALIDATORS) {
        expect(source, `${file} retains validator ${validator}`).not.toContain(validator)
      }
      expect(source, `${file} uses an executable callback predicate`).not.toMatch(
        /v\.(?:check|partialCheck|rawCheck|custom|transform)\b/
      )
      expect(source, `${file} casts schema output`).not.toMatch(
        /as (?:ChatRoomMessage|ChatMessage|WorldRoomMessage|ChatUser|ChatSession|HLC)\b/
      )
    }
  })

  it('has no caller-side protocol revalidation or output casts in the runtime graph', async () => {
    const runtimeFiles = [
      'src/app/content/index.tsx',
      'src/domain/ChatRoom.ts',
      'src/domain/MessageList.ts',
      'src/domain/MessageProjection.ts',
      'src/domain/MessageStore.ts',
      'src/domain/externs/ChatRoom.ts',
      'src/domain/impls/runtime/ChatRoom.ts',
      'src/domain/runtime/History.ts',
      'src/domain/runtime/Session.ts',
      'src/runtime/Contract.ts',
      'src/runtime/PresenceStore.ts',
      'src/runtime/Server.ts'
    ]
    const forbidden = [
      'Chat record user does not match its message',
      'ChatRoom returned an invalid local text message',
      'existing as MessageRecord',
      'if (!user) continue',
      'record.user.id !== record.message.userId',
      'record.id !== record.message.id',
      'as TextMessageRecord',
      'as ReactionMessageRecord',
      'sanitizeSite',
      'projectChatUser',
      'parsePresenceRecord',
      // The v5 Chat protocol has no end surface: no end message, end schema, end union member,
      // end alias, or receiver end handler may exist in the runtime graph.
      'SESSION_END',
      'session-end',
      'SessionEnd'
    ]
    for (const file of runtimeFiles) {
      const source = await readFile(path.resolve(import.meta.dirname, `../../${file}`), 'utf8')
      for (const pattern of forbidden) {
        expect(source, `${file} retains forbidden caller-side check ${pattern}`).not.toContain(pattern)
      }
    }
  })

  it('exports only peer definitions, limits, schemas, inferred types, and the reference codec', async () => {
    const entry = await readFile(path.join(PROTOCOL_ROOT, 'index.ts'), 'utf8')
    expect(entry.trim().split('\n')).toEqual([
      "export * from './Limits'",
      "export * from './Session'",
      "export * from './ChatRoom'",
      "export * from './WorldRoom'",
      "export * from './WireCodec'"
    ])
  })
})
