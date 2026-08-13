import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';

/**
 * eslint-config-next 16 ships flat config directly, so it is spread in rather
 * than pulled through `FlatCompat`. The compat layer serialises a config to
 * validate it as eslintrc, and these arrays carry live plugin objects that
 * reference themselves — it threw `Converting circular structure to JSON`
 * before eslint saw a single file.
 */
const config = [
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    ignores: ['.next/**', 'node_modules/**', 'next-env.d.ts'],
  },
];

export default config;
