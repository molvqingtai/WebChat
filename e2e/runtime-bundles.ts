import { readdir, readFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { API } from 'typescript/unstable/sync'
import { isCallExpression, SyntaxKind, type Node } from 'typescript/unstable/ast'

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
  // SAFETY: the manifest file is the build output this check parses.
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

const dynamicImportSources = new Map<string, string>()
const dynamicImportParser = new API({
  fs: {
    readFile: (path) => dynamicImportSources.get(path),
    fileExists: (path) => (dynamicImportSources.has(path) ? true : undefined)
  }
})
let dynamicImportSourceIndex = 0

const containsDynamicImportCall = (node: Node): boolean =>
  (isCallExpression(node) && node.expression.kind === SyntaxKind.ImportKeyword) ||
  node.forEachChild(containsDynamicImportCall) === true

const hasDynamicImport = (source: string): boolean => {
  const sourcePath = resolve('.runtime-bundles-parser', `${dynamicImportSourceIndex++}.js`)
  dynamicImportSources.set(sourcePath, source)
  try {
    const snapshot = dynamicImportParser.updateSnapshot({ openFiles: [sourcePath] })
    try {
      const project = snapshot.getDefaultProjectForFile(sourcePath)
      const sourceFile = project?.program.getSourceFile(sourcePath)
      if (project === undefined || sourceFile === undefined) return true
      return project.program.getSyntacticDiagnostics(sourcePath).length > 0 || containsDynamicImportCall(sourceFile)
    } finally {
      snapshot.dispose()
    }
  } catch {
    return true
  }
}

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
    // oxlint-disable-next-line anti-slop/no-known-value-widening -- the assertion helper accepts any checked value
    assert(!hasDynamicImport(source), `Dynamic import is not allowed in static module closure: ${modulePath}`)
    closure.set(modulePath, source)
    pending.push(...staticLocalDependencies(resolvedRoot, modulePath, source))
  }
  return closure
}

const assertCodecBoundary = (target: string, sources: Iterable<string>) => {
  const source = [...sources].join('\n')
  requiredCodecMarkers.forEach((marker) => assert(source.includes(marker), `${target} must contain ${marker}`))
  prohibitedCodecResidue.forEach((residue) =>
    // oxlint-disable-next-line anti-slop/no-known-value-widening -- the synchronous residue scan reads a literal residue string from the packaged source
    assert(!source.includes(residue), `${target} must not contain unrelated Base64/hex residue ${residue}`)
  )
}

// oxlint-disable-next-line anti-slop/no-unknown-returns -- the helper returns the rejected operation outcome
const expectRejected = async (operation: () => Promise<unknown>, message: string): Promise<unknown> => {
  try {
    await operation()
  } catch (error) {
    return error
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

  const staticAndDynamicImport = new Map(completeFiles)
  staticAndDynamicImport.set(entryPath, "import './chunks/codec.js'; import('./chunks/dynamic.js')")
  const dynamicImportError = await expectRejected(
    () => collectFixture(staticAndDynamicImport),
    'A complete static codec dependency with a dynamic import must fail the static closure'
  )
  assert(
    dynamicImportError instanceof Error && dynamicImportError.message.includes('Dynamic import is not allowed'),
    'A dynamic import must reject before any dynamic dependency is traversed'
  )

  const staticAndCommentDynamicImport = new Map(completeFiles)
  staticAndCommentDynamicImport.set(entryPath, "import './chunks/codec.js'; import /* lazy */ ('./chunks/dynamic.js')")
  const commentDynamicImportError = await expectRejected(
    () => collectFixture(staticAndCommentDynamicImport),
    'A complete static codec dependency with a comment-separated dynamic import must fail the static closure'
  )
  assert(
    commentDynamicImportError instanceof Error &&
      commentDynamicImportError.message.includes('Dynamic import is not allowed'),
    'A comment-separated dynamic import must reject before any dynamic dependency is traversed'
  )

  const unparsableStaticModule = new Map(completeFiles)
  unparsableStaticModule.set(entryPath, "import './chunks/codec.js'; const =")
  await expectRejected(
    () => collectFixture(unparsableStaticModule),
    'A static module with syntax diagnostics must fail closed'
  )

  const nonCodeImportText = new Map(completeFiles)
  nonCodeImportText.set(
    entryPath,
    [
      "import './chunks/codec.js'",
      'const quoted = "import /* lazy */ (\'./chunks/lazy.js\')"',
      "const templated = `import /* lazy */ ('./chunks/lazy.js')`",
      "// import /* lazy */ ('./chunks/lazy.js')",
      "/* import ('./chunks/lazy.js') */",
      'const loader = { import: () => undefined }',
      'const methodLoader = { import() { return undefined } }',
      'class MethodLoader { import() { return undefined } }',
      'loader.import()',
      'loader?.import()'
    ].join('\n')
  )
  assertCodecBoundary('Non-code import control', (await collectFixture(nonCodeImportText)).values())

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
const [
  chromeManifest,
  firefoxManifest,
  chromeChunks,
  chromeBackground,
  firefoxBackground,
  chromeOffscreenHtml,
  wireCodecSource
] = await Promise.all([
  readJson(join(chromeRoot, 'manifest.json')),
  readJson(join(firefoxRoot, 'manifest.json')),
  readdir(join(chromeRoot, 'chunks')),
  readFile(join(chromeRoot, 'background.js'), 'utf8'),
  readFile(join(firefoxRoot, 'background.js'), 'utf8'),
  readFile(join(chromeRoot, 'offscreen.html'), 'utf8'),
  readFile('src/protocol/WireCodec.ts', 'utf8')
])

assert(chromeManifest.manifest_version === 3, 'Expected the production Chrome MV3 manifest')
assert(chromeManifest.background?.service_worker === 'background.js', 'Expected the Chrome service-worker host')
assert(firefoxManifest.manifest_version === 2, 'Expected the production Firefox MV2 manifest')
assert(firefoxManifest.background?.scripts?.includes('background.js'), 'Expected the Firefox background-page host')

const chromeHostChunk = chromeChunks.find((file) => file.startsWith('offscreen-') && file.endsWith('.js'))
assert(chromeHostChunk, 'Expected the production Chrome Offscreen host chunk')
const chromeOutputRoot = resolve(chromeRoot)
const chromeBackgroundPath = resolve(chromeRoot, 'background.js')
const chromeHostPath = resolve(chromeRoot, 'chunks', chromeHostChunk)
const chromeContentEntries = chromeManifest.content_scripts?.flatMap((entry) => entry.js ?? []) ?? []
const firefoxContentEntries = firefoxManifest.content_scripts?.flatMap((entry) => entry.js ?? []) ?? []
assert(chromeContentEntries.length > 0, 'Expected at least one production Chrome content entry')
assert(firefoxContentEntries.length > 0, 'Expected at least one production Firefox content entry')
const [chromeHost, chromeContent, firefoxContent] = await Promise.all([
  readFile(chromeHostPath, 'utf8'),
  Promise.all(chromeContentEntries.map((entry) => readFile(join(chromeRoot, entry), 'utf8'))),
  Promise.all(firefoxContentEntries.map((entry) => readFile(join(firefoxRoot, entry), 'utf8')))
])

assert(chromeOffscreenHtml.includes(chromeHostChunk), 'Chrome Offscreen HTML must load the host chunk')
// Chrome keeps the transport and the logical Runtime in the Offscreen host. The Background is a stateless router.
assert(!chromeBackground.includes('RTCPeerConnection'), 'Chrome background must not own WebRTC')
assert(!chromeBackground.includes('SocketSignaling'), 'Chrome background must not own the signaling socket')
assert(!chromeBackground.includes('tabs.query'), 'Chrome background must not query tabs')
assert(chromeBackground.includes('tabs.sendMessage'), 'Chrome background must deliver host pushes via tabs')
assert(chromeBackground.includes('offscreen'), 'Chrome background must ensure the Offscreen host')
assert(
  !staticLocalDependencies(chromeOutputRoot, chromeBackgroundPath, chromeBackground).includes(chromeHostPath),
  'Chrome background must not statically import the Offscreen host'
)
assert(chromeHost.includes('RTCPeerConnection'), 'Chrome Offscreen host must own WebRTC')
assert(chromeHost.includes('SocketSignaling'), 'Chrome Offscreen host must own the signaling socket')
assert(!chromeHost.includes('tabs.query'), 'Chrome Offscreen host must not query tabs')
assert(!chromeHost.includes('tabs.sendMessage'), 'Chrome Offscreen host must not send tab messages')

const chromeRuntimeClosure = await collectStaticLocalEsmClosure(chromeOutputRoot, chromeHostPath, (path) =>
  readFile(path, 'utf8')
)

// Firefox has one persistent background document: it owns both the router and the transport.
assert(
  firefoxBackground.includes('RTCPeerConnection') || firefoxBackground.includes('SocketSignaling'),
  'Firefox background must own the transport'
)
assert(firefoxBackground.includes('tabs.sendMessage'), 'Firefox background must deliver host pushes via tabs')
;['this.tabs.get', 'this.tabs.sendMessage'].forEach((marker) =>
  assert(firefoxBackground.includes(marker), `Firefox background provider must retain ${marker}`)
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
      // oxlint-disable-next-line anti-slop/no-known-value-widening -- the bundle scan reads build output as text
      assert(!bundle.includes(marker), `${target} entry ${index} must not contain codec polyfill marker ${marker}`)
    )
  )
)
assertCodecBoundary('Chrome Offscreen host static module closure', chromeRuntimeClosure.values())
assertCodecBoundary('Firefox background', [firefoxBackground])
dynamicImportParser.close()

console.log(
  JSON.stringify({
    chrome: {
      manifestVersion: 3,
      contentBytes: chromeContent.reduce((total, bundle) => total + Buffer.byteLength(bundle), 0),
      contentCodecPolyfill: false,
      backgroundBytes: Buffer.byteLength(chromeBackground),
      hostBytes: Buffer.byteLength(chromeHost),
      backgroundWebrtc: false,
      hostWebrtc: true,
      offscreenTabsQuery: false,
      uint8ArrayBase64: true
    },
    firefox: {
      manifestVersion: 2,
      contentBytes: firefoxContent.reduce((total, bundle) => total + Buffer.byteLength(bundle), 0),
      contentCodecPolyfill: false,
      backgroundBytes: Buffer.byteLength(firefoxBackground),
      backgroundWebrtc: true,
      tabsProvider: true,
      uint8ArrayBase64: true
    },
    coreJsImports
  })
)
