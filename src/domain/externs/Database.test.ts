import { describe, expect, expectTypeOf, it } from 'vitest'
import type { Database, DatabaseItem } from '@/domain/externs/Database'

interface TestSchema {
  messages: {
    key: string
    value: { body: string; rank: number }
    indexes: { byRank: number }
  }
  users: {
    key: number
    value: { name: string }
    indexes: Record<never, never>
  }
}

declare const database: Database<TestSchema>

const typeContract = () => {
  // @ts-expect-error transaction scopes are statically non-empty
  void database.read([], async () => null)
  // @ts-expect-error unknown stores are rejected
  void database.read(['missing'], async () => null)
  void database.read(['messages'], async (transaction) => {
    // @ts-expect-error a transaction cannot access a store outside its scope
    await transaction.get('users', 1)
    // @ts-expect-error message keys are strings
    await transaction.get('messages', 1)
    // @ts-expect-error unknown indexes are rejected
    await transaction.scan('messages', { index: 'missing' })
    // @ts-expect-error index ranges use the index key type
    await transaction.scan('messages', { index: 'byRank', range: { lower: '1' } })
    return transaction.scan('messages', { index: 'byRank', range: { lower: 1 }, limit: 1 })
  })
  void database.write(['messages'], async (transaction) => {
    // @ts-expect-error values are linked to their store schema
    await transaction.insert('messages', 'id', { name: 'wrong' })
    return transaction.insert('messages', 'id', { body: 'valid', rank: 1 })
  })
}

describe('Database static contract', () => {
  it('preserves primary keys in readonly scan items', () => {
    expectTypeOf<Awaited<ReturnType<Parameters<Database<TestSchema>['read']>[1]>>>().not.toBeAny()
    expectTypeOf<DatabaseItem<string, { body: string; rank: number }>['key']>().toEqualTypeOf<string>()
    expect(typeContract).toBeTypeOf('function')
  })
})
