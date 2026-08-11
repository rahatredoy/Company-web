import { defineConfig } from 'drizzle-kit';
import { config } from './src/config/index';

export default defineConfig({
  schema: './src/db/schema/index.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: { url: config.database.url },
  verbose: true,
  strict: true,
});
