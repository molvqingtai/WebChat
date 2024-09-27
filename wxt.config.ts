import path from 'node:path'
import { defineConfig } from 'wxt'
import react from '@vitejs/plugin-react'
import { name } from './package.json'

export default defineConfig({
  srcDir: path.resolve('src'),
  imports: false,
  entrypointsDir: 'app',
  runner: {
    startUrls: ['https://www.example.com/']
  },
  manifest: {
    permissions: ['storage']
    // browser_specific_settings: {
    //   gecko: {
    //     id: 'molvqingtai@gmail.com'
    //   }
    // }
  },
  vite: (env) => ({
    define: {
      __DEV__: env.mode === 'development',
      __NAME__: JSON.stringify(name)
    },
    plugins: [react()]
  })
})
