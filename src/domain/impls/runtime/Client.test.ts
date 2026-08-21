import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({
  listener: undefined as ((message: unknown) => unknown) | undefined,
  rebind: vi.fn(async (rebindId: string) => ({ rebindId })),
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
    bindingId = () => 'binding-a'
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

  it('re-executes the current Page registration only for its exact Background rebind target and token', async () => {
    await import('./Client')

    expect(
      fixture.listener!({ type: 'runtime:sessions-rebind', pageId: 'other-page', rebindId: 'rebind-a' })
    ).toBeUndefined()
    expect(fixture.listener!({ type: 'runtime:sessions-rebind', pageId: 'page-a' })).toBeUndefined()
    expect(fixture.rebind).not.toHaveBeenCalled()

    await expect(
      fixture.listener?.({ type: 'runtime:sessions-rebind', pageId: 'page-a', rebindId: 'rebind-a' })
    ).resolves.toEqual({
      rebindId: 'rebind-a'
    })
    expect(fixture.rebind).toHaveBeenCalledExactlyOnceWith('rebind-a')
  })

  it('attaches the current private binding identity to Page-originated Runtime calls', async () => {
    const attachPage = vi.fn(async () => undefined)
    fixture.proxy.attachPage = attachPage
    const { server } = await import('./Client')

    await server.attachPage({ domain: 'https://example.com', pageId: 'ignored' })

    expect(attachPage).toHaveBeenCalledExactlyOnceWith({
      domain: 'https://example.com',
      pageId: 'page-a',
      runtimeHostId: 'host-a',
      bindingId: 'binding-a'
    })
  })
})
