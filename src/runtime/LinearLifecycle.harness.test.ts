/**
 * task #1539 Phase B — generated lifecycle harness proofs.
 *
 * - The four named minimal counterexamples are the final Inspector failure classes (PR #154
 *   report, attachment 700de0fa). Each asserts the CORRECT model behavior, so it is stably RED
 *   on the accepted baseline `c48316f0` and must turn GREEN on the Phase C candidate.
 * - The harness self-tests (validity, determinism, shrinker, mutation detection) must pass now.
 * - The seeded property sweep runs the full oracle set over generated schedules.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { vi } from 'vitest'
import { getChatRoomId } from '@/runtime/Server'
import {
  ALL_ORACLES,
  HARNESS_DOMAIN,
  HARNESS_SITE,
  generateSchedule,
  harnessUser,
  oracleHarnessValidity,
  oracleNoStalePresenceEffect,
  oracleNoticeNeverRewritesTerminal,
  oracleReadyAfterWorldAttach,
  oracleSingleTerminalOwner,
  runSchedule,
  shrinkSchedule,
  type RunResult,
  type Schedule,
  type SchedulerDriver
} from '@/runtime/LinearLifecycle.harness'

const driver: SchedulerDriver = {
  advanceTime: async (ms) => {
    await vi.advanceTimersByTimeAsync(ms)
  },
  flush: async () => {
    await vi.advanceTimersByTimeAsync(0)
  }
}

const allViolations = (result: RunResult) =>
  Object.entries(ALL_ORACLES).flatMap(([name, oracle]) => oracle(result).map((violation) => `${name}: ${violation}`))

const report = (result: RunResult) =>
  ['trace:', ...result.log.trace(), 'results:', JSON.stringify(result.results)].join('\n')

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

/**
 * Class 1 (P1): a suspended B1 `presenceStore.load` resumes after B1 was replaced by same-tuple
 * B2 and B2 restored the domain; the old continuation must perform zero save/hydrate.
 *
 * Schedule: B1 join holds in load → B1 binding retired by same-tuple B2 attach → B2 join runs to
 * completion → B1's held load is released.
 */
const class1Schedule: Schedule = {
  seed: 101,
  pageCount: 1,
  calls: [
    { page: 0, op: 'join' },
    { page: 0, op: 'join' }
  ],
  steps: [
    { kind: 'init-page', page: 0 },
    { kind: 'start-call', call: 0 },
    // B1's join is now suspended in presence.load (gate 0).
    { kind: 'init-page', page: 0 }, // same-tuple B2 retires B1's binding object
    { kind: 'start-call', call: 1 },
    // Drain B2 (call 1) to full success while B1's load (oldest pending gate) stays held.
    { kind: 'release-gate', pick: 1 }, // B2 load (gate 1); gate 0 = B1 load stays
    { kind: 'release-gate', pick: 1 }, // B2 save
    { kind: 'release-gate', pick: 1 }, // B2 chat-room transport join
    { kind: 'release-gate', pick: 1 }, // B2 world-room transport join
    // Now release the stale B1 continuation.
    { kind: 'release-gate', pick: 0 }, // B1 load resumes after invalidation
    { kind: 'release-gate', pick: 0 } // B1 save gate (if the implementation performs it)
  ]
}

/**
 * Class 2 (P1): after the Server RPC is issued, the Page-local 10s timer/AbortController must not
 * publish a competing terminal. B1 join holds in load past the Page attempt deadline; the Page
 * fails the attempt, then the Server continuation completes the join successfully.
 */
/**
 * Class 2 (P1): after the Server RPC is issued, the Page-local 10s timer/AbortController must not
 * publish a competing terminal. The join is held in presence load/save just long enough (4s + 4s,
 * under the 5s bounded-store deadline each) that the Page attempt timer fires at t=10s while the
 * Connection physical-join timeout (armed only at StartPreparedAttempt, ~t=8s) has not. The Page
 * publishes 'failed'; the issued Server action then commits successfully — a second owner.
 */
const class2Schedule: Schedule = {
  seed: 102,
  pageCount: 1,
  calls: [{ page: 0, op: 'join' }],
  steps: [
    { kind: 'init-page', page: 0 },
    { kind: 'start-call', call: 0 },
    { kind: 'advance', ms: 4000 },
    { kind: 'release-gate', pick: 0 }, // presence.load (4s < 5s bounded deadline)
    { kind: 'advance', ms: 4000 },
    { kind: 'release-gate', pick: 0 }, // presence.save (t=8s)
    { kind: 'advance', ms: 2000 }, // t=10s: Page attempt timer fires; Connection join timer due ~t=18s
    { kind: 'release-gate', pick: 0 }, // chat-room transport join
    { kind: 'release-gate', pick: 0 } // world-room transport join
  ]
}

/**
 * Class 3 (P1): ready may be published only after the exact World attach settled. Any
 * `ready.publish` with `worldAttachSettled=false` is a violation.
 */
const class3Schedule: Schedule = {
  seed: 103,
  pageCount: 1,
  calls: [],
  steps: [{ kind: 'init-page', page: 0 }]
}

describe('Linear lifecycle generated harness — final Inspector failure classes (RED on baseline)', () => {
  it('class 1: an invalidated binding continuation performs zero save/hydrate after replacement', async () => {
    const result = await runSchedule(class1Schedule, driver)
    expect(oracleHarnessValidity(result), report(result)).toEqual([])
    expect(result.results[0].settled, report(result)).not.toBe('unsettled')
    expect(result.results[1].settled, report(result)).toBe('success')
    // The model requirement: no durable presence effect from the stale B1 stack.
    expect(oracleNoStalePresenceEffect(result), report(result)).toEqual([])
  })

  it('class 2: a Page timer cannot publish a competing terminal for an issued Server action', async () => {
    const result = await runSchedule(class2Schedule, driver)
    expect(oracleHarnessValidity(result), report(result)).toEqual([])
    const violations = oracleSingleTerminalOwner(result)
    // A Page 'failed' terminal while the Server action later commits success is the defect.
    const postTerminalCommit = result.log.entries.some(
      (entry) =>
        entry.kind === 'transport.join.settle' &&
        entry.detail.roomId === getChatRoomId(HARNESS_DOMAIN) &&
        result.log.entries.some(
          (terminal) =>
            terminal.kind === 'page.terminal' && terminal.detail.result === 'failed' && terminal.seq < entry.seq
        )
    )
    expect(
      [...violations, ...(postTerminalCommit ? ['physical commit after Page terminal'] : [])],
      report(result)
    ).toEqual([])
  })

  it('class 3: ready is published only after the exact World attach settled', async () => {
    const result = await runSchedule(class3Schedule, driver)
    expect(oracleHarnessValidity(result), report(result)).toEqual([])
    expect(oracleReadyAfterWorldAttach(result), report(result)).toEqual([])
  })

  it('mutation 3: reconnect reset is fenced by a synchronously consumed K, then commits', async () => {
    // join -> reconnect: both must succeed in order. Under the late-k-consume mutation the reset
    // loses the K fence and the reconnect fails instead of committing.
    const schedule: Schedule = {
      seed: 107,
      pageCount: 1,
      calls: [
        { page: 0, op: 'join' },
        { page: 0, op: 'reconnect' }
      ],
      steps: [
        { kind: 'init-page', page: 0 },
        { kind: 'start-call', call: 0 },
        { kind: 'release-gate', pick: 0 }, // join presence.load
        { kind: 'release-gate', pick: 0 }, // join presence.save
        { kind: 'release-gate', pick: 0 }, // join chat transport join
        { kind: 'release-gate', pick: 0 }, // join world transport join
        { kind: 'start-call', call: 1 }, // reconnect (reset -> replacement join)
        { kind: 'release-gate', pick: 0 }, // reset presence save
        { kind: 'release-gate', pick: 0 }, // replacement chat transport join
        { kind: 'release-gate', pick: 0 } // replacement world transport join
      ]
    }
    const result = await runSchedule(schedule, driver)
    expect(oracleHarnessValidity(result), report(result)).toEqual([])
    expect(result.results[0].settled, report(result)).toBe('success')
    expect(result.results[1].settled, report(result)).toBe('success')
  })

  it('mutation 4/8: release cleanup waits for the exact pending reconnect Q terminal', async () => {
    // join -> reconnect held at its replacement physical join (q4) -> tab release completes the
    // domain release -> a same-tuple successor joins. The successor may begin durable acquisition
    // only after the pending reconnect Q reached its exact Wire terminal.
    const schedule: Schedule = {
      seed: 108,
      pageCount: 1,
      calls: [
        { page: 0, op: 'join' },
        { page: 0, op: 'reconnect' },
        { page: 0, op: 'join' }
      ],
      steps: [
        { kind: 'init-page', page: 0 },
        { kind: 'start-call', call: 0 },
        { kind: 'release-gate', pick: 0 }, // join load
        { kind: 'release-gate', pick: 0 }, // join save
        { kind: 'release-gate', pick: 0 }, // join chat q1
        { kind: 'release-gate', pick: 0 }, // join world q2
        { kind: 'start-call', call: 1 }, // reconnect: world refresh q3 + reset clear-save gated
        { kind: 'release-gate', pick: 1 }, // reset clear-save -> replacement q4(chat)/q5(world) issued
        { kind: 'release-gate', pick: 0 }, // q3 world refresh join
        { kind: 'release-gate', pick: 1 }, // q5 world replacement join; q4 (chat) stays held
        { kind: 'release-tab', page: 0 }, // browser release -> grace -> domain release chain
        { kind: 'advance', ms: 5000 }, // grace expires; release chain reaches its gated clear-save
        { kind: 'init-page', page: 0 }, // same-tuple B2 re-registers
        { kind: 'start-call', call: 2 }, // successor joins; must wait for release + q4 terminal
        { kind: 'release-gate', pick: 1 } // release chain clear-save completes the release
      ]
    }
    const result = await runSchedule(schedule, driver)
    expect(oracleHarnessValidity(result), report(result)).toEqual([])
    // The pending reconnect chat Q (the 4th join issuance: q1/q2 initial, q3 world refresh, q4)
    // is the last unsettled join before the release; find its terminal.
    const joinSettles = result.log.entries.filter((entry) => entry.kind === 'transport.join.settle')
    const q4Settle = joinSettles[3]
    expect(q4Settle, report(result)).toBeDefined()
    const successorLoad = result.log.entries.find(
      (entry) => entry.kind === 'presence.load.start' && entry.detail.a === 2
    )
    expect(successorLoad, report(result)).toBeDefined()
    expect(
      successorLoad!.seq > q4Settle.seq,
      `successor durable acquisition must begin only after the pending reconnect Q terminal\n${report(result)}`
    ).toBe(true)
  })

  it('mutation 5: post-effect binding revalidation cannot rewrite a committed join success', async () => {
    // The join commits; an invalidation lands exactly inside the post-commit window. The caller
    // must still receive the committed success terminal — never a synthetic stale-binding failure.
    const schedule: Schedule = {
      seed: 109,
      pageCount: 1,
      calls: [{ page: 0, op: 'join' }],
      steps: [
        { kind: 'init-page', page: 0 },
        { kind: 'start-call', call: 0 },
        { kind: 'release-gate', pick: 0 }, // load
        { kind: 'release-gate', pick: 0 }, // save
        { kind: 'release-gate', pick: 0 }, // chat transport join
        { kind: 'arm-tabs-gate' }, // the next admission check (any post-commit revalidation) pends
        { kind: 'release-gate', pick: 0 }, // world transport join -> Server commit succeeds
        { kind: 'navigate', page: 0 }, // exact binding invalidated inside the post-commit window
        { kind: 'release-gate', pick: 0 } // release the held admission check
      ]
    }
    const result = await runSchedule(schedule, driver)
    expect(oracleHarnessValidity(result), report(result)).toEqual([])
    const joinCommit = result.log.entries.find(
      (entry) =>
        entry.kind === 'transport.join.settle' &&
        entry.detail.result === 'success' &&
        typeof entry.detail.roomId === 'string'
    )
    expect(joinCommit, report(result)).toBeDefined()
    expect(result.results[0].settled, report(result)).toBe('success')
    expect(result.results[0].pageTerminal, report(result)).toBe('succeeded')
  })

  it('mutation 6: auxiliary self-notice failure never rewrites a committed Server join terminal', async () => {
    const schedule: Schedule = {
      seed: 106,
      pageCount: 1,
      calls: [{ page: 0, op: 'join' }],
      steps: [
        { kind: 'init-page', page: 0 },
        { kind: 'start-call', call: 0 },
        { kind: 'arm-insert-failure', page: 0 },
        { kind: 'release-gate', pick: 0 }, // presence.load
        { kind: 'release-gate', pick: 0 }, // presence.save
        { kind: 'release-gate', pick: 0 }, // chat-room transport join
        { kind: 'release-gate', pick: 0 } // world-room transport join
      ]
    }
    const result = await runSchedule(schedule, driver)
    expect(oracleHarnessValidity(result), report(result)).toEqual([])
    expect(oracleNoticeNeverRewritesTerminal(result), report(result)).toEqual([])
  })
})

describe('Linear lifecycle generated harness — self validity (must pass on baseline)', () => {
  it('executes generated schedules deterministically: identical seed, identical trace', async () => {
    const first = await runSchedule(generateSchedule(7), driver)
    const second = await runSchedule(generateSchedule(7), driver)
    expect(second.log.trace()).toEqual(first.log.trace())
    expect(second.results).toEqual(first.results)
  })

  it('generates distinguishable multi-Page schedules with real per-Page identity traces', async () => {
    const traces = new Set<string>()
    for (let seed = 1; seed <= 8; seed += 1) {
      const result = await runSchedule(generateSchedule(seed), driver)
      traces.add(result.log.trace().join('\n'))
    }
    // Generation is genuine: distinct seeds explore distinct schedules.
    expect(traces.size).toBeGreaterThan(1)
  })

  it('rejects a structurally invalid count-only schedule instead of executing it', async () => {
    const invalid: Schedule = {
      seed: 999,
      pageCount: 1,
      calls: [],
      // No call exists at index 0: starting it is causally impossible and must be rejected.
      steps: [{ kind: 'start-call', call: 0 }]
    }
    const result = await runSchedule(invalid, driver)
    expect(oracleHarnessValidity(result).length).toBeGreaterThan(0)
    expect(result.invalidSteps).toEqual([{ kind: 'start-call', call: 0 }])
  })

  it('shrinks a failing schedule to a minimal counterexample that still reproduces', async () => {
    // The shrinker is exercised against a schedule whose failure is guaranteed by a forced gate
    // failure (independent of any model defect): the join must error.
    const predicate = (result: RunResult) => result.results.some((call) => call.settled === 'error')
    const fat: Schedule = {
      seed: 104,
      pageCount: 1,
      calls: [{ page: 0, op: 'join' }],
      steps: [
        { kind: 'advance', ms: 1000 },
        { kind: 'init-page', page: 0 },
        { kind: 'advance', ms: 1000 },
        { kind: 'start-call', call: 0 },
        { kind: 'fail-gate', pick: 0 },
        { kind: 'advance', ms: 5000 }
      ]
    }
    const { schedule, result } = await shrinkSchedule(fat, predicate, driver)
    expect(predicate(result)).toBe(true)
    // Every removable element is removed. The minimal residue is deterministic: the 5s advance
    // alone trips the bounded presence-store deadline, which already errors the join.
    expect(schedule.steps).toEqual([
      { kind: 'init-page', page: 0 },
      { kind: 'start-call', call: 0 },
      { kind: 'advance', ms: 5000 }
    ])
  })
})

describe('Linear lifecycle generated harness — seeded property sweep', () => {
  // The full oracle set over generated 1-3 Page x 1-3 call partial orders. On the accepted
  // baseline this sweep is expected RED at classes 1-3; the Phase C candidate must make it green
  // without touching the harness oracles.
  it('25 seeded schedules satisfy every model oracle', async () => {
    const failures: string[] = []
    for (let seed = 1; seed <= 25; seed += 1) {
      const result = await runSchedule(generateSchedule(seed), driver)
      const violations = allViolations(result)
      if (violations.length > 0) {
        failures.push(`seed=${seed}:\n${violations.join('\n')}\ntrace:\n${result.log.trace().join('\n')}`)
      }
    }
    expect(failures).toEqual([])
  }, 120_000)
})

// Referenced to keep the named users/sites part of the harness contract surface.
void harnessUser
void HARNESS_SITE
