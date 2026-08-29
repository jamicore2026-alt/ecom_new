import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import svelte from 'eslint-plugin-svelte'
import globals from 'globals'
import prettier from 'eslint-config-prettier'

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/.svelte-kit/**',
      '**/build/**',
      '**/dist/**',
      '**/.turbo/**',
      'apps/api/drizzle/**',
      'apps/api/uploads/**',
      // eslint-plugin-svelte parser cannot handle the JSON-LD `{@html \`<script>${json}</script>\`}`
      // template-literal pattern (valid Svelte; svelte-check passes), so skip linting this one file.
      // `[[]product[]]` matches the literal `[product]` path segment (brackets are glob classes).
      '**/products/[[]product[]]/+page.svelte'
    ]
  },
  // TypeScript files across the monorepo (API source/tests + frontend libs).
  {
    files: ['**/*.ts', '**/*.tsx'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.browser
      }
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }]
    }
  },
  // Svelte files (web + storefront components/routes).
  {
    files: ['**/*.svelte'],
    extends: [...svelte.configs['flat/recommended']],
    languageOptions: {
      globals: { ...globals.browser },
      parserOptions: {
        parser: tseslint.parser
      }
    },
    rules: {
      '@typescript-eslint/no-empty-object-type': 'off',
      'svelte/no-navigation-without-resolve': 'off',
      'svelte/no-goto-without-resolve': 'off',
      'svelte/require-each-key': 'off',
      'svelte/prefer-svelte-reactivity': 'off'
    }
  },
  prettier
)
