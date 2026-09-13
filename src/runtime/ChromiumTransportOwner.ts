export interface ChromiumTransportStatus {
  phase: 'ready' | 'unavailable'
  created: boolean
}

interface RebindableTransport {
  // oxlint-disable-next-line anti-slop/no-unknown-returns -- the rebind settlement value is ignored
  rebind: (signal?: AbortSignal) => Promise<unknown>
}

/** Owns one Chromium transport facade and the single-flight admission that makes it usable. */
export class ChromiumTransportOwner<Transport extends RebindableTransport> {
  private transport: Transport | null = null
  private pending: Promise<Transport> | null = null
  private requiresRebind = true
  private generation = 0
  private cancelPending: (() => void) | null = null

  constructor(
    private readonly ensureDocument: () => Promise<ChromiumTransportStatus>,
    private readonly createTransport: () => Transport
  ) {}

  ensure(refresh = false) {
    if (this.pending && !refresh) return this.pending
    if (this.pending) this.requiresRebind = true
    this.cancelPending?.()
    const generation = ++this.generation
    const assertCurrent = () => {
      if (generation !== this.generation) throw new DOMException('Transport recovery superseded', 'AbortError')
    }

    const controller = new AbortController()
    const cancelled = new Promise<Transport>((_resolve, reject) => {
      this.cancelPending = () => {
        const reason = new DOMException('Transport recovery superseded', 'AbortError')
        controller.abort(reason)
        reject(reason)
      }
    })
    const task = Promise.race([
      cancelled,
      (async () => {
        try {
          const document = await this.ensureDocument()
          assertCurrent()
          if (document.phase !== 'ready') throw new Error('Chromium Offscreen transport is unavailable')
          const candidate = this.transport ?? this.createTransport()
          this.transport = candidate
          if (this.requiresRebind || document.created) {
            this.requiresRebind = true
            await candidate.rebind(controller.signal)
            assertCurrent()
            this.requiresRebind = false
          }
          return candidate
        } catch (error) {
          // A surviving Background already gave this facade to its Server. Keep that identity
          // stable and retry only its callback alignment on the next ingress.
          if (generation === this.generation) this.requiresRebind = true
          throw error
        }
      })()
    ])
    this.pending = task
    void task.then(
      () => {
        if (this.pending === task) {
          this.pending = null
          this.cancelPending = null
        }
      },
      () => {
        if (this.pending === task) {
          this.pending = null
          this.cancelPending = null
        }
      }
    )
    return task
  }
}
