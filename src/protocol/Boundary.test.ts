import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const PROTOCOL_ROOT = path.resolve(import.meta.dirname)
const CONFIG_PATH = path.resolve(PROTOCOL_ROOT, '../constants/config.ts')
const PUBLIC_FILES = ['ChatRoom.ts', 'Limits.ts', 'Session.ts', 'WireCodec.ts', 'WorldRoom.ts', 'index.ts']
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
  'MAX_CHAT_EVENT_BYTES',
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

  it('exports only peer definitions, limits, validators, and the reference codec', async () => {
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
