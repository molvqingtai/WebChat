import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({
  listener: undefined as ((message: unknown) => unknown) | undefined,
  rebind: vi.fn(async () => {}),
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

vi.mock('nanoid', () => ({ nanoid: () => 'page-a' }))
vi.mock('@/service/adapter/runtime', () => ({
  InjectAdapter: class {},
  ownInjectRejections: () => {}
}))
vi.mock('@/runtime/ClientLease', () => ({
  ClientLease: class {
    runtimeHostId = () => 'host-a'
    whenReady = () => () => {}
    whenHostPhase = () => () => {}
    whenFailure = () => () => {}
    init = async () => null
    detach = () => {}
    snapshot = () => {
      throw new Error('not initialized')
    }
    observeTransportRejection = () => false
    rebind = fixture.rebind
  }
}))

describe('Page Runtime rebind ingress', () => {
  beforeEach(() => {
    vi.resetModules()
    fixture.listener = undefined
    fixture.rebind.mockClear()
    vi.stubGlobal('document', { location: { origin: 'https://example.com' } })
  })

  afterEach(() => vi.unstubAllGlobals())

  it('re-executes the current Page registration only for its exact Background rebind target', async () => {
    await import('./Client')

    expect(fixture.listener!({ type: 'runtime:sessions-rebind', pageId: 'other-page' })).toBeUndefined()
    expect(fixture.rebind).not.toHaveBeenCalled()

    await fixture.listener?.({ type: 'runtime:sessions-rebind', pageId: 'page-a' })
    expect(fixture.rebind).toHaveBeenCalledOnce()
  })
})
