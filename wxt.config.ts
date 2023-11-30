import path from 'node:path'
import { defineConfig } from 'wxt'
import react from '@vitejs/plugin-react'
import { name } from './package.json'

const isDev = process.env.NODE_ENV === 'development'

export default defineConfig({
  srcDir: path.resolve('src'),
  imports: false,
  entrypointsDir: path.resolve('src', 'app'),
  runner: {
    startUrls: ['https://www.example.com/']
  },
  vite: () => ({
    define: {
      __DEV__: isDev,
      __NAME__: JSON.stringify(name)
    },
    plugins: [react()]
  })
})
