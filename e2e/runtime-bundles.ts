import { readdir, readFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

type ExtensionManifest = {
  manifest_version?: number
  background?: {
    service_worker?: string
    scripts?: string[]
  }
  content_scripts?: Array<{
    js?: string[]
  }>
}

const readJson = async (path: string): Promise<ExtensionManifest> =>
  JSON.parse(await readFile(path, 'utf8')) as ExtensionManifest
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

type ReadText = (path: string) => Promise<string>

const requiredCodecMarkers = ['fromBase64', 'toBase64', 'lastChunkHandling']
const prohibitedCodecResidue = [
  '{setFromBase64:function',
  '{fromHex:function',
  '{toHex:function',
  '{setFromHex:function',
  '{atob:function',
  '{btoa:function'
]

const staticEsmSpecifierPattern =
  /(?:^|[;\n])\s*(?:import\s*(?:[\w$*{},\s]+?\s*from\s*)?|export\s*(?:[\w$*{},\s]+?\s*from\s*))(['"])([^'"\\]+)\1/g

const staticEsmSpecifiers = (source: string): string[] =>
  [...source.matchAll(staticEsmSpecifierPattern)].map((match) => match[2])

const isInsideOutputDirectory = (outputRoot: string, modulePath: string): boolean => {
  const pathFromRoot = relative(outputRoot, modulePath)
  return pathFromRoot !== '..' && !pathFromRoot.startsWith(`..${sep}`) && !isAbsolute(pathFromRoot)
}

const resolveStaticLocalImport = (outputRoot: string, importerPath: string, specifier: string): string => {
  if (!specifier.startsWith('./') && !specifier.startsWith('../')) {
    throw new Error(`Static import must be local: ${specifier} from ${importerPath}`)
  }
  const resolvedPath = resolve(dirname(importerPath), specifier)
  if (!isInsideOutputDirectory(outputRoot, resolvedPath)) {
    throw new Error(`Static import escapes build output: ${specifier} from ${importerPath}`)
  }
  return resolvedPath
}

const staticLocalDependencies = (outputRoot: string, importerPath: string, source: string): string[] =>
  staticEsmSpecifiers(source).map((specifier) => resolveStaticLocalImport(outputRoot, importerPath, specifier))

const collectStaticLocalEsmClosure = async (
  outputRoot: string,
  entryPath: string,
  readText: ReadText
): Promise<Map<string, string>> => {
  const resolvedRoot = resolve(outputRoot)
  const resolvedEntry = resolve(entryPath)
  if (!isInsideOutputDirectory(resolvedRoot, resolvedEntry)) {
    throw new Error(`Entry is outside build output: ${entryPath}`)
  }

  const closure = new Map<string, string>()
  const pending = [resolvedEntry]
  while (pending.length > 0) {
    const modulePath = pending.pop()
    if (modulePath === undefined || closure.has(modulePath)) continue
    let source: string
    try {
      source = await readText(modulePath)
    } catch {
      throw new Error(`Unable to resolve static local module: ${modulePath}`)
    }
    closure.set(modulePath, source)
    pending.push(...staticLocalDependencies(resolvedRoot, modulePath, source))
  }
  return closure
}

const assertCodecBoundary = (target: string, sources: Iterable<string>) => {
  const source = [...sources].join('\n')
  requiredCodecMarkers.forEach((marker) => assert(source.includes(marker), `${target} must contain ${marker}`))
  prohibitedCodecResidue.forEach((residue) =>
    assert(!source.includes(residue), `${target} must not contain unrelated Base64/hex residue ${residue}`)
  )
}

const expectRejected = async (operation: () => Promise<unknown>, message: string) => {
  try {
    await operation()
  } catch {
    return
  }
  throw new Error(message)
}

const fixtureReader =
  (files: ReadonlyMap<string, string>): ReadText =>
  async (path) => {
    const source = files.get(path)
    if (source === undefined) throw new Error(`Missing fixture module: ${path}`)
    return source
  }

const runStaticClosureControls = async () => {
  const fixtureRoot = resolve('.runtime-bundles-fixture')
  const entryPath = join(fixtureRoot, 'background.js')
  const codecPath = join(fixtureRoot, 'chunks', 'codec.js')
  const completeFiles = new Map<string, string>([
    [entryPath, "import './chunks/codec.js'"],
    [codecPath, 'const fromBase64 = 1; const toBase64 = 1; const lastChunkHandling = 1']
  ])
  const collectFixture = (files: ReadonlyMap<string, string>) =>
    collectStaticLocalEsmClosure(fixtureRoot, entryPath, fixtureReader(files))

  const completeClosure = await collectFixture(completeFiles)
  const entrySource = completeClosure.get(entryPath)
  assert(entrySource !== undefined, 'Static closure control must include its entry')
  assert(
    requiredCodecMarkers.every((marker) => !entrySource.includes(marker)),
    'Static closure control entry must remain marker-free'
  )
  assert(completeClosure.has(codecPath), 'Static closure control must include its direct dependency')
  assertCodecBoundary('Static closure control', completeClosure.values())

  const withoutStaticImport = new Map(completeFiles)
  withoutStaticImport.set(entryPath, 'export {}')
  await expectRejected(
    async () =>
      assertCodecBoundary('Missing static import control', (await collectFixture(withoutStaticImport)).values()),
    'Deleting the static import must fail the codec boundary'
  )

  for (const marker of requiredCodecMarkers) {
    const withoutMarker = new Map(completeFiles)
    withoutMarker.set(codecPath, completeFiles.get(codecPath)?.replace(marker, '') ?? '')
    await expectRejected(
      async () => assertCodecBoundary(`Missing ${marker} control`, (await collectFixture(withoutMarker)).values()),
      `Deleting ${marker} must fail the codec boundary`
    )
  }

  const dynamicOnlyImport = new Map(completeFiles)
  dynamicOnlyImport.set(entryPath, "import('./chunks/codec.js')")
  await expectRejected(
    async () => assertCodecBoundary('Dynamic import control', (await collectFixture(dynamicOnlyImport)).values()),
    'A dynamic import must not satisfy the static closure'
  )

  const cycleAPath = join(fixtureRoot, 'chunks', 'cycle-a.js')
  const cycleBPath = join(fixtureRoot, 'chunks', 'cycle-b.js')
  const cycleFiles = new Map<string, string>([
    [entryPath, "import './chunks/cycle-a.js'; import './chunks/cycle-a.js'"],
    [cycleAPath, "import './cycle-b.js'"],
    [cycleBPath, "import './cycle-a.js'; const fromBase64 = 1; const toBase64 = 1; const lastChunkHandling = 1"]
  ])
  const cycleClosure = await collectFixture(cycleFiles)
  assert(cycleClosure.size === 3, 'Cycles and duplicate imports must be visited exactly once')
  assertCodecBoundary('Cycle control', cycleClosure.values())

  await expectRejected(
    () => collectFixture(new Map([[entryPath, "import './chunks/missing.js'"]])),
    'A missing static local import must fail closed'
  )
  await expectRejected(
    () => collectFixture(new Map([[entryPath, "import '../outside.js'"]])),
    'An escaping static import must fail closed'
  )
  await expectRejected(
    () => collectFixture(new Map([[entryPath, "import 'https://example.test/codec.js'"]])),
    'A remote static import must fail closed'
  )
}

await runStaticClosureControls()

const chromeRoot = '.output/chrome-mv3'
const firefoxRoot = '.output/firefox-mv2'
const [chromeManifest, firefoxManifest, chromeChunks, chromeBackground, firefoxBackground, wireCodecSource] =
  await Promise.all([
    readJson(join(chromeRoot, 'manifest.json')),
    readJson(join(firefoxRoot, 'manifest.json')),
    readdir(join(chromeRoot, 'chunks')),
    readFile(join(chromeRoot, 'background.js'), 'utf8'),
    readFile(join(firefoxRoot, 'background.js'), 'utf8'),
    readFile('src/protocol/WireCodec.ts', 'utf8')
  ])

assert(chromeManifest.manifest_version === 3, 'Expected the production Chrome MV3 manifest')
assert(chromeManifest.background?.service_worker === 'background.js', 'Expected the Chrome service-worker host')
assert(firefoxManifest.manifest_version === 2, 'Expected the production Firefox MV2 manifest')
assert(firefoxManifest.background?.scripts?.includes('background.js'), 'Expected the Firefox background-page host')

const chromeTransportChunk = chromeChunks.find((file) => file.startsWith('TransportHost-') && file.endsWith('.js'))
assert(chromeTransportChunk, 'Expected the production Chrome Offscreen transport chunk')
const chromeOutputRoot = resolve(chromeRoot)
const chromeBackgroundPath = resolve(chromeRoot, 'background.js')
const chromeTransportPath = resolve(chromeRoot, 'chunks', chromeTransportChunk)
const chromeContentEntries = chromeManifest.content_scripts?.flatMap((entry) => entry.js ?? []) ?? []
const firefoxContentEntries = firefoxManifest.content_scripts?.flatMap((entry) => entry.js ?? []) ?? []
assert(chromeContentEntries.length > 0, 'Expected at least one production Chrome content entry')
assert(firefoxContentEntries.length > 0, 'Expected at least one production Firefox content entry')
const [chromeTransport, chromeContent, firefoxContent] = await Promise.all([
  readFile(join(chromeRoot, 'chunks', chromeTransportChunk), 'utf8'),
  Promise.all(chromeContentEntries.map((entry) => readFile(join(chromeRoot, entry), 'utf8'))),
  Promise.all(firefoxContentEntries.map((entry) => readFile(join(firefoxRoot, entry), 'utf8')))
])
assert(!chromeTransport.includes('tabs.query'), 'Chrome Offscreen transport must not contain tabs.query')
assert(
  staticLocalDependencies(chromeOutputRoot, chromeBackgroundPath, chromeBackground).includes(chromeTransportPath),
  'Chrome background must statically import the production transport chunk'
)
const chromeRuntimeClosure = await collectStaticLocalEsmClosure(chromeOutputRoot, chromeBackgroundPath, (path) =>
  readFile(path, 'utf8')
)
;['this.tabs.get', 'this.tabs.sendMessage'].forEach((marker) =>
  assert(firefoxBackground.includes(marker), `Firefox background provider must retain ${marker}`)
)
;['untrusted-source', 'target-mismatch'].forEach((relayMarker) =>
  assert(
    !firefoxBackground.includes(relayMarker),
    `Firefox background must not contain Chrome relay marker ${relayMarker}`
  )
)

const expectedCoreJsImports = ['core-js/actual/typed-array/from-base64', 'core-js/actual/typed-array/to-base64']
const coreJsImports = [...wireCodecSource.matchAll(/^import '([^']*core-js[^']*)'$/gm)].map((match) => match[1])
assert(
  JSON.stringify(coreJsImports) === JSON.stringify(expectedCoreJsImports),
  `WireCodec must use only the scoped Base64 imports: ${coreJsImports.join(', ')}`
)
const codecPolyfillMarkers = [...requiredCodecMarkers, 'setFromBase64', 'fromHex', 'toHex', 'setFromHex']
;(
  [
    ['Chrome content', chromeContent],
    ['Firefox content', firefoxContent]
  ] as const
).forEach(([target, bundles]) =>
  bundles.forEach((bundle, index) =>
    codecPolyfillMarkers.forEach((marker) =>
      assert(!bundle.includes(marker), `${target} entry ${index} must not contain codec polyfill marker ${marker}`)
    )
  )
)
assertCodecBoundary('Chrome background static module closure', chromeRuntimeClosure.values())
assertCodecBoundary('Firefox background', [firefoxBackground])

console.log(
  JSON.stringify({
    chrome: {
      manifestVersion: 3,
      contentBytes: chromeContent.reduce((total, bundle) => total + Buffer.byteLength(bundle), 0),
      contentCodecPolyfill: false,
      offscreenTabsQuery: false,
      runtimeBytes: Buffer.byteLength(chromeBackground),
      transportBytes: Buffer.byteLength(chromeTransport),
      uint8ArrayBase64: true
    },
    firefox: {
      manifestVersion: 2,
      contentBytes: firefoxContent.reduce((total, bundle) => total + Buffer.byteLength(bundle), 0),
      contentCodecPolyfill: false,
      tabsProvider: true,
      offscreenRelay: false,
      runtimeBytes: Buffer.byteLength(firefoxBackground),
      uint8ArrayBase64: true
    },
    coreJsImports
  })
)
