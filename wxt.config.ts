import path from 'node:path'
import { defineConfig } from 'wxt'
import react from '@vitejs/plugin-react'
import { name, displayName, homepage } from './package.json'
import svgr from 'vite-plugin-svgr'
import defu from 'defu'

export default defineConfig({
  srcDir: path.resolve('src'),
  imports: false,
  entrypointsDir: 'app',
  runner: {
    startUrls: ['https://www.example.com/']
  },
  manifest: ({ browser }) => {
    const common = {
      name: displayName,
      permissions: ['storage', 'notifications', 'tabs'],
      homepage_url: homepage,
      icons: {
        '16': 'logo.png',
        '32': 'logo.png',
        '48': 'logo.png',
        '128': 'logo.png'
      },
      action: {}
    }
    return {
      chrome: defu(common, {
        permissions: ['aiLanguageModelOriginTrial'],
        minimum_chrome_version: '131',
        key: import.meta.env.WXT_EXTENSION_PUBLIC_KEY,
        trial_tokens: [
          import.meta.env.WXT_ORIGIN_TRIALS_LANGUAGE_DETECTOR_API_TOKEN,
          import.meta.env.WXT_ORIGIN_TRIALS_TRANSLATOR_API_TOKEN,
          import.meta.env.WXT_ORIGIN_TRIALS_PROMPT_API_TOKEN
        ]
      }),
      firefox: defu(common, {
        browser_specific_settings: {
          gecko: {
            id: 'molvqingtai@gmail.com'
          }
        }
      })
    }[browser]
  },
  vite: (env) => ({
    define: {
      __DEV__: env.mode === 'development',
      __NAME__: JSON.stringify(name)
    },
    plugins: [
      react(),
      svgr({
        include: '**/*.svg'
      })
    ]
  })
})
