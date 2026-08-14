import { describe, expect, it } from 'vitest'

describe('application status ownership', () => {
  it('keeps runtime module exports production-only', async () => {
    const modules = await Promise.all([
      import('@/app/content/Initialization'),
      import('@/domain/AppStatus'),
      import('@/domain/AppFeedback'),
      import('@/domain/Toast')
    ])

    expect(modules.map((module) => Object.keys(module).toSorted())).toEqual([
      ['startInitializationLifecycle'],
      ['default'],
      ['default'],
      ['default']
    ])
  })
})
