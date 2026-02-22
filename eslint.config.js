import globals from 'globals'
import { FlatCompat } from '@eslint/eslintrc'
import { includeIgnoreFile } from '@eslint/compat'
import tseslint from 'typescript-eslint'
import { join } from 'path'

const compat = new FlatCompat({
  baseDirectory: import.meta.dirname,
})

export default [
  ...compat.extends('airbnb-base'),
  includeIgnoreFile(
    join(import.meta.dirname, '.gitignore'),
  ),
  ...tseslint.configs.recommended,
  {
    name: 'base-config',
    files: ['**/*.{js,ts}'],
    languageOptions: {
      ecmaVersion: 'latest',
      globals: {
        ...globals.node,
      },
    },
    settings: {
      'import/resolver': {
        node: {
          extensions: ['.js', '.ts'],
        },
      },
    },
    rules: {
      'no-console': 'off',
      'no-await-in-loop': 'off',
      'no-restricted-syntax': 'off',
      'no-param-reassign': [
        'error',
        {
          props: true,
          ignorePropertyModificationsForRegex: [
            '^draft',
            '^state',
          ],
        },
      ],
      'no-continue': 'off',
      'object-curly-newline': [
        'error',
        {
          ObjectExpression: {
            minProperties: 1,
          },
        },
      ],
      'func-names': ['error', 'as-needed'],
      'default-param-last': 'off',
      'no-multi-str': 'off',
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          ignoreRestSiblings: true,
          caughtErrors: 'none',
        },
      ],
      'import/prefer-default-export': 'off',
      'import/order': [
        'error',
        {
          'newlines-between': 'always',
          groups: [
            'builtin',
            'external',
            'internal',
            'parent',
            'sibling',
            'index',
            'object',
            'type',
          ],
        },
      ],
      'import/no-extraneous-dependencies': 'off',
      'import/no-unresolved': 'off',
      'import/extensions': 'off',
    },
  },
]
