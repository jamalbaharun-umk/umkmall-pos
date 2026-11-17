import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'happy-dom',
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    /**
     * TYPE-LEVEL TESTS ARE RUN, not merely written.
     *
     * `tsconfig.json` excludes every test file, so `npm run typecheck` cannot see one and a
     * bare `@ts-expect-error` in a test asserts nothing at all — the package shipped exactly
     * such a line and it was inert. `*.test-d.ts` files are compiled against
     * `tsconfig.typecheck.json`, which includes them, so a claim like "a control with
     * neither label nor aria-label does not compile" fails here the day it stops being true.
     */
    typecheck: {
      enabled: true,
      include: ['src/**/*.test-d.ts'],
      tsconfig: './tsconfig.typecheck.json',
    },
  },
});
