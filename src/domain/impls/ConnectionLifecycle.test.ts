import { describe, expect, it } from 'vitest'
import { createConnectionLifecycle } from '@/domain/impls/ConnectionLifecycle'

describe('ConnectionLifecycle exact task-identity correlation', () => {
  it('binds a minted token to an exact task and reports its result one-shot', () => {
    const { value, report } = createConnectionLifecycle()

    const token = value.mint()
    const task = Promise.resolve() as Promise<void>
    value.bindTask(task, token)
    report(token, 'cancelled')

    expect(value.getTaskResult(task)).toBe('cancelled')
    // One-shot: reading again yields the default (terminal state released).
    expect(value.getTaskResult(task)).toBe('active')
  })

  it('keeps each task’s result owned by its own exact token across overlapping invocations', () => {
    const { value, report } = createConnectionLifecycle()

    const tokenA = value.mint()
    const taskA = Promise.resolve() as Promise<void>
    value.bindTask(taskA, tokenA)
    // Overlapping invocation B mints its own token and task.
    const tokenB = value.mint()
    const taskB = Promise.resolve() as Promise<void>
    value.bindTask(taskB, tokenB)

    report(tokenA, 'cancelled')
    report(tokenB, 'failed')

    // A superseded/cancelled attempt must not corrupt its successor's real failure and vice-versa.
    expect(value.getTaskResult(taskA)).toBe('cancelled')
    expect(value.getTaskResult(taskB)).toBe('failed')
  })

  it('consumes (releases) a terminal result even when the caller would otherwise branch on staleness', () => {
    const { value, report } = createConnectionLifecycle()
    const token = value.mint()
    const task = Promise.resolve() as Promise<void>
    value.bindTask(task, token)
    report(token, 'succeeded')

    // A stale caller branch (e.g. request id no longer current) must still not leave the terminal result
    // behind: consume it exactly once, and a second read yields the default (no leak).
    expect(value.getTaskResult(task)).toBe('succeeded')
    expect(value.getTaskResult(task)).toBe('active')
  })
})
