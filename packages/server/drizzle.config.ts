import { defineConfig } from 'drizzle-kit';

// `pnpm --filter @squadboard/server db:generate` writes a new SQL migration after schema changes.
export default defineConfig({
  dialect: 'sqlite',
  schema: './src/db/schema.ts',
  out: './drizzle',
});
