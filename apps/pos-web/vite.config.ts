import { defineConfig } from 'vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import { nitro } from 'nitro/vite'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  server: { port: 3101 },
  resolve: { tsconfigPaths: true },
  plugins: [
    tailwindcss(),
    tanstackStart({ router: { routesDirectory: 'routes', generatedRouteTree: 'routeTree.gen.ts' } }),
    nitro({ preset: 'node-server' }),
  ],
})
