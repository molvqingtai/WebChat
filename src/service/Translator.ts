import { defineProxyService } from '@webext-core/proxy-service'
import { Translator as TranslatorExternType } from '@/domain/externs/Translator'

class Translator implements TranslatorExternType {
  async translate(text: string, options: { sourceLanguage: string; targetLanguage: string }): Promise<string> {
    // const translator = await self.translation.createTranslator(options)
    // return translator.translate(text)
    // @ts-expect-error window.ai is not defined in the global scope
    const session = await chrome.aiOriginTrial.languageModel.create({
      systemPrompt: `You are a professional translation engine. Please translate the text into ${navigator.language} without explanation.`,
      monitor(m: any) {
        m.addEventListener('downloadprogress', (e: any) => {
          console.log(`Downloaded ${e.loaded} of ${e.total} bytes.`)
        })
      }
    })
    return session.prompt(text)
  }
}

export const [registerTranslator, getTranslator] = defineProxyService('Translator', () => new Translator())
