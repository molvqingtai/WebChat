import { Remesh } from 'remesh'

export type ReadinessState = 'connecting' | 'ready' | 'unavailable'

export interface Readiness {
  onState: (callback: (state: ReadinessState) => void) => () => void
}

export const ReadinessExtern = Remesh.extern<Readiness>({
  default: {
    onState: () => {
      throw new Error('"onState" not implemented.')
    }
  }
})
