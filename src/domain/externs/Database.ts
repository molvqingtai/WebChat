import type { Unsubscribe } from '@/domain/Subscription'

export type DatabaseKey = string | number

export interface StoreSchema {
  key: DatabaseKey
  value: unknown
  indexes: Record<string, DatabaseKey>
}

export type DatabaseSchema<S> = {
  [Store in keyof S]: StoreSchema
}

type StoreName<S> = keyof S & string
type Scope<Name extends string> = readonly [Name, ...Name[]]

type LowerBound<T> = { lower?: never; lowerOpen?: never } | { lower: T; lowerOpen?: boolean }

type UpperBound<T> = { upper?: never; upperOpen?: never } | { upper: T; upperOpen?: boolean }

export type DatabaseRange<T> = LowerBound<T> & UpperBound<T>

type PrimaryQuery<S extends StoreSchema> = {
  index?: never
  range?: DatabaseRange<S['key']>
}

type IndexQuery<S extends StoreSchema> = {
  [Index in keyof S['indexes'] & string]: {
    index: Index
    range?: DatabaseRange<S['indexes'][Index]>
  }
}[keyof S['indexes'] & string]

export type QueryOptions<S extends StoreSchema> = PrimaryQuery<S> | IndexQuery<S>

export type ScanOptions<S extends StoreSchema> = QueryOptions<S> & {
  direction?: 'asc' | 'desc'
  limit?: number
}

export interface DatabaseItem<Key, Value> {
  readonly key: Key
  readonly value: Value
}

export type InsertResult<Value> = { readonly inserted: true } | { readonly inserted: false; readonly existing: Value }

export interface ReadTransaction<Schema extends DatabaseSchema<Schema>, Allowed extends StoreName<Schema>> {
  get<Store extends Allowed>(store: Store, key: Schema[Store]['key']): Promise<Schema[Store]['value'] | undefined>

  scan<Store extends Allowed>(
    store: Store,
    options?: ScanOptions<Schema[Store]>
  ): Promise<readonly DatabaseItem<Schema[Store]['key'], Schema[Store]['value']>[]>

  count<Store extends Allowed>(store: Store, options?: QueryOptions<Schema[Store]>): Promise<number>
}

export interface WriteTransaction<
  Schema extends DatabaseSchema<Schema>,
  Allowed extends StoreName<Schema>
> extends ReadTransaction<Schema, Allowed> {
  insert<Store extends Allowed>(
    store: Store,
    key: Schema[Store]['key'],
    value: Schema[Store]['value']
  ): Promise<InsertResult<Schema[Store]['value']>>

  put<Store extends Allowed>(store: Store, key: Schema[Store]['key'], value: Schema[Store]['value']): Promise<void>

  delete<Store extends Allowed>(store: Store, key: Schema[Store]['key']): Promise<void>

  clear<Store extends Allowed>(store: Store): Promise<void>
}

export interface Database<Schema extends DatabaseSchema<Schema>> {
  read<const Stores extends Scope<StoreName<Schema>>, Result>(
    stores: Stores,
    operation: (transaction: ReadTransaction<Schema, Stores[number]>) => Promise<Result>,
    signal?: AbortSignal
  ): Promise<Result>

  write<const Stores extends Scope<StoreName<Schema>>, Result>(
    stores: Stores,
    operation: (transaction: WriteTransaction<Schema, Stores[number]>) => Promise<Result>,
    signal?: AbortSignal
  ): Promise<Result>

  watch<const Stores extends Scope<StoreName<Schema>>>(stores: Stores, listener: () => void): Unsubscribe
}
