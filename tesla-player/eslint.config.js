import js from '@eslint/js'
import pluginVue from 'eslint-plugin-vue'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default [
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...pluginVue.configs['flat/essential'],
  {
    // Let <script lang="ts"> blocks in SFCs be parsed by the TS parser.
    files: ['**/*.vue'],
    languageOptions: {
      parserOptions: { parser: tseslint.parser }
    }
  },
  {
    files: ['**/*.{js,mjs,cjs,ts,mts,cts,vue}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.node
      }
    },
    rules: {
      'no-mixed-spaces-and-tabs': 'off'
    }
  },
  {
    ignores: ['dist/**', 'src/smfplayer/**']
  }
]
