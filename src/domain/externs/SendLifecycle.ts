import { Remesh } from 'remesh'

/** The exact per-send outcome of one text/reaction send invocation. */
export type SendResult = 'active' | 'accepted' | 'cancelled' | 'failed'

/**
 * A per-send lifecycle channel. Each send invocation captures an exact token before it begins; only that
 * invocation settles its own token `active -> accepted | cancelled | failed`. Finalize cancels only still
 * `active` exact tokens; a provider throw fails only its own token. It never reflects global readiness or
 * any "current send", and text/reaction sends are one-to-one keyed by their token, not by FIFO/latest state.
 */
export interface SendLifecycle {
  beginSend: () => number
  getSendResult: (token: number) => SendResult
  settleSend: (token: number, result: SendResult) => void
  cancelActiveSends: () => void
}

export const SendLifecycleExtern = Remesh.extern<SendLifecycle>({
  default: {
    beginSend: () => {
      throw new Error('"SendLifecycleExtern.beginSend" not implemented.')
    },
    getSendResult: () => 'active',
    settleSend: () => {},
    cancelActiveSends: () => {}
  }
})
