import { RuleConfigSeverity } from '@commitlint/types';

// Conventional commits referencing feature IDs, e.g. `feat(F1.8): proposal review screen`.
/** @type {import('@commitlint/types').UserConfig} */
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    // Feature IDs like F0.1 are upper case; allow them as scopes.
    'scope-case': [RuleConfigSeverity.Disabled],
  },
};
