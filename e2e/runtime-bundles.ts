import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

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

const chromeRoot = '.output/chrome-mv3'
const firefoxRoot = '.output/firefox-mv2'
const [chromeManifest, firefoxManifest, chromeChunks, firefoxBackground, wireCodecSource] = await Promise.all([
  readJson(join(chromeRoot, 'manifest.json')),
  readJson(join(firefoxRoot, 'manifest.json')),
  readdir(join(chromeRoot, 'chunks')),
  readFile(join(firefoxRoot, 'background.js'), 'utf8'),
  readFile('src/protocol/WireCodec.ts', 'utf8')
])

assert(chromeManifest.manifest_version === 3, 'Expected the production Chrome MV3 manifest')
assert(chromeManifest.background?.service_worker === 'background.js', 'Expected the Chrome service-worker host')
assert(firefoxManifest.manifest_version === 2, 'Expected the production Firefox MV2 manifest')
assert(firefoxManifest.background?.scripts?.includes('background.js'), 'Expected the Firefox background-page host')

const chromeHostChunk = chromeChunks.find((file) => file.startsWith('host-') && file.endsWith('.js'))
assert(chromeHostChunk, 'Expected the production Chrome Offscreen host chunk')
const chromeContentEntries = chromeManifest.content_scripts?.flatMap((entry) => entry.js ?? []) ?? []
const firefoxContentEntries = firefoxManifest.content_scripts?.flatMap((entry) => entry.js ?? []) ?? []
assert(chromeContentEntries.length > 0, 'Expected at least one production Chrome content entry')
assert(firefoxContentEntries.length > 0, 'Expected at least one production Firefox content entry')
const [chromeHost, chromeContent, firefoxContent] = await Promise.all([
  readFile(join(chromeRoot, 'chunks', chromeHostChunk), 'utf8'),
  (async () => {
    const loads: Promise<string>[] = []
    // functional-loop: owner-commit — ordered per-chunk read submission with no bulk primitive
    for (const entry of chromeContentEntries) {
      loads.push(readFile(join(chromeRoot, entry), 'utf8'))
    }
    return Promise.all(loads)
  })(),
  (async () => {
    const loads: Promise<string>[] = []
    // functional-loop: owner-commit — ordered per-chunk read submission with no bulk primitive
    for (const entry of firefoxContentEntries) {
      loads.push(readFile(join(firefoxRoot, entry), 'utf8'))
    }
    return Promise.all(loads)
  })()
])
assert(!chromeHost.includes('tabs.query'), 'Chrome Offscreen host must not contain tabs.query')
// functional-loop: owner-commit — ordered per-item emission with no bulk primitive
for (const marker of ['this.tabs.get', 'this.tabs.sendMessage']) {
  assert(firefoxBackground.includes(marker), `Firefox background provider must retain ${marker}`)
}
// functional-loop: owner-commit — ordered per-item emission with no bulk primitive
for (const relayMarker of ['Dropped Offscreen Runtime relay:', 'untrusted-source', 'target-mismatch']) {
  assert(
    !firefoxBackground.includes(relayMarker),
    `Firefox background must not contain Chrome relay marker ${relayMarker}`
  )
}

const expectedCoreJsImports = ['core-js/actual/typed-array/from-base64', 'core-js/actual/typed-array/to-base64']
const coreJsImports = [...wireCodecSource.matchAll(/^import '([^']*core-js[^']*)'$/gm)].map((match) => match[1])
assert(
  JSON.stringify(coreJsImports) === JSON.stringify(expectedCoreJsImports),
  `WireCodec must use only the scoped Base64 imports: ${coreJsImports.join(', ')}`
)
const codecPolyfillMarkers = [
  'fromBase64',
  'toBase64',
  'lastChunkHandling',
  'setFromBase64',
  'fromHex',
  'toHex',
  'setFromHex'
]
// functional-loop: owner-commit — ordered per-item emission with no bulk primitive
for (const [target, bundles] of [
  ['Chrome content', chromeContent],
  ['Firefox content', firefoxContent]
] as const) {
  // functional-loop: owner-commit — ordered per-item emission with no bulk primitive
  for (const [index, bundle] of bundles.entries()) {
    // functional-loop: owner-commit — ordered per-item emission with no bulk primitive
    for (const marker of codecPolyfillMarkers) {
      assert(!bundle.includes(marker), `${target} entry ${index} must not contain codec polyfill marker ${marker}`)
    }
  }
}
// functional-loop: owner-commit — ordered per-item emission with no bulk primitive
for (const [target, bundle] of [
  ['Chrome host', chromeHost],
  ['Firefox background', firefoxBackground]
] as const) {
  // functional-loop: owner-commit — ordered per-item emission with no bulk primitive
  for (const marker of ['fromBase64', 'toBase64', 'lastChunkHandling']) {
    assert(bundle.includes(marker), `${target} must contain ${marker}`)
  }
  // functional-loop: owner-commit — ordered per-item emission with no bulk primitive
  for (const residue of ['setFromBase64', 'fromHex', 'toHex', 'setFromHex', 'atob(', 'btoa(']) {
    assert(!bundle.includes(residue), `${target} must not contain unrelated Base64/hex residue ${residue}`)
  }
}

console.log(
  JSON.stringify({
    chrome: {
      manifestVersion: 3,
      contentBytes: chromeContent.reduce((total, bundle) => total + Buffer.byteLength(bundle), 0),
      contentCodecPolyfill: false,
      offscreenTabsQuery: false,
      runtimeBytes: Buffer.byteLength(chromeHost),
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
