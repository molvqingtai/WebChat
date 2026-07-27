import { Remesh } from 'remesh'

/** Injected wall-clock authority; timer scheduling remains owned by globalThis and Vitest fake timers. */
export interface Clock {
  now: () => number
}

export const ClockExtern = Remesh.extern<Clock>({
  default: {
    now: () => Date.now()
  }
})
