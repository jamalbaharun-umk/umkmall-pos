import { defineConfig } from 'vitest/config'

// Unit tests need none of the app's Vite plugins (Start/Nitro keep the process alive after the run).
export default defineConfig({ test: { include: ['src/**/*.test.ts'] } })
