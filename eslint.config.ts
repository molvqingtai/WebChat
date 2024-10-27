// import type { Linter } from 'eslint'
import globals from 'globals'
import pluginJs from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactPlugin from '@eslint-react/eslint-plugin'
import tailwindPlugin from 'eslint-plugin-tailwindcss'
import prettierPlugin from 'eslint-plugin-prettier/recommended'
import * as tsParser from '@typescript-eslint/parser'

export default [
  { files: ['**/*.{js,mjs,cjs,ts,jsx,tsx}'] },
  {
    languageOptions: { globals: globals.browser }
  },
  pluginJs.configs.recommended,
  ...tseslint.configs.recommended,
  ...tailwindPlugin.configs['flat/recommended'],
  prettierPlugin,
  {
    files: ['**/*.{ts,tsx}'],
    ...reactPlugin.configs.recommended,
    languageOptions: {
      parser: tsParser
    }
  },
  {
    ignores: ['**/.output/*', '**/.wxt/*', '**/ui/**', '**/magicui/**', '**/lib/**', '**.million**']
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': 'warn',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
      '@typescript-eslint/no-unused-expressions': 'off',
      '@eslint-react/no-array-index-key': 'off',
      '@eslint-react/hooks-extra/no-redundant-custom-hook': 'off',
      '@eslint-react/dom/no-missing-button-type': 'off',
      '@eslint-react/hooks-extra/prefer-use-state-lazy-initialization': 'off'
    }
  }
]
// satisfies Linter.Config[]
