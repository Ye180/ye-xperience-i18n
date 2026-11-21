import { defineConfig } from 'vitest/config';

// `npm run test:e2e` : test d'intégration (npm install + next build), lent et réseau requis.
const e2e = process.env.E2E === '1';

export default defineConfig({
  test: e2e
    ? { include: ['tests/e2e/*.test.ts'], testTimeout: 600_000, hookTimeout: 600_000 }
    : { include: ['tests/*.test.ts'] },
});
