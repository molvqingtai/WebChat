import { getTranslator } from '@/service/Translator'
import { TranslatorExtern } from '../externs/Translator'

export const TranslatorImpl = TranslatorExtern.impl(getTranslator())
