import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { crx } from '@crxjs/vite-plugin'
import Icons from 'unplugin-icons/vite'
import manifest from './manifest'
import packageJson from './package.json'

export default defineConfig({
  server: {
    open: './index.html'
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  },
  define: {
    __DEV__: process.env.NODE_ENV !== 'production',
    __NAME__: JSON.stringify(packageJson.name)
  },
  plugins: [
    react(),
    // https://github.com/antfu/unplugin-icons
    Icons({ compiler: 'jsx', jsx: 'react' }),
    crx({ manifest })
  ]
})
