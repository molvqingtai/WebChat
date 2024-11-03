import JSONR from '@perfsee/jsonr'
import { isNullish } from '@/utils'

export const parse = <T = any>(value: string | number | boolean | null): T | null => {
  return !isNullish(value) ? JSONR.parse(value!.toString()) : null
}

export const stringify = (value: any): string | null => {
  return !isNullish(value) ? JSONR.stringify(value) : null
}
