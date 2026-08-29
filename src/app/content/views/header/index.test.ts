import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Header from '.'

const queries = vi.hoisted(() => [] as unknown[][])

vi.mock('remesh-react', () => ({
  useRemeshDomain: () => ({ query: { UserListQuery: () => ({}) } }),
  useRemeshQuery: () => queries.shift()
}))

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
  queries.splice(0, queries.length, [], sites)
})

describe('Header online-site ordering', () => {
  it('orders sites stably by descending online population', () => {
    const markup = renderToStaticMarkup(createElement(Header))
    const origins = [...markup.matchAll(/href="(https:\/\/[^"]+\.test)"/g)].map((match) => match[1])

    expect(origins).toEqual([
      'https://first-crowded.test',
      'https://second-crowded.test',
      'https://pair.test',
      'https://solo.test'
    ])
  })

  it('renders every room row as real DOM with 56px intrinsic reservation and link semantics', () => {
    const manySites = Array.from({ length: 300 }, (_, index) => ({
      origin: `https://room-${index}.test`,
      users: [user(`user-${index}`)]
    }))
    queries.splice(0, queries.length, [], manySites)

    const markup = renderToStaticMarkup(createElement(Header))

    // No virtualization: every room row is present as a real element carrying the geometry contract.
    expect(markup.match(/contain-intrinsic-size:auto_56px/g)).toHaveLength(300)
    expect(markup.match(/content-visibility:auto/g)?.length).toBeGreaterThanOrEqual(300)

    // Accessible room semantics: each row is a real anchor pointing at its room origin.
    const roomOrigins = [...markup.matchAll(/href="(https:\/\/room-\d+\.test)"/g)].map((match) => match[1])
    expect(roomOrigins).toHaveLength(300)
    // Equal populations keep the stable input order.
    expect(roomOrigins[0]).toBe('https://room-0.test')
    expect(roomOrigins.at(-1)).toBe('https://room-299.test')
  })
})
