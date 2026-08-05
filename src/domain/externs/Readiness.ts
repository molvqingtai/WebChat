import { Remesh } from 'remesh'

export type ReadinessState = 'connecting' | 'ready' | 'unavailable'

export interface Readiness {
  onState: (callback: (state: ReadinessState, terminalError?: string) => void) => () => void
}

export const ReadinessExtern = Remesh.extern<Readiness>({
  default: {
    onState: () => {
      throw new Error('"onState" not implemented.')
    }
  }
})
