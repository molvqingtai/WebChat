import type { DatabaseKey, DatabaseSchema, QueryOptions, ScanOptions, StoreSchema } from '@/domain/externs/Database'

type StoreName<Schema> = keyof Schema & string

type KeyType<Key extends DatabaseKey> = string extends Key
  ? number extends Key
    ? 'string-or-number'
    : 'string'
  : 'number'

export interface IndexDefinition<Key extends DatabaseKey> {
  readonly key: KeyType<Key>
  readonly keyPath: string
  readonly introducedIn: number
}

export interface StoreDefinition<Schema extends StoreSchema> {
  readonly key: KeyType<Schema['key']>
  readonly introducedIn: number
  readonly indexes: {
    readonly [Index in keyof Schema['indexes'] & string]: IndexDefinition<Schema['indexes'][Index]>
  }
}

export interface DatabaseDefinition<Schema extends DatabaseSchema<Schema>> {
  readonly name: string
  readonly version: number
  readonly channelName: string
  readonly stores: {
    readonly [Store in StoreName<Schema>]: StoreDefinition<Schema[Store]>
  }
}

export const cloneValue = <Value>(value: Value): Value => {
  assertCanonicalValue(value)
  return structuredClone(value)
}

export const cloneStoredValue = <Value>(value: Value): Value => {
  const clone = structuredClone(value)
  assertCanonicalValue(clone)
  return clone
}

const assertPlainValue = (value: unknown, seen: Set<object>): void => {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Database values require finite numbers')
    return
  }
  if (typeof value !== 'object') throw new TypeError('Database values require canonical plain data')
  if (seen.has(value)) throw new TypeError('Database values cannot contain cycles')
  seen.add(value)
  try {
    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.prototype.hasOwnProperty.call(value, index)) {
          throw new TypeError('Database values require dense arrays')
        }
        assertPlainValue(value[index], seen)
      }
      if (
        Reflect.ownKeys(value).some(
          (key) => key !== 'length' && (typeof key !== 'string' || !/^\d+$/.test(key) || String(Number(key)) !== key)
        )
      ) {
        throw new TypeError('Database arrays cannot have custom properties')
      }
      return
    }
    if (Object.getPrototypeOf(value) !== Object.prototype) {
      throw new TypeError('Database values require plain objects')
    }
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== 'string') throw new TypeError('Database object keys must be strings')
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (!descriptor?.enumerable || !('value' in descriptor)) {
        throw new TypeError('Database values require enumerable data properties')
      }
      assertPlainValue(descriptor.value, seen)
    }
  } finally {
    seen.delete(value)
  }
}

export const assertCanonicalValue = (value: unknown): void => assertPlainValue(value, new Set())

export function assertDatabaseKey(
  value: unknown,
  type?: 'string' | 'number' | 'string-or-number'
): asserts value is DatabaseKey {
  if (typeof value !== 'string' && (typeof value !== 'number' || !Number.isFinite(value))) {
    throw new TypeError('Database keys must be strings or finite numbers')
  }
  if (type && type !== 'string-or-number' && typeof value !== type) {
    throw new TypeError(`Database key must be a ${type}`)
  }
}

export const compareDatabaseKeys = (left: DatabaseKey, right: DatabaseKey): number => {
  if (typeof left !== typeof right) return typeof left === 'number' ? -1 : 1
  if (left === right) return 0
  return left < right ? -1 : 1
}

export const getPathValue = (value: unknown, keyPath: string): unknown => {
  let current = value
  for (const part of keyPath.split('.')) {
    if (typeof current !== 'object' || current === null || !Object.prototype.hasOwnProperty.call(current, part)) {
      return undefined
    }
    current = (current as Record<string, unknown>)[part]
  }
  return current
}

export const validateStoreValue = <Schema extends StoreSchema>(
  definition: StoreDefinition<Schema>,
  value: Schema['value']
): void => {
  assertCanonicalValue(value)
  for (const index of Object.values(definition.indexes) as IndexDefinition<DatabaseKey>[]) {
    assertDatabaseKey(getPathValue(value, index.keyPath), index.key)
  }
}

export const validateScope = <Schema extends DatabaseSchema<Schema>>(
  definition: DatabaseDefinition<Schema>,
  stores: readonly string[]
): string[] => {
  if (stores.length === 0) throw new TypeError('Database transaction scope must not be empty')
  if (new Set(stores).size !== stores.length)
    throw new TypeError('Database transaction scope must not contain duplicates')
  stores.forEach((store) => {
    if (!Object.prototype.hasOwnProperty.call(definition.stores, store)) {
      throw new TypeError(`Unknown database store: ${store}`)
    }
  })
  return [...stores]
}

const validateRange = (
  range: Record<string, unknown> | undefined,
  type: 'string' | 'number' | 'string-or-number'
): void => {
  if (!range) return
  if (Object.keys(range).some((key) => !['lower', 'lowerOpen', 'upper', 'upperOpen'].includes(key))) {
    throw new TypeError('Database range contains an unknown field')
  }
  const hasLower = Object.prototype.hasOwnProperty.call(range, 'lower')
  const hasUpper = Object.prototype.hasOwnProperty.call(range, 'upper')
  if (!hasLower && Object.prototype.hasOwnProperty.call(range, 'lowerOpen')) {
    throw new TypeError('lowerOpen requires lower')
  }
  if (!hasUpper && Object.prototype.hasOwnProperty.call(range, 'upperOpen')) {
    throw new TypeError('upperOpen requires upper')
  }
  if (Object.prototype.hasOwnProperty.call(range, 'lowerOpen') && typeof range.lowerOpen !== 'boolean') {
    throw new TypeError('lowerOpen must be a boolean')
  }
  if (Object.prototype.hasOwnProperty.call(range, 'upperOpen') && typeof range.upperOpen !== 'boolean') {
    throw new TypeError('upperOpen must be a boolean')
  }
  if (hasLower) assertDatabaseKey(range.lower, type)
  if (hasUpper) assertDatabaseKey(range.upper, type)
  if (hasLower && hasUpper && compareDatabaseKeys(range.lower as DatabaseKey, range.upper as DatabaseKey) > 0) {
    throw new TypeError('Database range lower bound exceeds upper bound')
  }
}

export interface ValidatedQuery {
  readonly index?: string
  readonly range?: Record<string, unknown>
  readonly direction: 'asc' | 'desc'
  readonly limit?: number
}

export const validateQuery = <Schema extends StoreSchema>(
  definition: StoreDefinition<Schema>,
  options?: QueryOptions<Schema> | ScanOptions<Schema>,
  includeScan = false
): ValidatedQuery => {
  if (options !== undefined && (typeof options !== 'object' || options === null || Array.isArray(options))) {
    throw new TypeError('Database query options must be an object')
  }
  const input = (options ?? {}) as Record<string, unknown>
  const allowedFields = includeScan ? ['index', 'range', 'direction', 'limit'] : ['index', 'range']
  if (Object.keys(input).some((key) => !allowedFields.includes(key))) {
    throw new TypeError('Database query contains an unknown field')
  }
  const index = input.index
  if (
    index !== undefined &&
    (typeof index !== 'string' || !Object.prototype.hasOwnProperty.call(definition.indexes, index))
  ) {
    throw new TypeError(`Unknown database index: ${String(index)}`)
  }
  const type = index
    ? (definition.indexes as unknown as Record<string, IndexDefinition<DatabaseKey>>)[index as string].key
    : definition.key
  const range = input.range
  if (range !== undefined && (typeof range !== 'object' || range === null || Array.isArray(range))) {
    throw new TypeError('Database range must be an object')
  }
  validateRange(range as Record<string, unknown> | undefined, type)
  const direction = input.direction ?? 'asc'
  if (includeScan && direction !== 'asc' && direction !== 'desc') {
    throw new TypeError('Database scan direction must be asc or desc')
  }
  if (!includeScan && input.direction !== undefined) throw new TypeError('Database count does not accept direction')
  const limit = input.limit
  if (includeScan && limit !== undefined && (!Number.isSafeInteger(limit) || (limit as number) < 0)) {
    throw new TypeError('Database scan limit must be a non-negative safe integer')
  }
  if (!includeScan && limit !== undefined) throw new TypeError('Database count does not accept a limit')
  return {
    ...(index === undefined ? {} : { index: index as string }),
    ...(range === undefined ? {} : { range: range as Record<string, unknown> }),
    direction: direction as 'asc' | 'desc',
    ...(limit === undefined ? {} : { limit: limit as number })
  }
}

export const keyInRange = (key: DatabaseKey, range?: Record<string, unknown>): boolean => {
  if (!range) return true
  if (Object.prototype.hasOwnProperty.call(range, 'lower')) {
    const order = compareDatabaseKeys(key, range.lower as DatabaseKey)
    if (order < 0 || (order === 0 && range.lowerOpen === true)) return false
  }
  if (Object.prototype.hasOwnProperty.call(range, 'upper')) {
    const order = compareDatabaseKeys(key, range.upper as DatabaseKey)
    if (order > 0 || (order === 0 && range.upperOpen === true)) return false
  }
  return true
}
