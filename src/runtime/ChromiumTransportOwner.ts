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

  constructor(
    private readonly ensureDocument: () => Promise<ChromiumTransportStatus>,
    private readonly createTransport: () => Transport
  ) {}

  ensure() {
    if (this.pending) return this.pending

    const task = (async () => {
      let candidate: Transport | null = null
      try {
        const document = await this.ensureDocument()
        if (document.phase !== 'ready') throw new Error('Chromium Offscreen transport is unavailable')
        candidate = this.transport ?? this.createTransport()
        const needsRebind = candidate !== this.transport || document.created
        this.transport = candidate
        if (needsRebind) await candidate.rebind()
        return candidate
      } catch (error) {
        if (candidate && this.transport === candidate) this.transport = null
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
