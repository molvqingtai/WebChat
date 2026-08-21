export interface ChromiumTransportStatus {
  phase: 'ready' | 'unavailable'
  created: boolean
}

interface RebindableTransport {
  rebind: () => Promise<unknown>
}

/** Owns one Chromium transport facade and the single-flight admission that makes it usable. */
export class ChromiumTransportOwner<Transport extends RebindableTransport> {
  private transport: Transport | null = null
  private pending: Promise<Transport> | null = null
  private requiresRebind = true

  constructor(
    private readonly ensureDocument: () => Promise<ChromiumTransportStatus>,
    private readonly createTransport: () => Transport
  ) {}

  ensure() {
    if (this.pending) return this.pending

    const task = (async () => {
      try {
        const document = await this.ensureDocument()
        if (document.phase !== 'ready') throw new Error('Chromium Offscreen transport is unavailable')
        const candidate = this.transport ?? this.createTransport()
        this.transport = candidate
        if (this.requiresRebind || document.created) {
          this.requiresRebind = true
          await candidate.rebind()
          this.requiresRebind = false
        }
        return candidate
      } catch (error) {
        // A surviving Background already gave this facade to its Server. Keep that identity
        // stable and retry only its callback alignment on the next ingress.
        this.requiresRebind = true
        throw error
      }
    })()
    this.pending = task
    void task.then(
      () => {
        if (this.pending === task) this.pending = null
      },
      () => {
        if (this.pending === task) this.pending = null
      }
    )
    return task
  }
}
