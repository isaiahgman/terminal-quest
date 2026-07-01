import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  { ignores: ['dist/', 'node_modules/', 'coverage/'] },
  js.configs.recommended,
  // CLAUDE.md promises "strictest ESLint"; recommended-only had zero
  // type-aware rules (no-floating-promises, await-thenable, …). The
  // type-checked tiers deliver on the promise.
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          // Plain-JS config/scripts are linted without type information.
          allowDefaultProject: ['*.mjs', 'scripts/*.mjs'],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    rules: {
      // Two deliberate accommodations, not escape hatches:
      // - `!` is the repo's chosen idiom for indexed access proven in-bounds:
      //   tsconfig's noUncheckedIndexedAccess makes every `arr[i]` possibly-
      //   undefined, and the codebase (tests especially) asserts the cases it
      //   just proved. Banning it would trade one marker for `?? panic()`
      //   noise everywhere.
      '@typescript-eslint/no-non-null-assertion': 'off',
      // - Numbers in template literals are ubiquitous, safe, and idiomatic in
      //   a game full of coordinates and stats.
      '@typescript-eslint/restrict-template-expressions': [
        'error',
        { allowNumber: true },
      ],
    },
  },
  {
    // Scripts are plain ESM JS — no TS type rules apply.
    files: ['**/*.mjs'],
    ...tseslint.configs.disableTypeChecked,
  },
  // Disables ESLint rules that would conflict with Prettier's formatting.
  prettier,
);
