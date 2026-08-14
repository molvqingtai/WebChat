import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Header from '.'

const queries = vi.hoisted(() => [] as unknown[][])
const lists = vi.hoisted(() => [] as unknown[][])

vi.mock('remesh-react', () => ({
  useRemeshDomain: () => ({ query: { UserListQuery: () => ({}) } }),
  useRemeshQuery: () => queries.shift()
}))

vi.mock('react-virtuoso', async () => {
  const React = await import('react')
  return {
    Virtuoso: ({ data = [] }: { data?: unknown[] }) => {
      lists.push(data)
      return React.createElement(React.Fragment)
    }
  }
})

vi.mock('@/components/ui/hover-card', async () => {
  const React = await import('react')
  const PassThrough = ({ children }: { children?: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children)
  return {
    HoverCard: PassThrough,
    HoverCardTrigger: PassThrough,
    HoverCardContent: PassThrough
  }
})

vi.mock('@/utils', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getSiteMeta: () => ({ origin: 'https://current.test', title: 'Current' })
}))

const user = (id: string) => ({ id, name: id, avatar: '' })
const sites = [
  { origin: 'https://solo.test', users: [user('solo')] },
  { origin: 'https://first-crowded.test', users: [user('a'), user('b'), user('c')] },
  { origin: 'https://second-crowded.test', users: [user('d'), user('e'), user('f')] },
  { origin: 'https://pair.test', users: [user('g'), user('h')] }
]

beforeEach(() => {
  // functional-mutate: resetting the owned queries queue is the operation itself
  queries.splice(0, queries.length, [], sites)
  lists.length = 0
})

describe('Header online-site ordering', () => {
  it('orders sites stably by descending online population', () => {
    renderToStaticMarkup(createElement(Header))

    expect((lists[0] as typeof sites).map(({ origin }) => origin)).toEqual([
      'https://first-crowded.test',
      'https://second-crowded.test',
      'https://pair.test',
      'https://solo.test'
    ])
  })
})
