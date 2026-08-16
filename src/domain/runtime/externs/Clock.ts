import { Remesh } from 'remesh'
import { sleep as defaultSleep } from '@/utils/sleep'

/** Injected wall-clock authority; tests may replace sleep without changing production timer ownership. */
export interface Clock {
  now: () => number
  sleep?: (ms: number) => Promise<void>
}

export const sleep = (clock: Clock, ms: number): Promise<void> => clock.sleep?.(ms) ?? defaultSleep(ms)

export const ClockExtern = Remesh.extern<Clock>({
  default: {
    now: () => Date.now()
  }
})
