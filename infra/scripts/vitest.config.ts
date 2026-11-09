import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'infra',
    environment: 'node',
    // scrypt with N=2^17 is deliberately slow; give crypto tests room.
    testTimeout: 30_000,
  },
});
