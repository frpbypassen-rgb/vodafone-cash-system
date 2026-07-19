import globals from 'globals';
import eslint from 'eslint';

export default [{
  languageOptions: {
    ecmaVersion: 2021,
    sourceType: 'module',
    globals: {
      ...globals.node,
      ...globals.browser,
      ...globals.jest,
    },
  },
  rules: {
    'no-undef': 'error',
    'no-unused-vars': 'warn',
    'no-empty': ['error', { allowEmptyCatch: true }],
  },
}];
