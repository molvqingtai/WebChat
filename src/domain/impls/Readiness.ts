import { ReadinessExtern, type ReadinessState } from '@/domain/externs/Readiness'
import type { HostPhase } from '@/runtime/Contract'

const readinessState = (phase: HostPhase): ReadinessState => {
  if (phase === 'ready' || phase === 'unavailable') return phase
  return 'connecting'
}

export const createReadinessImpl = (
  onHostPhase: (callback: (phase: HostPhase, terminalError?: string) => void) => () => void
) =>
  ReadinessExtern.impl({
    onState: (callback) => onHostPhase((phase, terminalError) => callback(readinessState(phase), terminalError))
  })
