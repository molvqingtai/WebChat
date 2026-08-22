import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({
  listener: undefined as ((message: unknown) => unknown) | undefined,
  invalidate: vi.fn(),
  proxy: {} as Record<string, unknown>
}))

vi.mock('#imports', () => ({
  browser: {
    runtime: {
      id: 'test-extension',
      onMessage: {
        addListener: (listener: (message: unknown) => unknown) => {
          fixture.listener = listener
        }
      }
    }
  }
}))

vi.mock('comctx', () => ({
  defineProxy: () => [undefined, () => fixture.proxy]
}))

vi.mock('@/service/adapter/runtime', () => ({
  InjectAdapter: class {},
  ownInjectRejections: () => {}
}))
vi.mock('@/runtime/DocumentClient', () => ({
  DocumentClient: class {
    whenReady = () => () => {}
    whenHostPhase = () => () => {}
    whenFailure = () => () => {}
    init = async () => null
    detach = () => {}
    snapshot = () => {
      throw new Error('not initialized')
    }
    invalidate = fixture.invalidate
  }
}))

describe('Page Runtime state-changed ingress', () => {
  beforeEach(() => {
    vi.resetModules()
    fixture.listener = undefined
    fixture.invalidate.mockClear()
    vi.stubGlobal('document', { location: { origin: 'https://example.com' } })
  })

  afterEach(() => vi.unstubAllGlobals())

  it('invalidates the sole document-local drain only for a content-free state-changed hint', async () => {
    await import('./Client')

    // Any other message is inert: no drain invalidation.
    expect(fixture.listener!({ type: 'runtime:sessions-rebind' })).toBeUndefined()
    expect(fixture.listener!({ type: 'unrelated' })).toBeUndefined()
    expect(fixture.listener!(null)).toBeUndefined()
    expect(fixture.invalidate).not.toHaveBeenCalled()

    // The content-free hint marks the drain dirty and starts or joins it.
    fixture.listener!({ type: 'runtime:state-changed' })
    expect(fixture.invalidate).toHaveBeenCalledOnce()
  })
})
