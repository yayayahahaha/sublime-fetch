import globals from 'globals'
import pluginJs from '@eslint/js'

/** @type {import('eslint').Linter.Config[]} */
export default [
  {
    languageOptions: {
      globals: {
        ...globals.node,
        window: 'readonly',

        // chrome extension
        chrome: 'readonly',
        document: 'readonly',
        localStorage: 'readonly',
      },
    },
    rules: {
      indent: ['error', 2, { SwitchCase: 1 }],
    },
  },
  pluginJs.configs.recommended,
]
