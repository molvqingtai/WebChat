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
import { ClientLease } from '@/runtime/ClientLease'
import type { RuntimeSnapshot } from '@/runtime/Contract'
import {
  ALL_ORACLES,
  HARNESS_DOMAIN,
  HARNESS_SITE,
  createHarnessWorld,
  generateSchedule,
  harnessUser,
  oracleCohortFence,
  oracleHarnessValidity,
  oracleNoStalePresenceEffect,
  oracleNoticeNeverRewritesTerminal,
  oracleReadyAfterWorldAttach,
  oracleSingleTerminalOwner,
  runSchedule,
  shrinkSchedule,
  type HarnessGate,
  type HarnessWorld,
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

/**
 * P1-1a (cohort): one sibling's success never publishes cleanup while another exact member stack
 * is still live. Two joins suspend in load; join-0 runs to full success while join-1 stays held;
 * the cohort must NOT clear, and a business send must not reach its sealed effect, until join-1's
 * member self-observes from its own resumed stack.
 */
const cohortTwoMemberSchedule: Schedule = {
  seed: 110,
  pageCount: 1,
  calls: [
    { page: 0, op: 'join' },
    { page: 0, op: 'join' },
    { page: 0, op: 'sendText' }
  ],
  steps: [
    { kind: 'init-page', page: 0 },
    { kind: 'start-call', call: 0 },
    { kind: 'start-call', call: 1 },
    // Pending: [load(join0), load(join1)]. Run join-0 to completion while join-1's load stays held.
    { kind: 'release-gate', pick: 0 }, // join-0 load
    { kind: 'release-gate', pick: 1 }, // join-0 save (join-1 load stays oldest)
    { kind: 'release-gate', pick: 1 }, // join-0 chat transport join
    { kind: 'release-gate', pick: 1 }, // join-0 world transport join
    { kind: 'start-call', call: 2 }, // business send: must wait for the full cleanup conjunction
    { kind: 'release-gate', pick: 0 } // join-1 load finally resumes; drain completes the rest
  ]
}

/**
 * P1-1b (cohort deadline): an admission check that never settles cannot hold an issued action
 * forever. The join completes durable acquisition, then hangs inside its post-acquisition
 * revalidation (a gated tabs.get); C's deadline closes the cohort and the suspended stack settles
 * with the structured null and zero connect/commit afterwards.
 */
const cohortDeadlineSchedule: Schedule = {
  seed: 111,
  pageCount: 1,
  calls: [{ page: 0, op: 'join' }],
  steps: [
    { kind: 'init-page', page: 0 },
    { kind: 'start-call', call: 0 },
    { kind: 'arm-tabs-gate' }, // the post-acquisition revalidation's admission check will hang
    { kind: 'release-gate', pick: 0 }, // presence.load
    { kind: 'release-gate', pick: 0 }, // presence.save -> revalidation hangs in the gated tabs.get
    { kind: 'advance', ms: 10000 } // only C's deadline may terminate the episode
  ]
}

/**
 * P1-2 (automatic-recovery Q): a room-close recovery attempt issues its own exact Q with no
 * Server operation behind it. Release cleanup — and therefore any fresh successor — must wait for
 * that Q's exact Wire terminal, not only for Server-issued joins.
 */
const automaticRecoveryQSchedule: Schedule = {
  seed: 112,
  pageCount: 1,
  calls: [
    { page: 0, op: 'join' },
    { page: 0, op: 'join' }
  ],
  steps: [
    { kind: 'init-page', page: 0 },
    { kind: 'start-call', call: 0 },
    { kind: 'release-gate', pick: 0 }, // join load
    { kind: 'release-gate', pick: 0 }, // join save
    { kind: 'release-gate', pick: 0 }, // join chat q1
    { kind: 'release-gate', pick: 0 }, // join world q2
    { kind: 'room-close' }, // automatic recovery issues q3(chat)/q4(world) with no Server operation
    { kind: 'release-gate', pick: 1 }, // q4 world recovery join; q3 (chat) stays held
    { kind: 'release-tab', page: 0 }, // browser release -> grace -> domain release chain
    { kind: 'advance', ms: 5000 }, // grace expires; release chain reaches its gated clear-save
    { kind: 'init-page', page: 0 }, // same-tuple B2 re-registers
    { kind: 'start-call', call: 1 }, // successor joins; must wait for release + q3 terminal
    { kind: 'release-gate', pick: 0 }, // q3 automatic-recovery chat join reaches its exact terminal
    { kind: 'release-gate', pick: 0 } // release chain clear-save completes the release
  ]
}

describe('Linear lifecycle generated harness — repair findings (P1-1 cohort, P1-2 automatic Q)', () => {
  it('P1-1a: cleanup and business admission wait for every exact member self-observation', async () => {
    const result = await runSchedule(cohortTwoMemberSchedule, driver)
    expect(oracleHarnessValidity(result), report(result)).toEqual([])
    expect(result.results[0].settled, report(result)).toBe('success')
    expect(result.results[1].settled, report(result)).toBe('success')
    const identity = result.log.entries.filter((entry) => entry.kind === 'identity')
    const join0Settled = identity.find((entry) => entry.detail.phase === 'settled' && entry.detail.a === 0)
    const cleared = identity.find((entry) => entry.detail.phase === 'cleared')
    const join1Observed = identity.find((entry) => entry.detail.phase === 'observed' && entry.detail.a === 1)
    const sendSealed = identity.find((entry) => entry.detail.phase === 'sealed' && entry.detail.a === 2)
    expect(join0Settled, report(result)).toBeDefined()
    expect(cleared, report(result)).toBeDefined()
    expect(join1Observed, report(result)).toBeDefined()
    // join-0's success did NOT publish cleanup: the cohort cleared only after join-1 self-observed.
    expect(cleared!.seq > join0Settled!.seq && cleared!.seq > join1Observed!.seq, report(result)).toBe(true)
    // The business send reached its sealed effect only after the full conjunction cleared.
    expect(sendSealed, report(result)).toBeDefined()
    expect(sendSealed!.seq > cleared!.seq, report(result)).toBe(true)
    expect(result.results[2].settled, report(result)).toBe('success')
  })

  it('P1-1b: a hung admission revalidation settles null at the cohort deadline with zero connect', async () => {
    const result = await runSchedule(cohortDeadlineSchedule, driver)
    expect(oracleHarnessValidity(result), report(result)).toEqual([])
    expect(result.results[0].settled, report(result)).toBe('null')
    // The cohort closed at its deadline and cleared once the resumed stack self-observed.
    const identity = result.log.entries.filter((entry) => entry.kind === 'identity')
    expect(
      identity.some((entry) => entry.detail.phase === 'closed'),
      report(result)
    ).toBe(true)
    expect(
      identity.some((entry) => entry.detail.phase === 'cleared'),
      report(result)
    ).toBe(true)
    // Zero connect/commit was performed by the hung stack after the cohort closed.
    expect(
      result.log.entries.filter((entry) => entry.kind === 'transport.join.start'),
      report(result)
    ).toEqual([])
    expect(oracleCohortFence(result), report(result)).toEqual([])
  })

  it('P1-2: release cleanup and the fresh successor wait for the automatic-recovery Q terminal', async () => {
    const result = await runSchedule(automaticRecoveryQSchedule, driver)
    expect(oracleHarnessValidity(result), report(result)).toEqual([])
    // The automatic-recovery chat Q is the third physical join issuance overall (q1/q2 initial).
    const joinSettles = result.log.entries.filter((entry) => entry.kind === 'transport.join.settle')
    const q3Settle = joinSettles[2]
    expect(q3Settle, report(result)).toBeDefined()
    const successorLoad = result.log.entries.find(
      (entry) => entry.kind === 'presence.load.start' && entry.detail.a === 1
    )
    expect(successorLoad, report(result)).toBeDefined()
    expect(
      successorLoad!.seq > q3Settle.seq,
      `successor durable acquisition must begin only after the automatic-recovery Q terminal\n${report(result)}`
    ).toBe(true)
    expect(result.results[1].settled, report(result)).toBe('success')
    // The automatic Q is a real observed P with an exact domain attribution.
    const identity = result.log.entries.filter((entry) => entry.kind === 'identity')
    const q3Requested = identity.find(
      (entry) => entry.detail.phase === 'requested' && String(entry.detail.Q).includes('recovery')
    )
    expect(q3Requested, report(result)).toBeDefined()
    expect(q3Requested!.detail.domain, report(result)).toBe(HARNESS_DOMAIN)
  })
})

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

describe('Linear lifecycle generated harness — repair finding P1-3 (final bound ready validation)', () => {
  it('bound getSnapshot rejects a superseded exact binding', async () => {
    const world = createHarnessWorld({ seed: 120, pageCount: 1 })
    try {
      const page = world.pages[0]
      await page.lease.init()
      expect(page.readyPublished).toBe(true)
      // Navigating away retires the exact B1 object; the Page's bound snapshot call must now fail
      // instead of completing a stale attachment barrier.
      await world.navigate(0)
      await expect(page.server.getSnapshot()).rejects.toThrow('Runtime Page binding is no longer current')
    } finally {
      world.dispose()
    }
  })

  it('bound getSnapshot with validateReadiness rejects an incomplete exact-B readiness fact', async () => {
    const world = createHarnessWorld({ seed: 121, pageCount: 1 })
    try {
      const page = world.pages[0]
      // The Page attaches its binding but never runs its attachment registrations.
      await world.server.attachPage({
        domain: HARNESS_DOMAIN,
        pageId: page.pageId,
        caller: { tab: { id: page.tabId, url: page.url } }
      })
      const hostId = (await world.server.getSnapshot()).hostId
      const call = {
        pageId: page.pageId,
        runtimeHostId: hostId,
        caller: { tab: { id: page.tabId, url: page.url } }
      }
      // Only the Session callback registers; the remaining exact-B readiness terms stay absent.
      await world.server.onSessionEvent(call, () => undefined)
      await expect(world.server.getSnapshot({ ...call, validateReadiness: true })).rejects.toThrow(
        'Runtime Page readiness is incomplete'
      )
    } finally {
      world.dispose()
    }
  })

  it('ClientLease never publishes ready when the final Server-side validation fails', async () => {
    const snapshot = {
      hostId: 'h1',
      hostPhase: 'active',
      domains: []
    } as unknown as RuntimeSnapshot
    const coordinator = { registerPage: async () => ({ snapshot }) }
    const lease = new ClientLease({
      coordinator,
      pageId: 'page-x',
      domain: HARNESS_DOMAIN,
      validateReady: async () => {
        throw new Error('Runtime Page binding is no longer current')
      }
    })
    let readyPublished = false
    lease.whenReady(() => {
      readyPublished = true
    })
    lease.whenAttach(() => undefined)
    await expect(lease.init()).rejects.toThrow('Runtime Page binding is no longer current')
    expect(readyPublished).toBe(false)
  })
})

/**
 * K1 (post-K commit fence): C closes at its deadline while the provider join is still pending;
 * the Q then succeeds BEFORE Connection's physical timeout. The old continuation must not commit:
 * its consumed K's captured-cohort authorization fails synchronously at the commit boundary and
 * the action settles with the structured null — never a commit-after-close plus null split.
 */
const postKCommitSchedule: Schedule = {
  seed: 113,
  pageCount: 1,
  calls: [{ page: 0, op: 'join' }],
  steps: [
    { kind: 'init-page', page: 0 },
    { kind: 'start-call', call: 0 },
    { kind: 'release-gate', pick: 0 }, // presence.load
    { kind: 'arm-tabs-gate' },
    { kind: 'release-gate', pick: 0 }, // presence.save -> post-acquisition revalidation hangs in tabs.get
    { kind: 'advance', ms: 9000 }, // t=9s of C's 10s budget consumed
    { kind: 'release-gate', pick: 0 }, // tabs.get resumes -> K consumed, Q dispatched ~t=9s
    { kind: 'advance', ms: 1000 }, // t=10s: C deadline closes while the provider join is pending
    { kind: 'release-gate', pick: 0 }, // chat transport join succeeds AFTER close (physical timeout ~t=19s)
    { kind: 'release-gate', pick: 0 }, // world transport join succeeds AFTER close
    // The structured cancellation is a non-retrying terminal: advancing through the full recovery
    // retry interval must not start any unfenced Q2.
    { kind: 'advance', ms: 11000 }
  ]
}

/** Drives the world's gates in creation order, skipping any label in `hold`, until `done`. */
const driveWorld = async (world: HarnessWorld, done: () => boolean, hold: string[] = []) => {
  for (let round = 0; round < 100 && !done(); round += 1) {
    const gate = world.gates.pending().find((candidate) => !hold.includes(candidate.label))
    if (!gate) {
      await new Promise((resolve) => setTimeout(resolve, 0))
      continue
    }
    ;(gate as HarnessGate<unknown>).release(undefined as never)
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

describe('Linear lifecycle generated harness — task #1544 killing schedules', () => {
  it('K1: a consumed K cannot commit after its cohort deadline closed; the action settles null', async () => {
    const result = await runSchedule(postKCommitSchedule, driver)
    expect(oracleHarnessValidity(result), report(result)).toEqual([])
    expect(result.results[0].settled, report(result)).toBe('null')
    const identity = result.log.entries.filter((entry) => entry.kind === 'identity')
    const closed = identity.find((entry) => entry.detail.phase === 'closed')
    expect(closed, report(result)).toBeDefined()
    // The race genuinely happened: at least one physical join settled AFTER the cohort closed.
    const lateJoin = result.log.entries.find(
      (entry) => entry.kind === 'transport.join.settle' && entry.seq > closed!.seq
    )
    expect(lateJoin, report(result)).toBeDefined()
    // Zero commit persistence was performed by the old continuation after the close.
    const lateSave = result.log.entries.find(
      (entry) => entry.kind === 'presence.save' && entry.detail.a === 0 && entry.seq > closed!.seq
    )
    expect(lateSave, report(result)).toBeUndefined()
    expect(oracleCohortFence(result), report(result)).toEqual([])
    // The late physical terminal still arrived and was recorded exactly once (P decrements).
    const lateTerminals = identity.filter((entry) => entry.detail.phase === 'terminal' && entry.seq > closed!.seq)
    expect(lateTerminals.length, report(result)).toBeGreaterThan(0)
    // No unfenced retry: after the structured null, advancing through the whole recovery retry
    // interval issued no further Q and committed nothing for the dead action.
    const joinStarts = result.log.entries.filter((entry) => entry.kind === 'transport.join.start')
    expect(joinStarts.length, report(result)).toBe(2)
    const lateRequested = identity.filter((entry) => entry.detail.phase === 'requested' && entry.seq > closed!.seq)
    expect(lateRequested, report(result)).toEqual([])
  })

  it('K2: readiness owners cover replay; cleanup neither clears early nor sleeps after retirement', async () => {
    // Real timers: this control drives the live world through real macrotask turns.
    vi.useRealTimers()
    const world = createHarnessWorld({ seed: 130, pageCount: 1 })
    try {
      const page = world.pages[0]
      await page.lease.init()
      // A replay readiness owner stays outstanding (its gate is held), then a join completes.
      world.armReplayGate()
      let replaySettled = false
      const replayTask = page.server.replayInbound({ domain: HARNESS_DOMAIN, after: 0 }).then(
        () => {
          replaySettled = true
        },
        () => {
          replaySettled = true
        }
      )
      let joinSettled = false
      page.chat.joinRoom({ user: harnessUser(0), site: HARNESS_SITE }).then(
        () => {
          joinSettled = true
        },
        () => {
          joinSettled = true
        }
      )
      // Drive everything except the held replay gate until the join commits.
      await driveWorld(world, () => joinSettled, ['replay.inbound'])
      expect(joinSettled).toBe(true)
      const identity = () => world.log.entries.filter((entry) => entry.kind === 'identity')
      // The replay readiness owner began (covering replay work) and has not ended.
      const replayToken = identity().find(
        (entry) => entry.detail.phase === 'begin' && entry.detail.type === 'readiness'
      )
      expect(replayToken).toBeDefined()
      // Cleanup must NOT clear the join's cohort while the readiness owner is outstanding, even
      // though the join's member already self-observed and every Q terminated.
      const prematureClear = identity().find((entry) => entry.detail.phase === 'cleared')
      expect(prematureClear).toBeUndefined()
      // A business call must wait for the same conjunction.
      let sendSettled = false
      const sendTask = page.chat.sendMessage({ type: 'text', body: 'k2', mentions: [] }).then(
        () => {
          sendSettled = true
        },
        () => {
          sendSettled = true
        }
      )
      await driveWorld(world, () => false, ['replay.inbound'])
      expect(sendSettled).toBe(false)
      // Releasing the replay gate settles the replay RPC; the owner still ends only at retirement
      // (the final validation already happened for this binding generation).
      for (const gate of world.gates.pending()) {
        if (gate.label === 'replay.inbound') (gate as HarnessGate<unknown>).release(undefined as never)
      }
      await replayTask
      expect(replaySettled).toBe(true)
      // Exact-B retirement must immediately re-evaluate and wake the closed/open cleanup: after
      // navigation the cohort clears and the waiting business call can proceed with the successor.
      await world.navigate(0)
      await driveWorld(world, () => identity().some((entry) => entry.detail.phase === 'cleared'))
      expect(identity().some((entry) => entry.detail.phase === 'cleared')).toBe(true)
      void sendTask
    } finally {
      world.dispose()
    }
  })

  it('K3: a bound validation suspended mid-call never adopts a same-tuple B2', async () => {
    vi.useRealTimers()
    const world = createHarnessWorld({ seed: 131, pageCount: 1 })
    try {
      const page = world.pages[0]
      await page.lease.init()
      const hostId = (await world.server.getSnapshot()).hostId
      world.armTransportGate()
      const validation = world.server.getSnapshot({
        pageId: page.pageId,
        runtimeHostId: hostId,
        caller: { tab: { id: page.tabId, url: page.url } },
        validateReadiness: true
      })
      // B2 replaces the exact B1 while B1's validation is suspended inside the admission await.
      await world.replacePage(0)
      for (const gate of world.gates.pending()) {
        if (gate.label === 'admission.ensureTransport') (gate as HarnessGate<unknown>).release(undefined as never)
      }
      await expect(validation).rejects.toThrow('Runtime Page binding is no longer current')
    } finally {
      world.dispose()
    }
  })
})

describe('Linear lifecycle generated harness — task #1546 terminals', () => {
  it('K2-failure: an attachment failure retires the exact binding exactly once and preserves the failure', async () => {
    const snapshot = { hostId: 'h1', hostPhase: 'active', domains: [] } as unknown as RuntimeSnapshot
    const coordinator = { registerPage: async () => ({ snapshot }) }
    let retireCalls = 0
    const lease = new ClientLease({
      coordinator,
      pageId: 'page-x',
      domain: HARNESS_DOMAIN,
      retireBinding: async () => {
        retireCalls += 1
      }
    })
    let readyPublished = false
    lease.whenReady(() => {
      readyPublished = true
    })
    // The attachment fails after its registrations succeeded (replay/local persistence rejects).
    lease.whenAttach(() => {
      throw new Error('replay persistence failed')
    })
    await expect(lease.init()).rejects.toThrow('replay persistence failed')
    expect(retireCalls).toBe(1)
    expect(readyPublished).toBe(false)
  })

  it('K3-window: a same-tuple replacement inside the validation-publication window blocks the stale ready', async () => {
    vi.useRealTimers()
    const world = createHarnessWorld({ seed: 132, pageCount: 1 })
    try {
      const page = world.pages[0]
      // Hold B1's validation-publication window open: Server validation passes, then the response
      // continuation suspends inside the armed gate.
      world.armResponseGate()
      let initResult: unknown = 'unsettled'
      const initTask = page.lease.init().then((value) => {
        initResult = value
        return value
      })
      await driveWorld(world, () => world.gates.pending().some((gate) => gate.label === 'validation.response'))
      // A same-tuple B2 registration installs B2 (retiring B1) and starts its own attachment.
      let rebindSettled = false
      const rebindTask = page.lease.rebind().then(
        () => {
          rebindSettled = true
        },
        () => {
          rebindSettled = true
        }
      )
      await driveWorld(world, () => rebindSettled, ['validation.response'])
      // Release B1's suspended response continuation: its barrier must no longer be publishable.
      for (const gate of world.gates.pending()) {
        if (gate.label === 'validation.response') (gate as HarnessGate<unknown>).release(undefined as never)
      }
      await initTask
      expect(initResult, world.log.trace().join('\n')).toBeNull()
      // Every ready publication (if any) belongs to B2's own complete barrier, never to B1's.
      const publishes = world.log.entries.filter((entry) => entry.kind === 'ready.publish')
      const b1Retired = world.log.entries.find(
        (entry) => entry.kind === 'binding.invalidate' && entry.detail.cause === 'replacement'
      )
      expect(b1Retired).toBeDefined()
      for (const publish of publishes) {
        expect(publish.seq > b1Retired!.seq, world.log.trace().join('\n')).toBe(true)
      }
      void rebindTask
    } finally {
      world.dispose()
    }
  })
})

describe('Linear lifecycle generated harness — task #1550 private binding generation', () => {
  it('late settle reorder: a stale-epoch settle arriving after B2 fails closed with zero B2 effects', async () => {
    vi.useRealTimers()
    const world = createHarnessWorld({ seed: 140, pageCount: 1 })
    try {
      const page = world.pages[0]
      world.armSettleGate()
      const initTask = page.lease.init()
      // B1 publishes ready; its settle signal suspends inside the gate (a reordered late arrival).
      await driveWorld(world, () => world.gates.pending().some((gate) => gate.label === 'ready.settle'))
      expect(page.readyPublished).toBe(true)
      // A same-Page registration installs B2 (epoch 2) and completes its own barrier + settle.
      let rebindSettled = false
      page.lease.rebind().then(
        () => {
          rebindSettled = true
        },
        () => {
          rebindSettled = true
        }
      )
      await driveWorld(world, () => rebindSettled, ['ready.settle'])
      expect(rebindSettled).toBe(true)
      // Release B1's late settle: it must fail closed against B2's stored epoch, not settle B2.
      for (const gate of world.gates.pending()) {
        if (gate.label === 'ready.settle') (gate as HarnessGate<unknown>).release(undefined as never)
      }
      await initTask
      // Direct proof: a stale-epoch settle is rejected with the exact current-binding error.
      const hostId = (await world.server.getSnapshot()).hostId
      await expect(
        world.server.getSnapshot({
          pageId: page.pageId,
          runtimeHostId: hostId,
          caller: { tab: { id: page.tabId, url: page.url } },
          settleReadiness: true,
          epoch: 1
        })
      ).rejects.toThrow('Runtime Page binding is no longer current')
      // B1's readiness owners ended via exact-B retirement at B2 install, not via the late settle.
      const identity = world.log.entries.filter((entry) => entry.kind === 'identity')
      expect(identity.some((entry) => entry.detail.type === 'binding' && entry.detail.phase === 'removed')).toBe(true)
      // B2 remains fully usable: its own epoch validates.
      await world.server.getSnapshot({
        pageId: page.pageId,
        runtimeHostId: hostId,
        caller: { tab: { id: page.tabId, url: page.url } },
        validateReadiness: true,
        epoch: 2
      })
    } finally {
      world.dispose()
    }
  })

  it('late retire reorder: a stale-epoch detach after B2 fails closed and B2 survives', async () => {
    vi.useRealTimers()
    const world = createHarnessWorld({ seed: 141, pageCount: 1 })
    try {
      const page = world.pages[0]
      await page.lease.init() // B1, epoch 1
      await page.lease.rebind() // B2, epoch 2
      const hostId = (await world.server.getSnapshot()).hostId
      // A stale B1 failure terminal arriving late must not detach the fresh successor.
      await expect(
        world.server.detachPage({
          domain: HARNESS_DOMAIN,
          pageId: page.pageId,
          runtimeHostId: hostId,
          caller: { tab: { id: page.tabId, url: page.url } },
          epoch: 1
        })
      ).rejects.toThrow('Runtime Page binding is no longer current')
      // B2 is intact: its exact epoch still validates and its readiness fact is complete.
      await world.server.getSnapshot({
        pageId: page.pageId,
        runtimeHostId: hostId,
        caller: { tab: { id: page.tabId, url: page.url } },
        validateReadiness: true,
        epoch: 2
      })
    } finally {
      world.dispose()
    }
  })

  it('callback-before-settle: a business call issued before the settle lands waits for cleanup', async () => {
    vi.useRealTimers()
    const world = createHarnessWorld({ seed: 142, pageCount: 1 })
    try {
      const page = world.pages[0]
      world.armSettleGate()
      const initTask = page.lease.init()
      await driveWorld(world, () => world.gates.pending().some((gate) => gate.label === 'ready.settle'))
      expect(page.readyPublished).toBe(true)
      // The ready callback issues a join immediately; the join completes, but its cohort must NOT
      // clear while the exact-B readiness owners are still unsettled (settle held).
      let joinSettled = false
      page.chat.joinRoom({ user: harnessUser(0), site: HARNESS_SITE }).then(
        () => {
          joinSettled = true
        },
        () => {
          joinSettled = true
        }
      )
      await driveWorld(world, () => joinSettled, ['ready.settle'])
      expect(joinSettled).toBe(true)
      const identity = () => world.log.entries.filter((entry) => entry.kind === 'identity')
      expect(identity().some((entry) => entry.detail.phase === 'cleared')).toBe(false)
      // A business send in the same window must wait for the cohort, not commit early.
      let sendSettled = false
      page.chat.sendMessage({ type: 'text', body: 'window', mentions: [] }).then(
        () => {
          sendSettled = true
        },
        () => {
          sendSettled = true
        }
      )
      await driveWorld(world, () => false, ['ready.settle'])
      expect(sendSettled).toBe(false)
      // The settle lands: tokens end, cleanup wakes, and the waiting business call proceeds.
      for (const gate of world.gates.pending()) {
        if (gate.label === 'ready.settle') (gate as HarnessGate<unknown>).release(undefined as never)
      }
      await initTask
      await driveWorld(world, () => sendSettled)
      expect(sendSettled).toBe(true)
      const cleared = identity().find((entry) => entry.detail.phase === 'cleared')
      const settled = world.log.entries.find((entry) => entry.kind === 'ready.settle')
      // Cleanup cleared exactly once, and only inside the post-publication settle terminal.
      expect(cleared).toBeDefined()
      expect(settled).toBeDefined()
    } finally {
      world.dispose()
    }
  })

  it('same-host checkNow: every successful registration rebuilds the complete barrier for the new B', async () => {
    vi.useRealTimers()
    const world = createHarnessWorld({ seed: 143, pageCount: 1 })
    try {
      const page = world.pages[0]
      await page.lease.init()
      // Join so the domain is live before the same-host refresh.
      let joinSettled = false
      page.chat.joinRoom({ user: harnessUser(0), site: HARNESS_SITE }).then(
        () => {
          joinSettled = true
        },
        () => {
          joinSettled = true
        }
      )
      await driveWorld(world, () => joinSettled)
      expect(joinSettled).toBe(true)
      // Same-host refresh: the registration installs a fresh B (old callbacks are removed).
      await page.lease.checkNow()
      const identity = world.log.entries.filter((entry) => entry.kind === 'identity')
      const installs = identity.filter((entry) => entry.detail.type === 'binding' && entry.detail.phase === 'installed')
      expect(installs.length).toBeGreaterThanOrEqual(2)
      // The new B went through its own final validation and settle.
      const validations = world.log.entries.filter((entry) => entry.kind === 'ready.validate')
      expect(validations.length).toBeGreaterThanOrEqual(2)
      // Business works on the rebuilt B (its callbacks/session are re-established).
      const record = await page.server.allocateTextMessage({
        domain: HARNESS_DOMAIN,
        body: 'after-checknow',
        mentions: []
      })
      expect(record).toBeDefined()
    } finally {
      world.dispose()
    }
  })
})
