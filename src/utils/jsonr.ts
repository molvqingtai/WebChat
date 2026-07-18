import jsonr from '@perfsee/jsonr'
import { isNullish } from '@/utils'

// `@perfsee/jsonr` ships CommonJS `exports.default`; bundler interop may yield the
// whole exports namespace instead of the default value itself.
const JSONR = (jsonr as unknown as { default?: typeof jsonr }).default ?? jsonr

export const parse = <T = any>(value: string | number | boolean | null): T | null => {
  return !isNullish(value) ? JSONR.parse(value!.toString()) : null
}

export const stringify = (value: any): string | null => {
  return !isNullish(value) ? JSONR.stringify(value) : null
}
