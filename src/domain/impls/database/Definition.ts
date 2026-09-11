import type { DatabaseKey, DatabaseSchema, QueryOptions, ScanOptions, StoreSchema } from '@/domain/externs/Database'

type StoreName<Schema> = keyof Schema & string

type KeyType<Key extends DatabaseKey> = string extends Key
  ? number extends Key
    ? 'string-or-number'
    : 'string'
  : 'number'

// oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- raw records exchanged between the boundary validators in this module
type RawRecord = Record<string, unknown>

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

const assertPlainValue = (
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- boundary validator over IndexedDB plain data
  value: unknown,
  seen: Set<object>
): void => {
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- structural discrimination of unknown JSON at the boundary
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- structural discrimination of unknown JSON at the boundary
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Database values require finite numbers')
    return
  }
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- structural discrimination of unknown JSON at the boundary
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
          // oxlint-disable-next-line anti-slop/no-runtime-typeof -- structural discrimination of unknown JSON at the boundary
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
    Reflect.ownKeys(value).forEach((key) => {
      // oxlint-disable-next-line anti-slop/no-runtime-typeof -- structural discrimination of unknown JSON at the boundary
      if (typeof key !== 'string') throw new TypeError('Database object keys must be strings')
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (!descriptor?.enumerable || !('value' in descriptor)) {
        throw new TypeError('Database values require enumerable data properties')
      }
      assertPlainValue(descriptor.value, seen)
    })
  } finally {
    seen.delete(value)
  }
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- boundary validator over IndexedDB plain data
export const assertCanonicalValue = (value: unknown): void => assertPlainValue(value, new Set())

export function assertDatabaseKey(
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- boundary validator over IndexedDB keys
  value: unknown,
  type?: 'string' | 'number' | 'string-or-number'
): asserts value is DatabaseKey {
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- structural discrimination of unknown JSON at the boundary
  if (typeof value !== 'string' && (typeof value !== 'number' || !Number.isFinite(value))) {
    throw new TypeError('Database keys must be strings or finite numbers')
  }
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- comparison against the declared key kind
  if (type && type !== 'string-or-number' && typeof value !== type) {
    throw new TypeError(`Database key must be a ${type}`)
  }
}

export const compareDatabaseKeys = (left: DatabaseKey, right: DatabaseKey): number => {
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- keys are the only string|number union here; kind ordering is intended
  if (typeof left !== typeof right) return typeof left === 'number' ? -1 : 1
  if (left === right) return 0
  return left < right ? -1 : 1
}

export function getPathValue(
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- boundary traversal of an already validated document
  value: unknown,
  keyPath: string
  // oxlint-disable-next-line anti-slop/no-unknown-returns -- result is validated by the caller's key assertion
): unknown {
  return keyPath.split('.').reduce<unknown>((current, part) => {
    // oxlint-disable-next-line anti-slop/no-runtime-typeof -- structural discrimination of unknown JSON at the boundary
    if (typeof current !== 'object' || current === null || !Object.prototype.hasOwnProperty.call(current, part)) {
      return undefined
    }
    // SAFETY: hasOwnProperty above established that `part` is an own key of the traversed record.
    // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- own-key lookup on a validated document
    return (current as RawRecord)[part]
  }, value)
}

export const validateStoreValue = <Schema extends StoreSchema>(
  definition: StoreDefinition<Schema>,
  value: Schema['value']
): void => {
  assertCanonicalValue(value)
  // SAFETY: definition.indexes holds IndexDefinitions for this store; Object.values erases the
  // per-index key type, so the shared DatabaseKey contract is the correct common view.
  const indexes = Object.values(definition.indexes) as IndexDefinition<DatabaseKey>[]
  indexes.forEach((index) => assertDatabaseKey(getPathValue(value, index.keyPath), index.key))
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

const validateRange = (range: RawRecord | undefined, type: 'string' | 'number' | 'string-or-number'): void => {
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
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- structural discrimination of the raw range record
  if (Object.prototype.hasOwnProperty.call(range, 'lowerOpen') && typeof range.lowerOpen !== 'boolean') {
    throw new TypeError('lowerOpen must be a boolean')
  }
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- structural discrimination of the raw range record
  if (Object.prototype.hasOwnProperty.call(range, 'upperOpen') && typeof range.upperOpen !== 'boolean') {
    throw new TypeError('upperOpen must be a boolean')
  }
  if (hasLower) assertDatabaseKey(range.lower, type)
  if (hasUpper) assertDatabaseKey(range.upper, type)
  if (hasLower && hasUpper) {
    // SAFETY: hasLower/hasUpper established that `lower` and `upper` are present, and both were accepted by assertDatabaseKey above.
    const lower = range.lower as DatabaseKey
    // SAFETY: hasUpper established that `upper` is present, and it was accepted by assertDatabaseKey above.
    const upper = range.upper as DatabaseKey
    if (compareDatabaseKeys(lower, upper) > 0) {
      throw new TypeError('Database range lower bound exceeds upper bound')
    }
  }
}

export interface ValidatedQuery {
  readonly index?: string
  readonly range?: RawRecord
  readonly direction: 'asc' | 'desc'
  readonly limit?: number
}

type ResolvedQuery = {
  index?: string
  // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- raw range record validated by validateRange before assignment
  range?: RawRecord
  direction: 'asc' | 'desc'
  limit?: number
}

const readValidatedQueryOptions = (
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- raw caller options; validated field by field below
  options: unknown,
  includeScan: boolean
): RawRecord => {
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- structural discrimination of the caller-supplied query options
  if (options !== undefined && (typeof options !== 'object' || options === null || Array.isArray(options))) {
    throw new TypeError('Database query options must be an object')
  }
  // SAFETY: `options` is absent or a plain object per the check above and the `?? {}` fallback.
  const input = (options ?? {}) as RawRecord
  const allowedFields = includeScan ? ['index', 'range', 'direction', 'limit'] : ['index', 'range']
  if (Object.keys(input).some((key) => !allowedFields.includes(key))) {
    throw new TypeError('Database query contains an unknown field')
  }
  return input
}

const resolveQueryKeyType = <Schema extends StoreSchema>(
  definition: StoreDefinition<Schema>,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- raw `index` field; validated against definition.indexes below
  index: unknown
): 'string' | 'number' | 'string-or-number' => {
  if (index === undefined) return definition.key
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- structural discrimination of the raw query options
  if (typeof index !== 'string' || !Object.prototype.hasOwnProperty.call(definition.indexes, index)) {
    throw new TypeError(`Unknown database index: ${String(index)}`)
  }
  // SAFETY: the index name was checked against definition.indexes above; the mapped per-index key
  // type is erased by the dynamic lookup, so the shared key contract is the correct common view.
  const indexDefinitionTable = definition.indexes as unknown
  // SAFETY: indexDefinitionTable holds one of the store's IndexDefinitions; the shared key contract is its common view.
  const indexDefinition = (indexDefinitionTable as Record<string, IndexDefinition<DatabaseKey>>)[index]
  return indexDefinition.key
}

const resolveQueryDirection = (input: RawRecord, includeScan: boolean): 'asc' | 'desc' => {
  const direction = input.direction ?? 'asc'
  if (includeScan && direction !== 'asc' && direction !== 'desc') {
    throw new TypeError('Database scan direction must be asc or desc')
  }
  if (!includeScan && input.direction !== undefined) throw new TypeError('Database count does not accept direction')
  // SAFETY: `direction` is the literal default 'asc' or passed the asc/desc check above.
  return direction as 'asc' | 'desc'
}

const resolveQueryLimit = (input: RawRecord, includeScan: boolean): number | undefined => {
  const limit = input.limit
  if (includeScan && limit !== undefined) {
    if (!Number.isSafeInteger(limit)) {
      throw new TypeError('Database scan limit must be a non-negative safe integer')
    }
    // SAFETY: Number.isSafeInteger established that `limit` is a number.
    if ((limit as number) < 0) {
      throw new TypeError('Database scan limit must be a non-negative safe integer')
    }
  }
  if (!includeScan && limit !== undefined) throw new TypeError('Database count does not accept a limit')
  // SAFETY: the checks above established that `limit` is a non-negative safe integer when present.
  return limit as number | undefined
}

export const validateQuery = <Schema extends StoreSchema>(
  definition: StoreDefinition<Schema>,
  options?: QueryOptions<Schema> | ScanOptions<Schema>,
  includeScan = false
): ValidatedQuery => {
  const input = readValidatedQueryOptions(options, includeScan)
  const type = resolveQueryKeyType(definition, input.index)
  const range = input.range
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- structural discrimination of the raw query options
  if (range !== undefined && (typeof range !== 'object' || range === null || Array.isArray(range))) {
    throw new TypeError('Database range must be an object')
  }
  // SAFETY: the check above narrowed `range` to a plain record (or undefined).
  const validatedRange = range as RawRecord | undefined
  validateRange(validatedRange, type)
  const direction = resolveQueryDirection(input, includeScan)
  const limit = resolveQueryLimit(input, includeScan)
  // SAFETY: resolveQueryKeyType established that `input.index` is a known index name when present.
  const validatedIndex = input.index as string | undefined
  const validated: ResolvedQuery = { direction }
  if (validatedIndex !== undefined) validated.index = validatedIndex
  if (validatedRange !== undefined) validated.range = validatedRange
  if (limit !== undefined) validated.limit = limit
  return validated
}

export const keyInRange = (key: DatabaseKey, range?: RawRecord): boolean => {
  if (!range) return true
  if (Object.prototype.hasOwnProperty.call(range, 'lower')) {
    // SAFETY: hasOwnProperty established that `lower` is present; the range is validated before use.
    const lower = range.lower as DatabaseKey
    const order = compareDatabaseKeys(key, lower)
    if (order < 0 || (order === 0 && range.lowerOpen === true)) return false
  }
  if (Object.prototype.hasOwnProperty.call(range, 'upper')) {
    // SAFETY: hasOwnProperty established that `upper` is present; the range is validated before use.
    const upper = range.upper as DatabaseKey
    const order = compareDatabaseKeys(key, upper)
    if (order > 0 || (order === 0 && range.upperOpen === true)) return false
  }
  return true
}
