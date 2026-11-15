import "dotenv/config";
import { defineConfig } from "prisma/config";

// The Prisma CLI (migrate, studio) uses this URL. Prefer the direct/unpooled
// connection for migrations; fall back to DATABASE_URL. Left undefined during
// `prisma generate` (e.g. on CI install), which doesn't need a database.
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: {
    url: process.env.DIRECT_URL || process.env.DATABASE_URL,
    // Only needed for `prisma migrate dev` against `npx prisma dev` (see README).
    shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL || undefined,
  },
});
