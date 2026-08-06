import { Remesh } from 'remesh'

export interface ConnectionLifecycle {
  /**
   * A monotonic lifecycle epoch maintained at the Runtime boundary. It advances whenever the Runtime
   * supersedes or releases a connection attempt (host generation replace, attempt supersession, or a
   * cancellation reaching the Runtime). The domain reads whether an epoch it captured is still current
   * to classify a completion as a structural cancellation; it never inspects a thrown error's content.
   */
  getEpoch: () => number
  onEpochChange: (callback: (epoch: number) => void) => () => void
}

export const ConnectionLifecycleExtern = Remesh.extern<ConnectionLifecycle>({
  default: {
    getEpoch: () => 0,
    onEpochChange: () => () => {}
  }
})
