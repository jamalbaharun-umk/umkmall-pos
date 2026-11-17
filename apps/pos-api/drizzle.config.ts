import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema/index.ts',
  out: './drizzle',
  schemaFilter: ['pos'],
  dbCredentials: { url: process.env.DATABASE_URL ?? '' },
});
