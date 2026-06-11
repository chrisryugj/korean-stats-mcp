import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // tests/*.spec.ts 는 Playwright E2E (MCP Inspector) — vitest 대상 아님
    include: ['tests/unit/**/*.test.ts'],
  },
});
