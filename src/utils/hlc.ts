/**
 * Hybrid Logical Clock (HLC) utilities
 *
 * HLC combines physical time with logical counters to provide:
 * - Causal ordering in distributed systems
 * - Tolerance to clock skew
 * - Timestamps close to physical time
 *
 * @see https://www.cse.buffalo.edu/tech-reports/2014-04.pdf
 */

export interface HLC {
  timestamp: number // Physical time in milliseconds
  counter: number // Logical counter for same timestamp
}

/**
 * Compare two HLCs
 * @returns negative if a < b, 0 if a == b, positive if a > b
 */
export const compareHLC = (a: HLC, b: HLC): number => {
  if (a.timestamp !== b.timestamp) {
    return a.timestamp - b.timestamp
  }
  return a.counter - b.counter
}

/**
 * Create initial HLC with epoch time
 */
export const createHLC = (): HLC => {
  return { timestamp: 0, counter: 0 }
}

/**
 * Update local HLC for a send event
 *
 * Rules:
 * - If physical time advanced: use new time, reset counter
 * - If physical time unchanged: increment counter
 */
export const sendEvent = (localHLC: HLC): HLC => {
  const now = Date.now()

  if (now > localHLC.timestamp) {
    // Physical clock advanced, reset counter
    return { timestamp: now, counter: 0 }
  } else {
    // Physical clock unchanged, increment counter
    return { timestamp: localHLC.timestamp, counter: localHLC.counter + 1 }
  }
}

/**
 * Update local HLC for a receive event
 *
 * Rules:
 * - Take max of (local time, local HLC, remote HLC)
 * - If max timestamp appears in HLCs, increment counter
 * - Otherwise reset counter
 */
export const receiveEvent = (localHLC: HLC, remoteHLC: HLC): HLC => {
  const now = Date.now()
  const maxTimestamp = Math.max(now, localHLC.timestamp, remoteHLC.timestamp)

  if (maxTimestamp === now && now > localHLC.timestamp && now > remoteHLC.timestamp) {
    // Local physical time is newest
    return { timestamp: now, counter: 0 }
  }

  // Find max counter among HLCs with max timestamp
  let maxCounter = 0
  if (maxTimestamp === localHLC.timestamp) {
    maxCounter = Math.max(maxCounter, localHLC.counter)
  }
  if (maxTimestamp === remoteHLC.timestamp) {
    maxCounter = Math.max(maxCounter, remoteHLC.counter)
  }

  return { timestamp: maxTimestamp, counter: maxCounter + 1 }
}

/**
 * Check if HLC is within a time window
 */
export const isWithinTimeWindow = (hlc: HLC, windowMs: number): boolean => {
  return hlc.timestamp >= Date.now() - windowMs
}

/**
 * Format HLC as readable string for debugging
 */
export const formatHLC = (hlc: HLC): string => {
  return `${new Date(hlc.timestamp).toISOString()}:${hlc.counter}`
}

/**
 * Check if HLC is valid (non-negative values)
 */
export const isValidHLC = (hlc: HLC): boolean => {
  return hlc.timestamp >= 0 && hlc.counter >= 0 && Number.isInteger(hlc.counter)
}

/**
 * Clone HLC (defensive copy)
 */
export const cloneHLC = (hlc: HLC): HLC => {
  return { timestamp: hlc.timestamp, counter: hlc.counter }
}
