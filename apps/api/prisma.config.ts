import { defineConfig } from 'prisma/config';
import { config as loadEnv } from 'dotenv';
import { join } from 'node:path';

loadEnv({ path: join(__dirname, '..', '..', '.env') });

export default defineConfig({
  schema: './prisma/schema.prisma',
  migrations: {
    seed: 'ts-node prisma/seed.ts',
  },
});
